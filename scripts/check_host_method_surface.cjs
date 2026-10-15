// Host 方法面对账：入口内联分派 + 被入口调用的封闭路由谓词，与 initialize 的 capabilities 声明集逐名相等，
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
// 2026-10-06 的 82 条是历史冻结读数，不能再拿它当当前分母。当前提交基线
// 46623c4a1eb0f91303359c0de792fcaf0f57db38 经同一闭集口径复核为 169 条；详见
// docs/evidence/2026-10-16-gate-triad-repair.md。工作区可能有合法的未提交接口增量，故冻结分母
// 只校验 HEAD 的声明集；当前源码仍须保留 HEAD 的全部能力，且路由与声明双向完全一致。
// 分拆路由的精确闭集来自下列实际被 main 调用的谓词/handles，而不是从全仓 method 比较式。
// 提交新增接口时再审阅并更新冻结分母及证据，不让工作区总量变化掩盖漏路由、漏声明或删旧接口。
const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");
const HOST = "apps/host/src/main.cj";
const GOAL_CONTROL = "core/src/goal_control.cj";
const ROUTE_PREDICATES = [
  { file: "apps/host/src/acp_runtime_rpc.cj", signature: /func\s+isAcpProductMethod\s*\(\s*method\s*:\s*String\s*\)\s*:\s*Bool\s*\{/ },
  { file: "apps/host/src/page_tool_rpc.cj", signature: /func\s+isPageToolMethod\s*\(\s*method\s*:\s*String\s*\)\s*:\s*Bool\s*\{/ },
  { file: "apps/host/src/worktree_rpc.cj", signature: /func\s+isWorktreeMethod\s*\(\s*method\s*:\s*String\s*\)\s*:\s*Bool\s*\{/ },
  { file: "apps/host/src/tips_surface.cj", signature: /func\s+isTipsMethod\s*\(\s*method\s*:\s*String\s*\)\s*:\s*Bool\s*\{/ },
  { file: "apps/host/src/team_runtime.cj", signature: /public\s+static\s+func\s+accepts\s*\(\s*method\s*:\s*String\s*\)\s*:\s*Bool\s*\{/ },
  { file: "core/src/acp_runtime_api.cj", signature: /public\s+static\s+func\s+handles\s*\(\s*method\s*:\s*String\s*\)\s*:\s*Bool\s*\{/ },
  { file: "core/src/acp_history.cj", signature: /public\s+static\s+func\s+handles\s*\(\s*method\s*:\s*String\s*\)\s*:\s*Bool\s*\{/ },
  { file: "core/src/execution_api.cj", signature: /public\s+static\s+func\s+handles\s*\(\s*method\s*:\s*String\s*\)\s*:\s*Bool\s*\{/ },
];
const DENOMINATOR = 169;

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
  const literals = [...hostText.matchAll(/\bmethod\s*==\s*"([A-Za-z0-9\/\-]+)"/g)]
    .filter((match) => /\bmethod\s*==\s*$/.test(scannable.slice(match.index, match.index + match[0].indexOf('"'))));
  return { names: new Set(literals.map((m) => m[1])), occurrences, literals: literals.length };
}

function predicateSet(text, signature) {
  const scanned = blankOut(text);
  const match = signature.exec(scanned);
  if (!match) return { names: new Set(), found: false, occurrences: 0, literals: 0 };
  const bodyStart = scanned.indexOf("{", match.index);
  let depth = 0;
  let end = -1;
  for (let i = bodyStart; i < scanned.length; i++) {
    if (scanned[i] === "{") depth++;
    else if (scanned[i] === "}" && --depth === 0) { end = i; break; }
  }
  if (end < 0) return { names: new Set(), found: false, occurrences: 0, literals: 0 };
  const body = text.slice(bodyStart + 1, end);
  const bodyScanned = blankOut(body);
  const occurrences = [...bodyScanned.matchAll(/\bmethod\s*==/g)].length;
  const literals = [...body.matchAll(/\bmethod\s*==\s*"([A-Za-z0-9\/\-]+)"/g)]
    .filter((item) => /\bmethod\s*==\s*$/.test(bodyScanned.slice(item.index, item.index + item[0].indexOf('"'))));
  return { names: new Set(literals.map((item) => item[1])), found: true, occurrences, literals: literals.length };
}

function routeSet(hostText, routeTexts) {
  const direct = dispatchSet(hostText);
  const names = new Set(direct.names);
  const missingSources = [];
  let predicateOccurrences = 0;
  let predicateLiterals = 0;
  for (const route of ROUTE_PREDICATES) {
    const text = routeTexts.get(route.file);
    if (text === undefined) { missingSources.push(`${route.file} (文件缺失)`); continue; }
    const extracted = predicateSet(text, route.signature);
    if (!extracted.found) { missingSources.push(`${route.file} (闭集函数未找到)`); continue; }
    predicateOccurrences += extracted.occurrences;
    predicateLiterals += extracted.literals;
    for (const name of extracted.names) names.add(name);
  }
  return { names, direct, missingSources, predicateOccurrences, predicateLiterals };
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

function audit(hostText, goalText, routeTexts, baselineCapabilities) {
  const { names: dispatched, direct, missingSources, predicateOccurrences, predicateLiterals } = routeSet(hostText, routeTexts);
  const goal = goalVerbSet(goalText);
  const caps = capabilitySet(hostText);

  check("host-source-scannable", hostText.length > 0 && /\bmain\s*\(\s*\)/.test(hostText),
    `源长 ${hostText.length}，入口 main() ${/\bmain\s*\(\s*\)/.test(hostText) ? "在位" : "缺失——取数不可信"}`);
  check("goal-whitelist-found", goal.names !== null && goal.balanced !== false,
    goal.names === null ? "取不到 isGoalControlMethod 函数体" : `白名单 ${goal.names.size} 个 goal 动词，函数体括号平衡`);
  check("capability-set-found", caps.names !== null && caps.count > 0,
    caps.names === null ? "取不到 capabilities 数组" : `声明面 ${caps.count} 条`);
  check("literal-shape-coverage", direct.occurrences === direct.literals && predicateOccurrences === predicateLiterals,
    `入口按名 ${direct.literals}/${direct.occurrences}；闭集路由谓词按名 ${predicateLiterals}/${predicateOccurrences}`);
  const routeSourceTexts = [hostText, ...routeTexts.values()];
  check("route-predicates-found", missingSources.length === 0,
    missingSources.length ? `未能读取或识别闭集路由 [${missingSources.join(", ")}]` : `入口外 ${ROUTE_PREDICATES.length} 个实际路由谓词均可扫描`);
  check("no-match-dispatch", routeSourceTexts.every((text) => !/\bmatch\s+method\b/.test(blankOut(text)) && !/\bmatch\s*\{/.test(blankOut(text))),
    "分派入口与闭集路由中未出现会绕过字面量扫描的 match 分派");
  check("no-dynamic-method-name", routeSourceTexts.every((text) => !/\b\w*[Mm]ethod\w*\s*=\s*"[^"]*"\s*\+/.test(blankComments(text))),
    "Host 分派与闭集路由没有拼接方法名");

  if (goal.names === null || caps.names === null) {
    check("dispatch-vs-capability-parity", false, "上游取数失败，无法对账");
    check("frozen-denominator", false, "上游取数失败，无法计数");
    check("baseline-capabilities-preserved", false, "上游取数失败，无法核对 HEAD 能力是否保留");
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
  const baselineNames = baselineCapabilities && baselineCapabilities.names;
  const baselineMissing = baselineNames ? diffOnly(baselineNames, caps.names) : [];
  check("baseline-capabilities-preserved", baselineNames instanceof Set && baselineMissing.length === 0,
    baselineNames instanceof Set
      ? baselineMissing.length === 0
        ? `HEAD 的 ${baselineNames.size} 条能力全部保留；工作区声明 ${caps.count} 条`
        : `工作区移除了 HEAD 已有能力 [${baselineMissing.join(", ")}]`
      : "无法读取 HEAD 的冻结能力集");
  const baselineCount = baselineCapabilities ? baselineCapabilities.count : -1;
  check("frozen-denominator", baselineCount === DENOMINATOR,
    `HEAD 声明面 ${baselineCount} 条，当前提交基线分母 ${DENOMINATOR} 条（提交新增接口后再审阅并更新证据）`);
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
  const routeTexts = new Map();
  for (const route of ROUTE_PREDICATES) routeTexts.set(route.file, readFileSync(join(root, route.file), "utf8"));
  const committedHost = execFileSync("git", ["show", `HEAD:${HOST}`], {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
  });
  return {
    host: readFileSync(join(root, HOST), "utf8"),
    goal: readFileSync(join(root, GOAL_CONTROL), "utf8"),
    routeTexts,
    baselineCapabilities: capabilitySet(committedHost),
  };
}

// 反证：每项检查都注入一处明确违规，并要求目标判据出现 FAIL。下游差异判据可连带变红；
// 任何目标判据 MISSED 就是门禁自己在造假绿，必须先修门禁再采信上面的 GATE: PASS。
function selftest() {
  const { host, goal, routeTexts, baselineCapabilities } = readBoth();
  const routeProbeFile = "apps/host/src/tips_surface.cj";
  const probes = [
    ["host-source-scannable", "host", (t) => t.replace(/main\s*\(\s*\)/g, "notmain()")],
    ["goal-whitelist-found", "goal", (t) => t.replace("func isGoalControlMethod(method: String): Bool {", "func isGoalControlMethodRenamed(method: String): Bool {")],
    ["capability-set-found", "host", (t) => t.replace('\\"capabilities\\":[', '\\"capabilitie2\\":[')],
    // 加一处 `method == 变量` 形态：按名取数收不到，但 `method ==` 计数会 +1
    ["literal-shape-coverage", "host", (t) => t.replace('if (method == "initialize") {', 'if (method == someVar) { throw Exception("x") }\n        if (method == "initialize") {')],
    ["no-match-dispatch", "host", (t) => t.replace('if (method == "initialize") {', 'match method { case _ => () }\n        if (method == "initialize") {')],
    ["no-dynamic-method-name", "host", (t) => t.replace('if (method == "initialize") {', 'let dynMethod = "global/settings/set-" + key\n        if (method == "initialize") {')],
    // 少声明一条：分派还在、capabilities 里没有 → 只有 parity 会红（分母同时红，故归因看 parity 名在不在）
    ["dispatch-vs-capability-parity", "host", (t) => t.replace('\\"workspace/files\\",', "")],
    ["dispatch-vs-capability-parity", "route", (t) => t.replace('method == "tips/get"', 'method == "tips/get-unregistered"')],
    ["frozen-denominator", "baseline", (value) => ({ ...value, count: value.count - 1 })],
    ["baseline-capabilities-preserved", "host", (t) => t.replace('\\"workspace/files\\",', "")],
    ["capability-no-duplicates", "host", (t) => t.replace('\\"session/flush\\"', '\\"session/flush\\",\\"session/flush\\"')],
    ["route-predicates-found", "route", (t) => t.replace("func isTipsMethod(", "func isTipsMethodRenamed(")],
    ["literal-shape-coverage", "route", (t) => t.replace('method == "tips/get"', "method == dynamicTipMethod")],
  ];
  let missed = 0;
  for (const [target, face, mutate] of probes) {
    checks.length = 0;
    const brokenHost = face === "host" ? mutate(host) : host;
    const brokenGoal = face === "goal" ? mutate(goal) : goal;
    const brokenBaseline = face === "baseline" ? mutate(baselineCapabilities) : baselineCapabilities;
    const brokenRoutes = new Map(routeTexts);
    if (face === "route") brokenRoutes.set(routeProbeFile, mutate(routeTexts.get(routeProbeFile)));
    const routesChanged = [...brokenRoutes].some(([file, text]) => text !== routeTexts.get(file));
    if (brokenHost === host && brokenGoal === goal && !routesChanged && brokenBaseline === baselineCapabilities) {
      console.log(`UNCREDITED ${target} (探针没改动任何字节)`);
      missed++;
      continue;
    }
    try {
      audit(brokenHost, brokenGoal, brokenRoutes, brokenBaseline);
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
  audit(host, goal, routeTexts, baselineCapabilities);
  const baselineGreen = checks.every((c) => c.ok);
  console.log(`SELFTEST: ${missed === 0 && baselineGreen ? "PASS" : "FAIL"} (probes=${probes.length}, missed=${missed}, baseline=${baselineGreen ? "green" : "RED"})`);
  return missed === 0 && baselineGreen ? 0 : 1;
}

const args = process.argv.slice(2);
if (args.includes("--selftest")) process.exitCode = selftest();
else if (args.length) { console.error("用法: node scripts/check_host_method_surface.cjs [--selftest]"); process.exitCode = 2; }
else {
  try {
    const { host, goal, routeTexts, baselineCapabilities } = readBoth();
    audit(host, goal, routeTexts, baselineCapabilities);
  } catch (e) {
    console.log(`GATE: FAIL (取数失败: ${e.message})`);
    process.exitCode = 1;
    checks.length = 0;
  }
  if (checks.length) process.exitCode = report();
}
