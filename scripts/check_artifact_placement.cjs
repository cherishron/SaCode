// 产物落点守卫（2026-10-16 随统一临时根迁移同批上线）：
// 把「临时/运行产物只许落 target/tmp、仓根/模块一级/target 一级只许已登记名字」变成机器可查。
//
// 为什么要有它：旧临时根（桌面模块下的点开头测试目录、仓根退役目录）在历史里反复
// 以「测试自建、跑完不删、gitignore 兜底」的方式沉淀残渣；ignore 规则一删就全部现形。
// 判定落点对不对，必须由门禁在每轮验收时机械核对，不能靠人记得。
//
// 检查项（每一项都能被一条自证探针单独杀出来）：
//   root-allowlist      仓根一级（文件+目录）⊆ 允许集；未登记即违规
//   module-allowset:*   各模块一级目录 ⊆ 允许集；稳定模块的文件也按允许集核对，
//                       apps/desktop 因入口文件持续新增只拦产物后缀（.log/.lease/.tmp/.bak）
//   target-allowset     target 一级 ⊆ {release, .cjpm-history, .dep-cache, tmp}
//   retired-string      源码范围不得再出现旧临时根名（唯一豁免：本文件自身，
//                       因为针就缝在这里；退役目录名 dualtest 因在 target/tmp 下作为
//                       子区名继续使用，不作字符串门，改由 retired-dirs 的存在性覆盖）
//   retired-dirs        退役根与其近形目录（含 .tmp-test 的深层复生）存在即违规，空目录也算
// 判据只有结尾 GATE 行与退出码：0 全绿；1 有 FAIL；2 用法错误。
// 接线状态：登记于 scripts/gate-verdict.mjs 的 UNWIRED_GATES（理由见该登记）。
const { readdirSync, statSync, mkdirSync, writeFileSync, rmSync, mkdtempSync } = require("node:fs");
const { join, relative } = require("node:path");
const { spawnSync } = require("node:child_process");
const os = require("node:os");

const root = join(__dirname, "..");

// R1：仓根一级允许集（= 当前已入库源码/文档/配置 + 本机工具状态目录，后者被 .gitignore 覆盖）。
// 新增条目必须在这里登记——登记动作本身就是一次「它该不该在仓根」的评审。
const ROOT_DIRS = new Set([
  ".arts", ".cache", ".codeartsdoer", ".deps", ".github", ".qoder", ".sacode", ".vscode", ".workbuddy",
  "apps", "core", "docs", "extjs", "npm", "scripts", "target", "third_party",
]);
const ROOT_FILES = new Set([
  ".gitignore", "AGENTS.md", "cjpm.lock", "cjpm.toml", "LICENSE", "README.md",
]);

// R2：模块一级允许集。
//   files 为数组：按允许集核对；files 为 null：只拦产物后缀（供入口文件持续新增的模块用）。
const CJPM_FILES = ["cjpm.lock", "cjpm.toml"];
const RESIDUE_RE = /\.(log|lease|tmp|bak)$/i;
const MODULES = [
  { path: "apps", dirs: ["cli", "daemon", "desktop", "host", "mobile"], files: [] },
  { path: "core", dirs: ["native", "src", "target", "test-support"], files: CJPM_FILES },
  { path: "apps/cli", dirs: ["src", "test"], files: CJPM_FILES },
  { path: "apps/daemon", dirs: ["src", "test"], files: CJPM_FILES },
  { path: "apps/host", dirs: ["src", "test"], files: CJPM_FILES },
  {
    path: "apps/desktop",
    dirs: ["data", "dist", "import-adapters", "node_modules", "renderer", "scan-adapters", "test", "test-support"],
    files: null,
  },
  { path: "apps/mobile", dirs: ["kotlin", "kotlin-test"], files: [] },
  { path: "extjs", dirs: ["computer-use", "example", "node_modules", "providers", "test"], files: ["host.cjs", "server.cjs"] },
  {
    path: "npm",
    dirs: [
      "node_modules",
      "sacode-cli",
      "sacode-cli-darwin-arm64",
      "sacode-cli-darwin-x64",
      "sacode-cli-linux-arm64",
      "sacode-cli-linux-x64",
      "sacode-cli-win32-x64",
    ],
    files: [],
  },
];

