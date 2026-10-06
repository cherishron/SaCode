// Host 方法面对账：apps/host/src/main.cj 的分派集 与 initialize 的 capabilities 声明集 必须逐名相等，
// 且总量等于冻结分母。判据只有结尾 GATE 行与退出码：0 全绿；1 有 FAIL；2 取数或用法错误（不等于通过）。
//
// 为什么要有这条（2026-10-06 实测的两种漂移，都发生在这两面之间）：
// ① 并发线 `6cc063a` 加了 `global/settings/*` 四个动词的分派但没进 capabilities，加上此前
//    `workspace/files` 与 `plugin/*` 三条，声明面落后分派面 8 条。握手说「我没有这个能力」，
//    而代码真能办——消费者按能力清单接线就永远接不上。
// ② 反过来更贵：声明了但没分派，握手把动词卖给调用方，调用后拿 `-32601`。
// 运行时那条断言在 `apps/desktop/test/host-verbs.test.mjs`，要宿主构建才能跑；这条门禁纯静态，
// 不构建不启进程，所以能在「改完 main.cj 的那一刻」就拦住，而不是等下一轮打包。
//
// 冻结分母口径见 `docs/evidence/p0-interface-freeze-2026-10-06.md` §2：
// 77 个 `method == "…"` 字面量 + `isGoalControlMethod` 白名单里的 5 个 goal 动词 = 82。
// 分母变了必须同时改这里和那节，两处不同步即本门禁红灯。
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");
const HOST = "apps/host/src/main.cj";
const GOAL_CONTROL = "core/src/goal_control.cj";
const DENOMINATOR = 82;

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
}

// 跳过注释与普通字符串，返回压成等长空白的可扫描副本。
// 仓颉源里的 `"""…"""` 长字符串不在本面取数路径上（capabilities 走的是转义引号单行串），
// 因此这里只处理 // 与 /* */ 与 "…"；出现长字符串会让下面两条取数检查报红而不是静默漏取。
function blankOut(text) {
  const out = text.split("");
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") { out[i] = " "; i++; }
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      out[i] = " "; out[i + 1] = " "; i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) { out[i] = text[i] === "\n" ? "\n" : " "; i++; }
      if (i < text.length) { out[i] = " "; out[i + 1] = " "; i += 2; }
      continue;
    }
    if (ch === '"') {
      out[i] = " "; i++;
      while (i < text.length) {
        if (text[i] === "\\") { out[i] = " "; out[i + 1] = " "; i += 2; continue; }
        if (text[i] === '"') { out[i] = " "; i++; break; }
        out[i] = text[i] === "\n" ? "\n" : " ";
        i++;
      }
      continue;
    }
    i++;
  }
  return out.join("");
}

