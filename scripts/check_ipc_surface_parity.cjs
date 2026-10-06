// 桌面 IPC 面对账：preload 暴露的方法集 与 main.cjs 注册的 sacode: 通道集 必须逐名相等。
// 判据只有结尾 GATE 行与退出码：0 全绿；1 有 FAIL；2 取数错误（不等于通过）。
//
// 为什么要有这条：AGENTS.md 把「preload 里 exposeInMainWorld 的顶层 key」定为 IPC 面唯一权威，
// 但这条不变量此前只是文档说法。实测本仓 main.cjs 的 goal/* 与 busy-send 共 7 个 handler
// 用单引号写通道名，`grep 'ipcMain.handle("sacode:'` 只数得出 60 个，肉眼据此会判出
// 「preload 有 7 个方法没有后端」的假缺口。这里按语法结构取集，不按引号形态猜。
const { readFileSync, readdirSync, statSync } = require("node:fs");
const { join, relative } = require("node:path");

const root = join(__dirname, "..");
const PRELOAD = "apps/desktop/preload.cjs";
const MAIN = "apps/desktop/main.cjs";
const RENDERER = "apps/desktop/renderer";

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
}

// 跳过字符串、模板串与注释，返回把源码压成等长空白后的可扫描副本
// （等长是为了让下标仍能对应回原文，报错时能截出真实片段）。
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
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      out[i] = " "; i++;
      while (i < text.length) {
        if (text[i] === "\\") { out[i] = " "; out[i + 1] = " "; i += 2; continue; }
        if (text[i] === quote) { out[i] = " "; i++; break; }
        out[i] = text[i] === "\n" ? "\n" : " ";
        i++;
      }
      continue;
    }
    i++;
  }
  return out.join("");
}