// R3：target 一级只允许这些名字（release 与 tmp 为目录，两个 dot 文件为 cjpm 账本）。
const TARGET_ALLOW = new Set(["release", ".cjpm-history", ".dep-cache", "tmp"]);

// R4：旧临时根名（针）。唯一豁免见文件头。
const SELF = "scripts/check_artifact_placement.cjs";
const R4_RE = /\.tmp-test/;
const R4_PATHS = [".github", "scripts", "apps", "core", "extjs", "npm", "docs/qa/wiring-inventory.mjs", "docs/qa/check-inflight-ownership.cjs"];

// R5：退役根与近形目录；带 .tmp-test 的深层复生也一起拦。
const RETIRED_EXPLICIT = ["desktop", "dualtest", "apps/desktop/.tmp-test", "apps/desktop/apps", "apps/host/apps"];
const WALK_SKIP = new Set(["node_modules", "target", "dist", ".git"]);

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
}

function extraNames(baseDir, allowedDirs, allowedFiles, filesRule) {
  const bad = [];
  for (const e of readdirSync(baseDir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!allowedDirs.includes(e.name)) bad.push(`${e.name}/`);
    } else if (filesRule === null) {
      if (RESIDUE_RE.test(e.name)) bad.push(e.name);
    } else if (!allowedFiles.includes(e.name)) {
      bad.push(e.name);
    }
  }
  return bad;
}

function findTmpTestDirs(startDir, baseDir, out, depth) {
  if (depth > 5) return;
  let entries = [];
  try { entries = readdirSync(startDir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (!e.isDirectory() || WALK_SKIP.has(e.name)) continue;
    const p = join(startDir, e.name);
    if (e.name === ".tmp-test") { out.push(relative(baseDir, p)); continue; }
    findTmpTestDirs(p, baseDir, out, depth + 1);
  }
}

function scanRetiredStringsFs(baseDir) {
  const hits = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (WALK_SKIP.has(e.name)) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      let text = "";
      try { text = require("node:fs").readFileSync(p, "utf8"); } catch { continue; }
      text.split(/\r?\n/).forEach((line, i) => {
        if (R4_RE.test(line)) hits.push(`${relative(baseDir, p)}:${i + 1}: ${line.trim()}`);
      });
    }
  };
  walk(baseDir);
  return hits;
}

