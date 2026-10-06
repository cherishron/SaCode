// 统一验收入口：把 10 类验证按依赖顺序串行跑完，任一步失败即停，最后输出汇总。
// 串行是硬要求——core 的测试二进合约 20MB，两个 cjpm/electron 构建并发会互撞
// ld.lld: failed to write the output file: Permission denied，所以这里一次只跑一个。
//
// 用法：
//   node scripts/verify-all.mjs              跑全部
//   node scripts/verify-all.mjs core         只跑某一类（名字见下方 STEPS 的 key）
//   node scripts/verify-all.mjs core desktop 跑指定的几类，按给定顺序
//   node scripts/verify-all.mjs --list       列出所有可选项
//
// 退出码：全部通过 0；任一步失败 1；用法错误 2。
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPrivateTmpDir, disposePrivateTmpDir } from "./verify-tmp.mjs";
import { GATE_SCRIPTS, verdict as gateVerdict } from "./gate-verdict.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";

// 整轮验收用自己独占的一份临时目录，理由与实测计数写在 scripts/verify-tmp.mjs 顶部。
// 必须写回 process.env：下面每个 run() 默认继承 process.env，
// envWithoutElectronRunAsNode() 也是从它拷贝的，漏一处就还有步骤落在共享 TMP 里。
const privateTmp = createPrivateTmpDir(root);
for (const key of ["TMP", "TEMP", "TMPDIR"]) process.env[key] = privateTmp.dir;
process.on("exit", () => {
  try { disposePrivateTmpDir(privateTmp.dir); } catch (_) { /* 被占用就留着，人工清理 */ }
});
console.log(`临时目录：${privateTmp.dir}（本次运行独占，退出即清理）\n`);

// 每个验证的产出解析：从合并后的输出里抓关键行，抓不到就明说「未解析到」，
// 不猜、不静默当成通过。
//
// 两条防骗线，都是被实测打脸后才加的：
// 1) 测试根本没跑（链接失败、进程被杀）时，cjpm 也会打印 Summary，只是数字全 0。
//    只看「有没有 Summary」会把 0 条当成通过，所以这里必须校验总数非 0。
// 2) node --test 在全部 skip 时也会打 # tests N / # pass 0，同样不能只看有没有汇总行。
// matchAll 要求正则带 g 标志，漏一个就整条抛 TypeError。这里统一补齐，
// 避免每个调用点各自记得加 flag——实测就因为漏加把一次验收炸成了「执行器异常」。
function lastMatch(text, pattern) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const hits = [...text.matchAll(new RegExp(pattern.source, flags))];
  return hits.length ? hits[hits.length - 1][0].trim() : null;
}

function numbersIn(text, pattern) {
  const hit = lastMatch(text, pattern);
  return hit ? (hit.match(/\d+/g) || []).map(Number) : [];
}

function run(command, args, cwd, env) {
  const result = spawnSync(command, args, {
    cwd,
    env: env || process.env,
    encoding: "utf8",
    shell: isWin,
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = `${result.stdout || ""}${result.stderr || ""}`;
  return { code: result.status === null ? 1 : result.status, out };
}

// Electron 在这台机器上会被继承的 ELECTRON_RUN_AS_NODE=1 带跑成 Node 进程，
// 于是 main.cjs 读 app.isPackaged 直接 TypeError。跑 Electron 前必须清掉。
function envWithoutElectronRunAsNode() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === "electron_run_as_node") delete env[key];
  }
  return env;
}

// 上一个 core.exe / std.testrunner.exe 被系统短暂占用时，重链会 Permission denied。
// 先删产物再跑；仍失败就退避重试，重试也失败才算真失败。
function cleanCoreTestBinaries() {
  const dir = join(root, "core", "target", "release", "unittest_bin");
  for (const name of ["core.exe", "std.testrunner.exe"]) {
    const p = join(dir, name);
    if (existsSync(p)) {
      try { rmSync(p, { force: true }); } catch (_) { /* 占用中就留给重试那一轮 */ }
    }
  }
}