// 从 exposeInMainWorld("<key>", {…}) 里取出顶层方法名。只认第一个这样的调用，
// 出现第二个就交给 expose-count 那条检查报红。
function preloadSurface(text) {
  const scannable = blankOut(text);
  const call = /\bexposeInMainWorld\s*\(\s*(['"])([^'"]+)\1\s*,\s*\{/g.exec(text);
  if (!call) return { keys: [], namespaces: [], objectStart: -1 };
  const namespaces = [...text.matchAll(/\bexposeInMainWorld\s*\(\s*(['"])([^'"]+)\1/g)].map((m) => m[2]);
  // 从对象字面量的 { 开始按花括号深度扫；深度 0 处遇到的 `identifier:` 才是顶层键。
  const openAt = call.index + call[0].length - 1;
  const keys = [];
  let depth = 0;
  for (let i = openAt; i < scannable.length; i++) {
    const ch = scannable[i];
    if (ch === "{") { depth++; continue; }
    if (ch === "}") { depth--; if (depth === 0) break; continue; }
    if (depth !== 1) continue;
    const m = /^([A-Za-z_$][\w$]*)\s*:/.exec(scannable.slice(i));
    if (!m) continue;
    // 只收顶层键：跳过空白后，上一个非空白字符必须是 { 或 ,
    // （注释被压成空白，所以键前隔着注释行也算顶层——实测漏掉 7 个就是这么来的）
    let back = i - 1;
    while (back > openAt && /\s/.test(scannable[back])) back--;
    if (back < openAt) continue;
    if (scannable[back] !== "," && scannable[back] !== "{") continue;
    keys.push(m[1]);
    i += m[0].length - 1;
  }
  return { keys, namespaces, objectStart: openAt };
}

function mainSurface(text) {
  const scannable = blankOut(text);
  const total = [...scannable.matchAll(/\bipcMain\.handle\s*\(/g)].length;
  const names = [...text.matchAll(/\bipcMain\.handle\s*\(\s*(['"])sacode:([^'"]+)\1/g)].map((m) => m[2]);
  const otherPrefix = [...text.matchAll(/\bipcMain\.handle\s*\(\s*(['"])([^'"]+)\1/g)]
    .map((m) => m[2]).filter((n) => !n.startsWith("sacode:"));
  return { total, names, otherPrefix };
}

function audit(preloadText, mainText) {
  const preload = preloadSurface(preloadText);
  const main = mainSurface(mainText);

  check("expose-single-namespace", preload.namespaces.length === 1,
    `exposeInMainWorld 调用 ${preload.namespaces.length} 次，命名空间 [${preload.namespaces}]`);
  check("preload-keys-found", preload.keys.length > 0,
    `取到 ${preload.keys.length} 个顶层方法`);
  check("ipc-main-registered", main.total > 0, `ipcMain.handle 出现 ${main.total} 次`);
  // 每个 handle( 都必须被按名取到，否则说明有第四种书写形态把通道名藏起来了
  check("handler-count-matches-names", main.total === main.names.length,
    `handle( 共 ${main.total} 处，按名取到 ${main.names.length} 个（差值即未被取到的书写形态）`);
  check("channels-prefixed", main.otherPrefix.length === 0,
    main.otherPrefix.length ? `非 sacode: 前缀通道 [${main.otherPrefix}]` : "全部通道都在 sacode: 前缀下");

  const dupP = duplicated(preload.keys);
  const dupM = duplicated(main.names);
  check("no-duplicate-names", dupP.length === 0 && dupM.length === 0,
    `preload 重名 [${dupP}]、main 重名 [${dupM}]`);

  const setP = new Set(preload.keys);
  const setM = new Set(main.names);
  const onlyP = [...setP].filter((k) => !setM.has(k));
  const onlyM = [...setM].filter((k) => !setP.has(k));
  check("surface-set-parity", onlyP.length === 0 && onlyM.length === 0,
    onlyP.length || onlyM.length
      ? `只在 preload: [${onlyP}]；只在 main: [${onlyM}]`
      : `preload ${setP.size} 个方法 ↔ main ${setM.size} 个通道，双向差集为空`);

  console.log(`分母：preload 方法 ${preload.keys.length}，main 通道 ${main.names.length}，ipcMain.handle 字面 ${main.total}`);
  return { onlyP, onlyM, count: setP.size };
}

function duplicated(list) {
  const seen = new Set();
  const dup = new Set();
  for (const item of list) { if (seen.has(item)) dup.add(item); seen.add(item); }
  return [...dup];
}

function report() {
  const failed = checks.filter((c) => !c.ok);
  for (const c of checks) console.log(`${c.ok ? "OK  " : "FAIL"} ${c.name}: ${c.detail}`);
  console.log(`GATE: ${failed.length ? "FAIL" : "PASS"} (${checks.length} checks, fail=${failed.length})`);
  return failed.length ? 1 : 0;
}

// 反证：每项检查各注入一处只有它能杀的违规，要求该项名字新出现在 FAIL 集里。
// face 必须写对——上一版探针把改过的 main 当 preload 传进去，preload 侧全红、
// main 侧四项静默 MISSED，正是门禁自己造假绿的形状。
function selftest() {
  const preload = readFileSync(join(root, PRELOAD), "utf8");
  const main = readFileSync(join(root, MAIN), "utf8");
  const firstMethod = preloadSurface(preload).keys[0];
  const probes = [
    ["expose-single-namespace", "preload", (t) => t.replace("contextBridge.exposeInMainWorld(",
      'contextBridge.exposeInMainWorld("other", {});\ncontextBridge.exposeInMainWorld(')],
    ["preload-keys-found", "preload", (t) => t.replace("contextBridge.exposeInMainWorld(", "contextBridge.exposeInMainWorld_disabled(")],
    ["ipc-main-registered", "main", (t) => t.replace(/ipcMain\.handle\(/g, "ipcMain.register(")],
    // 换成反引号书写：handle( 计数不变，但按名的正则只认成对引号，取不到名字
    ["handler-count-matches-names", "main", (t) => t.replace("ipcMain.handle('sacode:goalCreate'", "ipcMain.handle(`sacode:goalCreate`")],
    ["channels-prefixed", "main", (t) => t.replace('ipcMain.handle("sacode:projection"', 'ipcMain.handle("other:projection"')],
    ["no-duplicate-names", "main", (t) => t.replace("ipcMain.handle('sacode:goalCreate'", "ipcMain.handle('sacode:goalDescribe'")],
    ["surface-set-parity", "preload", (t) => t.replace(`${firstMethod}:`, `${firstMethod}Renamed:`)],
  ];
  let missed = 0;
  for (const [target, face, mutate] of probes) {
    checks.length = 0;
    const brokenPreload = face === "preload" ? mutate(preload) : preload;
    const brokenMain = face === "main" ? mutate(main) : main;
    try {
      audit(brokenPreload, brokenMain);
    } catch (e) {
      console.log(`MISSED ${target} (门禁执行异常: ${e.message})`); missed++; continue;
    }
    const hit = checks.filter((c) => !c.ok).map((c) => c.name);
    if (hit.includes(target)) console.log(`CAUGHT ${target} [${face}] -> ${hit.join(",")}`);
    else { console.log(`MISSED ${target} [${face}] -> FAIL 集为 [${hit.join(",")}]`); missed++; }
  }
  checks.length = 0;
  audit(preload, main);
  const baselineGreen = checks.every((c) => c.ok);
  console.log(`SELFTEST: ${missed === 0 && baselineGreen ? "PASS" : "FAIL"} (probes=${probes.length}, missed=${missed}, baseline=${baselineGreen ? "green" : "RED"})`);
  return missed === 0 && baselineGreen ? 0 : 1;
}

// 消费者登记（REGISTER，不是门禁）：逐 preload 方法统计渲染层引用点。
//
// 匹配刻意放宽到「任意位置出现该方法名 token」，而不是只认 window.sacode.<name>：
// 实测消费形态至少有 window.sacode.x、const api = window.sacode; api.x（vendor 里两个组件）、
// 以及折叠前 .ts 源里的对象键/字符串通道名。只认点号形态会把 customsDescribe 这类
// 真实有消费者的通道报成零调用——这是假缺口，比漏报死通道更贵。
// 所以这里的不对称是：非零只说明「有引用」，零才说明「渲染层完全没提到」。
function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|mjs|ts|html)$/.test(name)) out.push(p);
  }
  return out;
}

function consumers() {
  const preloadText = readFileSync(join(root, PRELOAD), "utf8");
  const keys = preloadSurface(preloadText).keys;
  if (!keys.length) { console.log("REGISTER: FAIL (取不到 preload 方法集)"); return 1; }
  const files = walk(join(root, RENDERER), []);
  const vendorPresent = files.some((f) => /[\\/]vendor[\\/]/.test(f));
  const texts = files.map((f) => ({ f: relative(root, f).replace(/\\/g, "/"), text: readFileSync(f, "utf8") }));
  const rows = [];
  for (const key of keys) {
    const hits = [];
    for (const item of texts) {
      const n = [...item.text.matchAll(new RegExp(`\\b${key}\\b`, "g"))].length;
      if (n > 0) hits.push({ f: item.f, n });
    }
    hits.sort((a, b) => b.n - a.n);
    rows.push({ key, total: hits.reduce((s, h) => s + h.n, 0), files: hits.map((h) => h.f) });
  }
  const unused = rows.filter((r) => r.total === 0).map((r) => r.key);
  for (const r of rows) console.log(`CONSUMER ${r.key} ${r.total} ${r.files.join(" ")}`);
  console.log(`分母：preload 方法 ${keys.length}，渲染层源文件 ${files.length}（vendor ${vendorPresent ? "在位" : "缺失——构建产物未折叠，引用计数会偏高"}）`);
  console.log(`REGISTER: ${rows.length - unused.length}/${keys.length} 有渲染层引用；零引用 ${unused.length} 条 [${unused.join(", ")}]`);
  return 0;
}

const args = process.argv.slice(2);
if (args.includes("--selftest")) process.exitCode = selftest();
else if (args.includes("--consumers")) process.exitCode = consumers();
else if (args.length) { console.error("用法: node scripts/check_ipc_surface_parity.cjs [--selftest|--consumers]"); process.exitCode = 2; }
else {
  try {
    audit(readFileSync(join(root, PRELOAD), "utf8"), readFileSync(join(root, MAIN), "utf8"));
  } catch (e) {
    console.log(`GATE: FAIL (取数失败: ${e.message})`);
    process.exitCode = 1;
  }
  if (checks.length) process.exitCode = report();
}