function scanRetiredStringsGit(repoRoot) {
  const res = spawnSync(
    "git",
    ["grep", "-n", "--untracked", "--no-color", "-E", R4_RE.source, "--", ...R4_PATHS],
    { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (res.status !== 0 && res.status !== 1) {
    throw new Error(`git grep rc=${res.status}: ${(res.stderr || "").trim()}`);
  }
  return res.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => !line.startsWith(`${SELF}:`));
}

function audit(baseDir, mode) {
  // R1 仓根
  {
    const bad = [];
    for (const e of readdirSync(baseDir, { withFileTypes: true })) {
      if (e.name === ".git") continue;
      if (e.isDirectory()) {
        if (!ROOT_DIRS.has(e.name)) bad.push(`${e.name}/`);
      } else if (!ROOT_FILES.has(e.name)) {
        bad.push(e.name);
      }
    }
    check("root-allowlist", bad.length === 0,
      bad.length
        ? `仓根未登记条目: ${bad.join(", ")}（正式内容请登记进 R1 允许集；运行产物请落 target/tmp）`
        : `仓根一级 ${readdirSync(baseDir).length - 1} 项均在允许集`);
  }

  // R2 模块一级
  for (const m of MODULES) {
    const name = `module-allowset:${m.path}`;
    const dir = join(baseDir, m.path);
    let bad = [];
    try {
      bad = extraNames(dir, m.dirs, m.files, m.files === null ? null : m.files);
    } catch (e) {
      check(name, false, `取数失败: ${e.message}`);
      continue;
    }
    check(name, bad.length === 0,
      bad.length
        ? `${m.path} 一级未登记: ${bad.join(", ")}（产物请落 target/tmp；源文件请登记进允许集）`
        : `${m.path} 一级在允许集内`);
  }

  // R3 target 一级
  {
    const bad = readdirSync(join(baseDir, "target"))
      .filter((n) => !TARGET_ALLOW.has(n));
    check("target-allowset", bad.length === 0,
      bad.length
        ? `target 未登记条目: ${bad.join(", ")}（散件禁止；运行产物一律进 target/tmp）`
        : "target 一级 = release/.cjpm-history/.dep-cache/tmp");
  }

  // R4 旧临时根字符串门
  {
    const hits = mode === "real" ? scanRetiredStringsGit(baseDir) : scanRetiredStringsFs(baseDir);
    check("retired-string", hits.length === 0,
      hits.length
        ? `仍引用旧临时根名: ${hits.slice(0, 10).join(" | ")}${hits.length > 10 ? ` …共 ${hits.length} 处` : ""}`
        : `源码范围未再出现旧临时根名（scope: ${R4_PATHS.join(" ")}）`);
  }

  // R5 退役根存在性（含深层复生）
  {
    const bad = [];
    for (const rel of RETIRED_EXPLICIT) {
      const p = join(baseDir, rel);
      try { statSync(p); bad.push(rel); } catch { /* 不存在即合规 */ }
    }
    const deep = [];
    for (const scope of ["apps", "core", "extjs", "npm", "scripts"]) {
      const p = join(baseDir, scope);
      try { if (statSync(p).isDirectory()) findTmpTestDirs(p, baseDir, deep, 0); } catch { /* 缺目录跳过 */ }
    }
    const all = [...new Set([...bad, ...deep])];
    check("retired-dirs", all.length === 0,
      all.length ? `退役根/近形目录仍存在: ${all.join(", ")}` : "退役根/近形目录均不存在（含深层 .tmp-test 复生）");
  }
}

function report() {
  const failed = checks.filter((c) => !c.ok);
  for (const c of checks) console.log(`${c.ok ? "OK  " : "FAIL"} ${c.name}: ${c.detail}`);
  console.log(`GATE: ${failed.length ? "FAIL" : "PASS"} (${checks.length} checks, fail=${failed.length})`);
  return failed.length ? 1 : 0;
}

function buildFixture(base) {
  const dirs = [
    ".arts", ".cache", ".codeartsdoer", ".deps", ".github", ".qoder", ".sacode", ".vscode", ".workbuddy",
    "apps", "core", "docs", "extjs", "npm", "scripts", "target", "third_party",
    "apps/cli", "apps/daemon", "apps/desktop", "apps/host", "apps/mobile",
    "core/native", "core/src", "core/target", "core/test-support",
    "apps/cli/src", "apps/cli/test", "apps/daemon/src", "apps/daemon/test",
    "apps/host/src", "apps/host/test",
    "apps/desktop/data", "apps/desktop/dist", "apps/desktop/import-adapters", "apps/desktop/node_modules",
    "apps/desktop/renderer",
    "apps/desktop/scan-adapters", "apps/desktop/test", "apps/desktop/test-support",
    "apps/mobile/kotlin", "apps/mobile/kotlin-test",
    "extjs/computer-use", "extjs/example", "extjs/node_modules", "extjs/providers", "extjs/test",
    "npm/sacode-cli", "npm/sacode-cli-darwin-arm64", "npm/sacode-cli-darwin-x64",
    "npm/sacode-cli-linux-arm64", "npm/sacode-cli-linux-x64", "npm/sacode-cli-win32-x64",
    "target/release", "target/tmp",
  ];
  const files = [
    ".gitignore", "AGENTS.md", "cjpm.lock", "cjpm.toml", "LICENSE", "README.md",
    "core/cjpm.lock", "core/cjpm.toml",
    "apps/cli/cjpm.lock", "apps/cli/cjpm.toml", "apps/daemon/cjpm.lock", "apps/daemon/cjpm.toml",
    "apps/host/cjpm.lock", "apps/host/cjpm.toml",
    "extjs/host.cjs", "extjs/server.cjs",
    "target/.cjpm-history", "target/.dep-cache",
  ];
  for (const d of dirs) mkdirSync(join(base, d), { recursive: true });
  for (const f of files) writeFileSync(join(base, f), "");
}

// 反证：每条规则各注入一处只有它能杀的违规；另有反向探针证明新合法形态不误伤。
function selftest() {
  const probes = [
    ["root-allowlist", (b) => mkdirSync(join(b, "stray-dir"))],
    ["root-allowlist", (b) => writeFileSync(join(b, "build-daemon.log"), "")],
    ["module-allowset:core", (b) => mkdirSync(join(b, "core", "lsp-l1-model-fail"))],
    ["module-allowset:core", (b) => writeFileSync(join(b, "core", "core-test-1.log"), "")],
    ["module-allowset:apps/host", (b) => mkdirSync(join(b, "apps", "host", "apps"))],
    ["target-allowset", (b) => mkdirSync(join(b, "target", "acp-rebuild-deadbeef"))],
    ["retired-string", (b) => writeFileSync(join(b, "scripts", "old-writer.mjs"), "const p = 'apps/desktop/.tmp-test/x';\n")],
    ["retired-dirs", (b) => mkdirSync(join(b, "apps", "desktop", ".tmp-test"))],
    ["retired-dirs", (b) => mkdirSync(join(b, "apps", "desktop", "test", ".tmp-test"), { recursive: true })],
    ["retired-string-negative", (b) => writeFileSync(
      join(b, "apps", "desktop", "test", "new-writer.test.mjs"),
      "const root = join(REPO, 'target', 'tmp', 'dualtest');\n"), "absent"],
  ];
  let missed = 0;
  for (const [target, mutate, expectation] of probes) {
    const base = mkdtempSync(join(os.tmpdir(), "artifact-guard-selftest-"));
    try {
      buildFixture(base);
      mutate(base);
      checks.length = 0;
      audit(base, "fixture");
      const hit = checks.filter((c) => !c.ok).map((c) => c.name);
      if (expectation === "absent") {
        if (!hit.includes(target)) console.log(`CAUGHT ${target} (合法新形态未被误伤)`);
        else { console.log(`MISSED ${target} -> 误伤: FAIL 集含 [${hit.join(",")}]`); missed++; }
      } else if (hit.includes(target)) {
        console.log(`CAUGHT ${target} -> ${hit.join(",")}`);
      } else {
        console.log(`MISSED ${target} -> FAIL 集为 [${hit.join(",")}]`);
        missed++;
      }
    } catch (e) {
      console.log(`MISSED ${target} (门禁执行异常: ${e.message})`);
      missed++;
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  }
  const base = mkdtempSync(join(os.tmpdir(), "artifact-guard-selftest-"));
  let baselineGreen = false;
  try {
    buildFixture(base);
    checks.length = 0;
    audit(base, "fixture");
    baselineGreen = checks.every((c) => c.ok);
  } catch (e) {
    console.log(`基线执行异常: ${e.message}`);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
  console.log(`SELFTEST: ${missed === 0 && baselineGreen ? "PASS" : "FAIL"} (probes=${probes.length}, missed=${missed}, baseline=${baselineGreen ? "green" : "RED"})`);
  return missed === 0 && baselineGreen ? 0 : 1;
}

const args = process.argv.slice(2);
if (args.includes("--selftest")) {
  process.exitCode = selftest();
} else if (args.length) {
  console.error("用法: node scripts/check_artifact_placement.cjs [--selftest]");
  process.exitCode = 2;
} else {
  try {
    audit(root, "real");
  } catch (e) {
    console.log(`GATE: FAIL (取数失败: ${e.message})`);
    process.exitCode = 1;
  }
  if (checks.length) process.exitCode = report();
}