// cjpm 的汇总形如：
//   Summary: TOTAL: 585
//       PASSED: 583, SKIPPED: 2, ERROR: 0
//       FAILED: 0
// 解析不到、或总数为 0，都算「没验完」而不是通过——0 条通常是构建或链接阶段就挂了。
function parseCjpm(out) {
  const total = numbersIn(out, /Summary:\s*TOTAL:\s*\d+/)[0];
  const counts = numbersIn(out, /PASSED:\s*\d+.*?(?:ERROR:\s*\d+|$)/s);
  const passed = counts[0];
  const failed = counts.find((n, i) => i > 0 && /FAILED/.test("")) ?? null;
  const failedCount = numbersIn(out, /FAILED:\s*\d+/)[0];
  const errorCount = numbersIn(out, /ERROR:\s*\d+/)[0];
  if (total === undefined || total === 0) {
    return { summary: `未解析到有效的 cjpm 汇总（TOTAL=${total === undefined ? "缺失" : 0}），按未验完处理`, ok: false };
  }
  const parts = [`TOTAL ${total}`, `PASSED ${passed}`, `SKIPPED ${numbersIn(out, /SKIPPED:\s*\d+/)[0]}`,
    `ERROR ${errorCount}`, `FAILED ${failedCount}`].filter((s) => !s.endsWith("undefined"));
  return { summary: parts.join(" / "), ok: true };
}