// 只压注释、保留字符串：给「代码里是否存在某种写法」这类检查用。
// 注意不能拿 blankOut 来做拼名检查——它把字符串内容一起抹掉了，那条正则永远匹配不上，
// 门禁自身就成了假绿（--selftest 的第 6 个探针就是为钉住这一点而存在的）。
function blankComments(text) {
  const out = text.split("");
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") { out[i] = " "; i++; }
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      out[i] = " "; out[i + 1] = " "; i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) { out[i] = text[i] === "\n" ? "\n" : " "; i++; }
      if (i < text.length) { out[i] = " "; out[i + 1] = " "; i += 2; }
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (i < text.length) {
        if (text[i] === "\\") { i += 2; continue; }
        if (text[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    i++;
  }
  return out.join("");
}

// 分派集：只认 `method == "字面量"` 这一种书写形态。除按名取集外，还要拿「`method ==` 出现次数」
// 与「按名取到的条目数（含重复）」对等——不等即出现了本门禁不认的第几种书写形态（比按名取数
// 更危险的漏取），这跟桌面 IPC 门禁里 handler-count-matches-names 抓单引号形态是同一类反证。
function dispatchSet(hostText) {
  const scannable = blankOut(hostText);
  const occurrences = [...scannable.matchAll(/\bmethod\s*==/g)].length;
  const literals = [...hostText.matchAll(/\bmethod\s*==\s*"([A-Za-z0-9\/\-]+)"/g)];
  return { names: new Set(literals.map((m) => m[1])), occurrences, literals: literals.length };
}

// goal 动词只能从 core 的白名单函数体里取，不在这里手抄一遍——手抄会让门禁和被测面各自漂移。
function goalVerbSet(goalText) {
  const start = goalText.search(/func\s+isGoalControlMethod\s*\(\s*method\s*:\s*String\s*\)\s*:\s*Bool\s*\{/);
  if (start < 0) return { names: null, open: false };
  const bodyStart = goalText.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let i = bodyStart; i < goalText.length; i++) {
    if (goalText[i] === "{") depth++;
    else if (goalText[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return { names: null, open: true };
  const body = goalText.slice(bodyStart + 1, end);
  const names = new Set();
  for (const m of body.matchAll(/method\s*==\s*"([A-Za-z0-9\/\-]+)"/g)) names.add(m[1]);
  const unbalanced = [...body.matchAll(/[{}]/g)].length !== 0;
  return { names, open: true, balanced: !unbalanced };
}

// 声明集：initialize 回帧里 \"capabilities\":[ … ] 的转义引号串。
// 取不到这一段不算「空集合所以通过」，那是本门禁最容易造假绿的形状。
function capabilitySet(hostText) {
  const marker = '\\"capabilities\\":[';
  const at = hostText.indexOf(marker);
  if (at < 0) return { names: null, count: -1 };
  const open = at + marker.length;
  const close = hostText.indexOf("]", open);
  if (close < 0) return { names: null, count: -1 };
  const raw = [...hostText.slice(open, close).matchAll(/\\"([A-Za-z0-9\/\-]+)\\"/g)].map((m) => m[1]);
  return { names: new Set(raw), count: raw.length };
}

function diffOnly(a, b) {
  return [...a].filter((x) => !b.has(x)).sort();
}

function audit(hostText, goalText) {
  const { names: dispatched, occurrences, literals } = dispatchSet(hostText);
  const goal = goalVerbSet(goalText);
  const caps = capabilitySet(hostText);

  check("host-source-scannable", hostText.length > 0 && /\bmain\s*\(args/.test(hostText),
    `源长 ${hostText.length}，入口 main(args) ${/\bmain\s*\(args/.test(hostText) ? "在位" : "缺失——取数不可信"}`);
  check("goal-whitelist-found", goal.names !== null && goal.balanced !== false,
    goal.names === null ? "取不到 isGoalControlMethod 函数体" : `白名单 ${goal.names.size} 个 goal 动词，函数体括号平衡`);
  check("capability-set-found", caps.names !== null && caps.count > 0,
    caps.names === null ? "取不到 capabilities 数组" : `声明面 ${caps.count} 条`);
  check("literal-shape-coverage", occurrences === literals,
    `按名取到 ${literals} 条（含重复），而 \`method ==\` 在去注释去字符串后的源里出现 ${occurrences} 次；不等即出现了本门禁不认的书写形态`);
  check("no-match-dispatch", !/\bmatch\s+method\b/.test(blankOut(hostText)) && !/\bmatch\s*\{/.test(blankOut(hostText)),
    "未出现 match 分派（出现时本门禁的字面量取数集会漏收，必须改取数口径而不是先改代码）");
  check("no-dynamic-method-name", !/\b\w*[Mm]ethod\w*\s*=\s*"[^"]*"\s*\+/.test(blankComments(hostText)),
    "Host 侧没有拼出来的方法名（有即给调用方开了「构造任意动词」通道，封闭字面集不变量破）");

  if (goal.names === null || caps.names === null) {
    check("dispatch-vs-capability-parity", false, "上游取数失败，无法对账");
    check("frozen-denominator", false, "上游取数失败，无法计数");
    check("capability-no-duplicates", false, "上游取数失败，无法查重复");
    return;
  }

  const dispatchedAll = new Set([...dispatched, ...goal.names]);
  const missingDecl = diffOnly(dispatchedAll, caps.names);
  const missingDispatch = diffOnly(caps.names, dispatchedAll);
  check("dispatch-vs-capability-parity", missingDecl.length === 0 && missingDispatch.length === 0,
    missingDecl.length === 0 && missingDispatch.length === 0
      ? `双向差为空（${dispatchedAll.size} 条 = 字面 ${dispatched.size} + goal ${goal.names.size}）`
      : `分派未声明 ${missingDecl.length} 条 [${missingDecl.join(", ")}]；声明未分派 ${missingDispatch.length} 条 [${missingDispatch.join(", ")}]`);
  check("capability-no-duplicates", caps.count === caps.names.size, `声明 ${caps.count} 条，去重后 ${caps.names.size} 条`);
  check("frozen-denominator", caps.count === DENOMINATOR,
    `声明面 ${caps.count} 条，冻结分母 ${DENOMINATOR} 条（改分母要同时改本常量与 p0-interface-freeze §2）`);
}

function report() {
  let fail = 0;
  for (const c of checks) {
    if (!c.ok) fail++;
    console.log(`${c.ok ? "OK  " : "FAIL"} ${c.name}: ${c.detail}`);
  }
  const verdict = fail === 0 ? "PASS" : "FAIL";
  console.log(`GATE: ${verdict} (${checks.length} checks, fail=${fail})`);
  return fail === 0 ? 0 : 1;
}

function readBoth() {
  return {
    host: readFileSync(join(root, HOST), "utf8"),
    goal: readFileSync(join(root, GOAL_CONTROL), "utf8"),
  };
}

// 反证：给每项检查各注入一处只杀它自己的违规。任何一项 MISSED 就是门禁自己在造假绿，
// 必须先修门禁再采信上面的 GATE: PASS。
function selftest() {
  const { host, goal } = readBoth();
  // (探针表见下)
  const probes = [
    ["host-source-scannable", "host", (t) => t.replace(/main\s*\(args/g, "notmain(args")],
    ["goal-whitelist-found", "goal", (t) => t.replace("func isGoalControlMethod(method: String): Bool {", "func isGoalControlMethodRenamed(method: String): Bool {")],
    ["capability-set-found", "host", (t) => t.replace('\\"capabilities\\":[', '\\"capabilitie2\\":[')],
    // 加一处 `method == 变量` 形态：按名取数收不到，但 `method ==` 计数会 +1
    ["literal-shape-coverage", "host", (t) => t.replace('if (method == "initialize") {', 'if (method == someVar) { throw Exception("x") }\n        if (method == "initialize") {')],
    ["no-match-dispatch", "host", (t) => t.replace('if (method == "initialize") {', 'match method { case _ => () }\n        if (method == "initialize") {')],
    ["no-dynamic-method-name", "host", (t) => t.replace('if (method == "initialize") {', 'let dynMethod = "global/settings/set-" + key\n        if (method == "initialize") {')],
    // 少声明一条：分派还在、capabilities 里没有 → 只有 parity 会红（分母同时红，故归因看 parity 名在不在）
    ["dispatch-vs-capability-parity", "host", (t) => t.replace('\\"workspace/files\\",', "")],
    ["frozen-denominator", "host", (t) => t.replace('\\"workspace/files\\",', "")],
    ["capability-no-duplicates", "host", (t) => t.replace('\\"session/flush\\"', '\\"session/flush\\",\\"session/flush\\"')],
  ];
  let missed = 0;
  for (const [target, face, mutate] of probes) {
    checks.length = 0;
    const brokenHost = face === "host" ? mutate(host) : host;
    const brokenGoal = face === "goal" ? mutate(goal) : goal;
    if (brokenHost === host && brokenGoal === goal) {
      console.log(`UNCREDITED ${target} (探针没改动任何字节)`);
      missed++;
      continue;
    }
    try {
      audit(brokenHost, brokenGoal);
    } catch (e) {
      console.log(`MISSED ${target} (门禁执行异常: ${e.message})`);
      missed++;
      continue;
    }
    const hit = checks.filter((c) => !c.ok).map((c) => c.name);
    if (hit.includes(target)) console.log(`CAUGHT ${target} [${face}] -> ${hit.join(",")}`);
    else { console.log(`MISSED ${target} [${face}] -> FAIL 集为 [${hit.join(",")}]`); missed++; }
  }
  checks.length = 0;
  audit(host, goal);
  const baselineGreen = checks.every((c) => c.ok);
  console.log(`SELFTEST: ${missed === 0 && baselineGreen ? "PASS" : "FAIL"} (probes=${probes.length}, missed=${missed}, baseline=${baselineGreen ? "green" : "RED"})`);
  return missed === 0 && baselineGreen ? 0 : 1;
}

const args = process.argv.slice(2);
if (args.includes("--selftest")) process.exitCode = selftest();
else if (args.length) { console.error("用法: node scripts/check_host_method_surface.cjs [--selftest]"); process.exitCode = 2; }
else {
  try {
    const { host, goal } = readBoth();
    audit(host, goal);
  } catch (e) {
    console.log(`GATE: FAIL (取数失败: ${e.message})`);
    process.exitCode = 1;
    checks.length = 0;
  }
  if (checks.length) process.exitCode = report();
}
