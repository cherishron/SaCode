// W00 路径所有权表门禁：解析 docs/plans/w00-path-ownership-and-isolation-2026-10-06.md 的
// 所有权表，机械断言「主责不重叠」与「公共入口只有 A 能改」。
// 判据只有结尾 GATE 行与退出码：0 全绿；1 有 FAIL；2 取数错误（不等于通过）。
//
// 为什么门禁读文档而不是自带一份表：计划明令「优先复用现有真源，不新建重复真源」。
// 表与判据分家的那一刻起，漂移就不可检出。
const { readFileSync, existsSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");
const DOC = "docs/plans/w00-path-ownership-and-isolation-2026-10-06.md";

const MEMBERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];
const PACKAGES = ["W00", "W10", "W20", "W30", "W40", "W50", "W60", "W70", "W80", "W90"];
const TYPES = ["file", "dir"];
// 计划里点名的公共入口：这些路径的主责必须是 A
const PUBLIC_ENTRIES = [
  "apps/host/src/main.cj",
  "apps/cli/src/main.cj",
  "apps/desktop/main.cjs",
  "apps/desktop/preload.cjs",
  "apps/desktop/renderer/app.js",
  "apps/desktop/package.json",
  "apps/desktop/package-lock.json",
  "scripts/pack-pages.mjs",
];
const REQUIRED_SECTIONS = [
  "## 1. 路径所有权表",
  "## 2. 归属规则",
  "## 3. 串行资源",
  "## 4. 当前冲突队列",
  "## 5. 隔离工作安排",
];

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
}