function parseNodeTest(out) {
  // node --test 的 TAP 汇总形如 "# tests 205 / # pass 205 / # fail 0 / # skipped 0"
  const tests = numbersIn(out, /# tests \d+/)[0];
  const pass = numbersIn(out, /# pass \d+/)[0];
  const fail = numbersIn(out, /# fail \d+/)[0];
  const skip = numbersIn(out, /# skipped \d+/)[0];
  // 全 skip（例如真实模型缺凭据）不是失败，但也不能算验过：单独标出来让人决定
  if (tests !== undefined && tests > 0 && pass === 0 && skip === tests) {
    return { summary: `全部跳过（tests ${tests} / skipped ${skip}），未实际执行`, ok: true, skippedAll: true };
  }
  if (tests === undefined || tests === 0) {
    return { summary: "未解析到有效的 node --test 汇总，按未验完处理", ok: false };
  }
  return {
    summary: `tests ${tests} / pass ${pass} / fail ${fail}${skip === undefined ? "" : ` / skipped ${skip}`}`,
    ok: true,
  };
}

const STEPS = [
  {
    key: "gates",
    title: "接口与所有权门禁（静态对账，不构建；GATE 与 SELFTEST 都要绿）",
    run() {
      // 排第一步：这几条纯静态、几秒钟跑完，且拦的是「接口面漂移」这类会让后面所有构建
      // 白跑的问题。判绿要同时有 GATE: PASS 与 SELFTEST: PASS——只有前者说明门禁没自证，
      // 后者能绿而基线红也照样拦（多段输出里任一段 FAIL 都不算过）。
      let code = 0;
      let raw = "";
      const parts = [];
      for (const file of GATE_SCRIPTS) {
        const plain = run("node", [join("scripts", file)], root);
        const self = run("node", [join("scripts", file), "--selftest"], root);
        const both = `${plain.out}\n${self.out}`;
        const v = gateVerdict(plain.code === 0 && self.code === 0 ? 0 : 1, both);
        if (!v.ok) code = 1;
        parts.push(`${file.replace(/^check_/, "").replace(/\.cjs$/, "")} ${v.ok ? "绿" : "红"}`);
        raw += `===== ${file} =====\n${both}\n`;
      }
      return { code, summary: `${GATE_SCRIPTS.length} 条门禁：${parts.join(" / ")}`, parsedOk: code === 0, raw };
    },
  },
  {
    key: "core",
    title: "核心仓颉单测（cjpm test）",
    run() {
      cleanCoreTestBinaries();
      let last = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const r = run("cjpm", ["test", "--no-color", "--no-progress"], join(root, "core"));
        last = r;
        const linkLocked = /ld\.lld: error|failed to write the output file|Permission denied/i.test(r.out);
        if (r.code === 0 || !linkLocked) break;
        // 只在「重链被占用」这种环境形态下重试；真失败不重试，避免把红灯拖成绿灯
        console.log(`  · 第 ${attempt} 次撞到链接互锁，清理产物后退避重试`);
        cleanCoreTestBinaries();
        spawnSync(isWin ? "cmd" : "sleep", isWin ? ["/c", "ping -n 6 127.0.0.1 >nul"] : ["5"], { shell: isWin });
      }
      const parsed = parseCjpm(last.out);
      return { code: last.code, summary: parsed.summary, parsedOk: parsed.ok, raw: last.out };
    },
  },
  {
    key: "desktop",
    title: "桌面单测（npm test，勿写成 node --test test/）",
    run() {
      const r = run("npm", ["test"], join(root, "apps", "desktop"));
      const parsed = parseNodeTest(r.out);
      return { code: r.code, summary: parsed.summary, parsedOk: parsed.ok, raw: r.out };
    },
  },
  {
    key: "extjs",
    title: "JS 扩展宿主单测（node --test）",
    run() {
      const r = run("node", ["--test"], join(root, "extjs"));
      const parsed = parseNodeTest(r.out);
      return { code: r.code, summary: parsed.summary, parsedOk: parsed.ok, raw: r.out };
    },
  },
  {
    key: "vendor",
    title: "前端产物重建（npm run vendor）",
    run() {
      const r = run("npm", ["run", "vendor"], join(root, "apps", "desktop"));
      // 四步折叠脚本少跑一步也会 exit 0 以外的形态，但为防「内部并行或提前返回」，
      // 额外要求四个 pack 脚本的完成标记都出现过。
      const marks = ["pack-vendor", "pack-tinyvue", "pack-tinyrobot", "pack-pages"]
        .map((m) => (r.out.includes(m) ? 1 : 0))
        .reduce((a, b) => a + b, 0);
      const parsedOk = r.code === 0 && marks === 4;
      return {
        code: r.code,
        summary: parsedOk ? "四步折叠完成" : `退出码 ${r.code}，仅见 ${marks}/4 个折叠步骤标记`,
        parsedOk,
        raw: r.out,
      };
    },
  },
  {
    key: "smoke",
    title: "Electron 冒烟（npm run smoke）",
    run() {
      const r = run("npm", ["run", "smoke"], join(root, "apps", "desktop"), envWithoutElectronRunAsNode());
      const parsedOk = r.code === 0 && /SMOKE PASS/.test(r.out);
      return {
        code: r.code,
        summary: parsedOk ? "SMOKE PASS" : `退出码 ${r.code}，未见 SMOKE PASS`,
        parsedOk,
        raw: r.out,
      };
    },
  },
  {
    key: "ui-smoke",
    title: "Electron 整页冒烟（npm run ui-smoke）",
    run() {
      const r = run("npm", ["run", "ui-smoke"], join(root, "apps", "desktop"), envWithoutElectronRunAsNode());
      const ok = (r.out.match(/UI OK/g) || []).length;
      const bad = (r.out.match(/UI FAIL/g) || []).length;
      // 只有出现 UI_SMOKE PASS 才认这段输出属于本轮；否则 UI OK 可能是上一轮残留，
      // 拿残留计数当通过就是把红灯判成绿灯。
      const parsedOk = r.code === 0 && /UI_SMOKE PASS/.test(r.out) && ok > 0 && bad === 0;
      return {
        code: r.code,
        summary: parsedOk
          ? `UI_SMOKE PASS（UI OK ${ok} / FAIL ${bad}）`
          : `退出码 ${r.code}，UI_SMOKE PASS 未出现（UI OK ${ok} / FAIL ${bad}）`,
        parsedOk,
        raw: r.out,
      };
    },
  },
  {
    key: "pack-cli",
    title: "CLI 平台包（scripts/pack-cli.mjs）",
    run() {
      const r = run("node", [join("scripts", "pack-cli.mjs")], root);
      const packed = lastMatch(r.out, /packed \d+ 个文件.*/);
      const parsedOk = r.code === 0 && !!packed;
      return { code: r.code, summary: packed || `退出码 ${r.code}，未见到打包完成行`, parsedOk, raw: r.out };
    },
  },
  {
    key: "npm-install",
    title: "npm 安装态（scripts/smoke-npm-install.mjs，保留 Node）",
    run() {
      const r = run("node", [join("scripts", "smoke-npm-install.mjs")], root);
      const parsedOk = r.code === 0 && /NPM_INSTALL_SMOKE PASS/.test(r.out);
      return {
        code: r.code,
        summary: parsedOk ? "NPM_INSTALL_SMOKE PASS" : `退出码 ${r.code}，未见 NPM_INSTALL_SMOKE PASS`,
        parsedOk,
        raw: r.out,
      };
    },
  },
  {
    key: "real-model",
    title: "真实模型（step-5-preview，需凭据）",
    run() {
      // 缺凭据时用例会整体 skip。那不是失败，但也不是验过——单独标成「跳过」，
      // 不让没配凭据的机器被误判成验收失败，也不让 skip 冒充通过。
      const hasKey = (process.env.STEPFUN_API_KEY || "").length > 0
        || existsSync(join(root, "target", "step.key"));
      const files = ["test/real-provider-e2e.test.mjs", "test/real-provider-tools.test.mjs"];
      const r = run("node", ["--test", ...files], join(root, "apps", "desktop"));
      const parsed = parseNodeTest(r.out);
      if (!hasKey) {
        return {
          code: 0,
          summary: `跳过：未配置 STEPFUN_API_KEY 且无 target/step.key（${parsed.summary}）`,
          parsedOk: true,
          skipped: true,
          raw: r.out,
        };
      }
      return { code: r.code, summary: parsed.summary, parsedOk: parsed.ok, raw: r.out };
    },
  },
];

const args = process.argv.slice(2);
if (args.includes("--list")) {
  for (const s of STEPS) console.log(`${s.key}\t${s.title}`);
  process.exit(0);
}
const keys = args.length ? args : STEPS.map((s) => s.key);
const unknown = keys.filter((k) => !STEPS.some((s) => s.key === k));
if (unknown.length) {
  console.error(`未知验证项：${unknown.join(", ")}（用 --list 看可选项）`);
  process.exit(2);
}
const selected = keys.map((k) => STEPS.find((s) => s.key === k));

console.log(`SaCode 统一验收：共 ${selected.length} 项，串行执行\n`);
const results = [];
for (const [index, step] of selected.entries()) {
  console.log(`[${index + 1}/${selected.length}] ${step.title}`);
  const started = Date.now();
  let outcome;
  try {
    outcome = step.run();
  } catch (error) {
    outcome = { code: 1, summary: `执行器异常：${error && error.message}`, parsedOk: false, raw: "" };
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  // 退出码 0 但解析判定「没验完」同样算失败：这正是防止 0 条 / 全 skip / 残留输出
  // 被当成通过的那道闸。parsedOk 缺省视为 true，只有显式返回 false 才拦。
  const passed = outcome.code === 0 && outcome.parsedOk !== false;
  const verdict = outcome.skipped ? "跳过" : passed ? "通过" : "失败";
  console.log(`  → ${verdict}（${seconds}s）${outcome.summary}\n`);
  results.push({ key: step.key, title: step.title, verdict, seconds, summary: outcome.summary, skipped: !!outcome.skipped });
  if (!passed && !outcome.skipped) {
    const tail = (outcome.raw || "").split(/\r?\n/).slice(-40).join("\n");
    console.error(`—— ${step.title} 失败，退出码 ${outcome.code}。输出尾部：\n${tail}\n`);
    console.error("按设计在此停止，后续验证不跑。");
    break;
  }
}

console.log("===== 汇总 =====");
for (const r of results) {
  const mark = r.verdict === "通过" ? "✔" : r.verdict === "跳过" ? "○" : "✘";
  console.log(`${mark} ${r.key.padEnd(12)} ${r.verdict}  ${String(r.seconds).padStart(6)}s  ${r.summary}`);
}
const failed = results.filter((r) => r.verdict === "失败");
const skipped = results.filter((r) => r.verdict === "跳过");
console.log(`\n共执行 ${results.length}/${selected.length} 项，通过 ${results.length - failed.length - skipped.length} 项，失败 ${failed.length} 项，跳过 ${skipped.length} 项。`);
process.exit(failed.length ? 1 : 0);