function cellsOf(line) {
  const text = line.trim();
  if (!text.startsWith("|") || !text.endsWith("|")) return null;
  const cells = [];
  let current = "";
  let code = false;
  for (let i = 1; i < text.length - 1; i++) {
    const ch = text[i];
    if (ch === "`") { code = !code; current += ch; continue; }
    if (ch === "\\" && text[i + 1] === "|") { current += "|"; i++; continue; }
    if (ch === "|" && !code) { cells.push(current.trim()); current = ""; continue; }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function isSeparator(cells) {
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

function findOwnershipTable(lines) {
  const header = "| 成员 | 工作包 | 类型 | 路径 |";
  const hIndex = lines.findIndex((l) => l.trim() === header);
  if (hIndex === -1) return null;
  if (hIndex + 1 >= lines.length || !isSeparator(cellsOf(lines[hIndex + 1]) || [])) return null;
  const rows = [];
  for (let i = hIndex + 2; i < lines.length; i++) {
    const cells = cellsOf(lines[i]);
    if (!cells) break;
    if (isSeparator(cells)) continue;
    rows.push({ cells, line: i + 1 });
  }
  return { rows, headerLine: hIndex + 1 };
}

function audit(docText) {
  const lines = docText.split(/\r?\n/);
  const table = findOwnershipTable(lines);
  check("ownership-table-found", table !== null,
    table ? `表头行 ${table.headerLine}` : "未找到「| 成员 | 工作包 | 类型 | 路径 |」且紧跟分隔行的表");
  if (!table) return;
  const badWidth = table.rows.filter((r) => r.cells.length !== 4);
  check("row-column-count", badWidth.length === 0,
    badWidth.length ? `第 ${badWidth.map((r) => r.line).join(",")} 行不是 4 列` : `每行恰 4 列（${table.rows.length} 行）`);

  const rows = table.rows.map((r) => ({
    line: r.line,
    // 补齐到 4 列：列数不等由上面的 row-column-count 报红，不能让后面的检查取到 undefined 崩掉
    cells: [0, 1, 2, 3].map((i) => r.cells[i] === undefined ? "" : r.cells[i]),
  }));

  const badMember = rows.filter((r) => !MEMBERS.includes(r.cells[0]));
  check("member-valid", badMember.length === 0,
    badMember.length ? `非法成员: ${badMember.map((r) => `${r.cells[0]}@${r.line}`).join(",")}` : "成员取值在九成员内");

  const badPkg = rows.filter((r) => !PACKAGES.includes(r.cells[1]));
  check("package-valid", badPkg.length === 0,
    badPkg.length ? `非法工作包: ${badPkg.map((r) => `${r.cells[1]}@${r.line}`).join(",")}` : `工作包取值在 ${PACKAGES[0]}..${PACKAGES[PACKAGES.length - 1]} 内`);

  const badType = rows.filter((r) => !TYPES.includes(r.cells[2]));
  check("type-valid", badType.length === 0,
    badType.length ? `非法类型: ${badType.map((r) => `${r.cells[2]}@${r.line}`).join(",")}` : "类型取值只能是 file/dir（不支持 glob，前缀比对才有意义）");

  const badPath = rows.filter((r) => {
    const p = r.cells[3];
    return !p || p.startsWith("/") || p.includes("\\") || p.includes("..") || /[*?[\]{}]/.test(p);
  });
  check("path-normalized", badPath.length === 0,
    badPath.length ? `非规范路径: ${badPath.map((r) => `${r.cells[3] || "(空)"}@${r.line}`).join(",")}` : "路径为仓内相对、正斜杠、无 .. 与通配");

  const byPath = new Map();
  for (const r of rows) {
    if (!byPath.has(r.cells[3])) byPath.set(r.cells[3], []);
    byPath.get(r.cells[3]).push(r);
  }
  const dup = [...byPath].filter(([, list]) => list.length > 1);
  check("path-unique", dup.length === 0,
    dup.length ? `重复归属: ${dup.map(([p, list]) => `${p}(行 ${list.map((r) => r.line)})`).join(" ")}` : "每条路径至多一行");

  // dir 行不得套住别的成员的行——这是「主责不重叠」的机械形态
  const dirRows = rows.filter((r) => r.cells[2] === "dir");
  const overlaps = [];
  for (const d of dirRows) {
    const prefix = d.cells[3].endsWith("/") ? d.cells[3] : `${d.cells[3]}/`;
    for (const r of rows) {
      if (r === d) continue;
      if (r.cells[0] !== d.cells[0] && (r.cells[3] === prefix.slice(0, -1) || r.cells[3].startsWith(prefix))) {
        overlaps.push(`${prefix}(${d.cells[0]}) 套住 ${r.cells[3]}(${r.cells[0]})`);
      }
    }
  }
  check("no-dir-owns-other-member", overlaps.length === 0,
    overlaps.length ? overlaps.join("；") : `${dirRows.length} 条 dir 行均未套住他人路径`);

  const missing = MEMBERS.filter((m) => !rows.some((r) => r.cells[0] === m));
  check("all-nine-members", missing.length === 0,
    missing.length ? `缺成员: ${missing.join(",")}` : "九成员全部有归属行");

  const publicViolations = PUBLIC_ENTRIES
    .map((p) => ({ p, row: byPath.get(p) ? byPath.get(p)[0] : null }))
    .filter((x) => x.row === null || x.row.cells[0] !== "A");
  check("public-entry-owned-by-a", publicViolations.length === 0,
    publicViolations.length
      ? `公共入口缺主责或主责非 A: ${publicViolations.map((x) => `${x.p}${x.row ? `=${x.row.cells[0]}` : "=无行"}`).join(" ")}`
      : `${PUBLIC_ENTRIES.length} 条公共入口全部归 A`);

  const scriptsRows = rows.filter((r) => r.cells[3] === "scripts/" || r.cells[3].startsWith("scripts/"));
  const badScripts = scriptsRows.filter((r) => r.cells[0] !== "A");
  check("scripts-owned-by-a", badScripts.length === 0,
    badScripts.length ? `scripts 下非 A 主责: ${badScripts.map((r) => `${r.cells[3]}=${r.cells[0]}`).join(",")}` : `scripts 的 ${scriptsRows.length} 行全部归 A`);

  const missingSections = REQUIRED_SECTIONS.filter((s) => !docText.includes(s));
  check("doc-sections-present", missingSections.length === 0,
    missingSections.length ? `缺章节: ${missingSections.join(" | ")}` : `${REQUIRED_SECTIONS.length} 个必需章节齐全`);

  const absent = [...byPath.keys()].filter((p) => !existsSync(join(root, p.replace(/\/$/, ""))));
  console.log(`分母：归属行 ${rows.length}（dir ${dirRows.length}）、公共入口 ${PUBLIC_ENTRIES.length} 条`);
  console.log(`登记：${absent.length}/${byPath.size} 条路径当前仓库里还不存在（规划行，不算失败）${absent.length ? `：${absent.join(" ")}` : ""}`);
}

function report() {
  const failed = checks.filter((c) => !c.ok);
  for (const c of checks) console.log(`${c.ok ? "OK  " : "FAIL"} ${c.name}: ${c.detail}`);
  console.log(`GATE: ${failed.length ? "FAIL" : "PASS"} (${checks.length} checks, fail=${failed.length})`);
  return failed.length ? 1 : 0;
}

// 反证：每项检查各注入一处只有它能杀的违规，要求该项名字新出现在 FAIL 集里。
function selftest() {
  const doc = readFileSync(join(root, DOC), "utf8");
  const probes = [
    ["ownership-table-found", (t) => t.replace("| 成员 | 工作包 | 类型 | 路径 |", "| 成员 | 工作包 | 类型 |")],
    ["row-column-count", (t) => t.replace("| B | W10 | file | core/src/session.cj |", "| B | W10 | file |")],
    ["member-valid", (t) => t.replace("| B | W10 | file | core/src/lease.cj |", "| Z | W10 | file | core/src/lease.cj |")],
    ["package-valid", (t) => t.replace("| B | W10 | file | core/src/lease_test.cj |", "| B | W99 | file | core/src/lease_test.cj |")],
    ["type-valid", (t) => t.replace("| B | W10 | file | core/src/attachment.cj |", "| B | W10 | glob | core/src/attachment.cj |")],
    ["path-normalized", (t) => t.replace("| C | W20 | file | core/src/ext.cj |", "| C | W20 | file | core\\src\\ext.cj |")],
    ["path-unique", (t) => t.replace("| D | W30 | file | core/src/ledger.cj |",
      "| D | W30 | file | core/src/ledger.cj |\n| D | W30 | file | core/src/ledger.cj |")],
    ["no-dir-owns-other-member", (t) => t.replace("| B | W10 | file | core/src/session.cj |",
      "| B | W10 | file | core/src/session.cj |\n| H | W70 | dir | core/src/ |")],
    ["all-nine-members", (t) => t.replace("| I | W80 | dir | docs/qa/ |", "| A | W80 | dir | docs/qa/ |")],
    ["public-entry-owned-by-a", (t) => t.replace("| A | W90 | file | apps/desktop/main.cjs |", "| E | W90 | file | apps/desktop/main.cjs |")],
    ["scripts-owned-by-a", (t) => t.replace("| A | W00 | dir | scripts/ |", "| G | W00 | dir | scripts/ |")],
    // 用「三」替换「3」而不是把 ## 变成 ###：后者仍含 "## 3. …" 子串，探针等于没测
    ["doc-sections-present", (t) => t.replace("## 3. 串行资源", "## 三. 串行资源")],
  ];
  let missed = 0;
  for (const [target, mutate] of probes) {
    checks.length = 0;
    const broken = mutate(doc);
    if (broken === doc) { console.log(`MISSED ${target} (探针未改动原文，等于没测)`); missed++; continue; }
    try {
      audit(broken);
    } catch (e) {
      console.log(`MISSED ${target} (门禁执行异常: ${e.message})`); missed++; continue;
    }
    const hit = checks.filter((c) => !c.ok).map((c) => c.name);
    if (hit.includes(target)) console.log(`CAUGHT ${target} -> ${hit.join(",")}`);
    else { console.log(`MISSED ${target} -> FAIL 集为 [${hit.join(",")}]`); missed++; }
  }
  checks.length = 0;
  audit(doc);
  const baselineGreen = checks.every((c) => c.ok);
  console.log(`SELFTEST: ${missed === 0 && baselineGreen ? "PASS" : "FAIL"} (probes=${probes.length}, missed=${missed}, baseline=${baselineGreen ? "green" : "RED"})`);
  return missed === 0 && baselineGreen ? 0 : 1;
}

const args = process.argv.slice(2);
if (args.includes("--selftest")) process.exitCode = selftest();
else if (args.length) { console.error("用法: node scripts/check_path_ownership.cjs [--selftest]"); process.exitCode = 2; }
else {
  try {
    audit(readFileSync(join(root, DOC), "utf8"));
  } catch (e) {
    console.log(`GATE: FAIL (取数失败: ${e.message})`);
    process.exitCode = 1;
  }
  if (checks.length) process.exitCode = report();
}
