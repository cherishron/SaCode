// P0 责任映射门禁：机械复核「63 子系统 + 54 冻结包」两本账的责任列与现值计数。
// 判据只有结尾 GATE 行与退出码：0 全绿、1 有 FAIL、2 取数/用法错误（不等于通过）。
//
// 用法：
//   node scripts/check_p0_ownership.cjs              复核工作区两本账
//   node scripts/check_p0_ownership.cjs --selftest   给每项检查各注入一处违规，反证门禁真的在跑
//
// 三条实测踩过的假红/假绿线，这里都按字面钉住：
// 1) 列必须按表头名定位。按下标取「状态列」实测造出过「64 行全达标」——当时第 2 列是 zh。
// 2) 备注列里有 `a | b` 形态的代码片段，朴素 split("|") 会把一行拆成十几列，主责读到备注正文。
// 3) 文档里同一件事有多处「机械复算」历史快照（12/51、10/53、9/54 各一批），
//    拿任意一处对账都会把当日快照当成现值，所以现值只认带门禁锚点的那一行。
const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");
const MATRIX = "docs/plans/dsh-capability-matrix.md";
const FRONTEND = "docs/plans/dsh-frontend-acceptance.md";
const CANON = "表体计数（门禁 check_p0_ownership 机械复算，唯一现值口径）";
// 责任列是在 6cc063a 加进来的；对账基线取它的前一版，证明加列本身没吞行、没加行、没改名。
const OWNER_COLUMN_COMMIT = "6cc063a^";

const MEMBERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];
// 成员 ↔ 工作包是唯一映射；A 的 W00/W90 是集成与交付接线，不占业务行，I 独立验收同样不占。
const MEMBER_PACKAGE = { B: "W10", C: "W20", D: "W30", E: "W40", F: "W50", G: "W60", H: "W70" };
const PACKAGES = Object.values(MEMBER_PACKAGE);
const STATES = ["✔", "◐", "☐"];

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

function findTable(lines, headerNames) {
  for (let i = 0; i < lines.length; i++) {
    const cells = cellsOf(lines[i]);
    if (!cells) continue;
    if (!headerNames.every((name) => cells.includes(name))) continue;
    const columns = {};
    cells.forEach((name, index) => { if (name) columns[name] = index; });
    const rows = [];
    for (let j = i + 1; j < lines.length; j++) {
      const row = cellsOf(lines[j]);
      if (!row) break;
      rows.push({ line: j + 1, cells: row });
    }
    return { headerLine: i + 1, headerIndex: i, columns, rows, width: cells.length };
  }
  return null;
}

function col(row, columns, name) {
  const index = columns[name];
  return index === undefined ? null : row.cells[index];
}

function splitLines(text) {
  return { eol: text.includes("\r\n") ? "\r\n" : "\n", lines: text.split(/\r?\n/) };
}

function serialize(cells) {
  return `| ${cells.join(" | ")} |`;
}

// 表头必须紧跟分隔行，否则会把备注里出现「模块」二字的普通数据行当成表头。
function findRowTable(lines, rowName, column) {
  for (let i = 0; i < lines.length; i++) {
    const cells = cellsOf(lines[i]);
    if (!cells) continue;
    const next = cellsOf(lines[i + 1] || "");
    if (!next || !isSeparator(next)) continue;
    const columns = {};
    cells.forEach((name, index) => { if (name) columns[name] = index; });
    if (column !== "__name__" && columns[column] === undefined) continue;
    for (let j = i + 2; j < lines.length; j++) {
      const row = cellsOf(lines[j]);
      if (!row || isSeparator(row)) break;
      if (row[0] === rowName) return { lineNo: j, columns };
    }
  }
  return null;
}

// 按行名 + 表头名定位并改写一格，其余字节原样保留。
// 探针写死整行正则会随备注漂移，实测改一次文案就静默失守。
function patchCell(text, rowName, column, value) {
  const { eol, lines } = splitLines(text);
  const found = findRowTable(lines, rowName, column);
  if (!found) throw new Error(`探针找不到「${column}」列里的行 ${rowName}`);
  const cells = cellsOf(lines[found.lineNo]);
  cells[column === "__name__" ? 0 : found.columns[column]] = value;
  lines[found.lineNo] = serialize(cells);
  return lines.join(eol);
}

function dropLine(text, anchor) {
  const { eol, lines } = splitLines(text);
  const at = lines.findIndex((l) => l.startsWith(anchor));
  if (at < 0) throw new Error(`探针找不到锚点行 ${anchor}`);
  lines.splice(at, 1);
  return lines.join(eol);
}

function duplicateRow(text, rowName, newName) {
  const { eol, lines } = splitLines(text);
  const at = lines.findIndex((l) => (cellsOf(l) || [])[0] === rowName);
  if (at < 0) throw new Error(`探针找不到行 ${rowName}`);
  const cells = cellsOf(lines[at]);
  cells[0] = newName;
  lines.splice(at, 0, serialize(cells));
  return lines.join(eol);
}

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
}

function audit(matrixText, frontendText, baselineMatrix, baselineFrontend) {
  const matrixLines = splitLines(matrixText).lines;
  const frontendLines = splitLines(frontendText).lines;
  const matrix = findTable(matrixLines, ["模块", "业务主责", "工作包"]);
  const frontend = findTable(frontendLines, ["冻结包", "界面主责", "后端协作"]);
  if (!matrix) { check("matrix-table-found", false, "未找到含「业务主责/工作包」表头的表"); return; }
  if (!frontend) { check("frontend-table-found", false, "未找到含「界面主责/后端协作」表头的表"); return; }
  check("matrix-table-found", true, `表头行 ${matrix.headerLine}`);
  check("frontend-table-found", true, `表头行 ${frontend.headerLine}`);

  const matrixRows = matrix.rows.filter((r) => !isSeparator(r.cells));
  const frontendRows = frontend.rows.filter((r) => !isSeparator(r.cells));
  const readme = matrixRows.filter((r) => col(r, matrix.columns, "模块") === "README");
  const modules = matrixRows.filter((r) => col(r, matrix.columns, "模块") !== "README");

  check("matrix-row-denominator", modules.length === 63 && readme.length === 1,
    `模块行 ${modules.length}（需 63）、README 行 ${readme.length}（需 1）、表体共 ${matrixRows.length}`);
  check("frontend-row-denominator", frontendRows.length === 54, `冻结包行 ${frontendRows.length}（需 54）`);

  const badWidth = matrixRows.filter((r) => r.cells.length !== matrix.width)
    .concat(frontendRows.filter((r) => r.cells.length !== frontend.width));
  check("row-column-count", badWidth.length === 0,
    badWidth.length ? `第 ${badWidth.map((r) => r.line).join(",")} 行列数与表头不等` : "两本账每行列数与表头相等");

  const dupMatrix = duplicated(modules.map((r) => col(r, matrix.columns, "模块")));
  const dupFrontend = duplicated(frontendRows.map((r) => col(r, frontend.columns, "冻结包")));
  check("name-unique", dupMatrix.length === 0 && dupFrontend.length === 0,
    `矩阵重名 [${dupMatrix}]、前端重名 [${dupFrontend}]`);

  const setCurrent = new Set(modules.map((r) => col(r, matrix.columns, "模块")));
  const baseMatrix = findTable(splitLines(baselineMatrix).lines, ["模块", "已复刻"]);
  const setBaseline = baseMatrix
    ? new Set(baseMatrix.rows.filter((r) => !isSeparator(r.cells)).map((r) => r.cells[0])
      .filter((n) => n && n !== "模块" && n !== "README"))
    : null;
  check("matrix-set-diff-zero", setBaseline !== null && sameSet(setCurrent, setBaseline),
    setBaseline === null ? "取不到责任列加入前的矩阵表体" : diffText(setCurrent, setBaseline));

  const setFrontCurrent = new Set(frontendRows.map((r) => col(r, frontend.columns, "冻结包")));
  const baseFrontend = findTable(splitLines(baselineFrontend).lines, ["冻结包"]);
  const setFrontBase = baseFrontend
    ? new Set(baseFrontend.rows.filter((r) => !isSeparator(r.cells)).map((r) => r.cells[0]).filter((n) => n && n !== "冻结包"))
    : null;
  check("frontend-set-diff-zero", setFrontBase !== null && sameSet(setFrontCurrent, setFrontBase),
    setFrontBase === null ? "取不到责任列加入前的前端表体" : diffText(setFrontCurrent, setFrontBase));

  const missingOwner = [];
  const badOwner = [];
  const badPackage = [];
  for (const row of modules) {
    const name = col(row, matrix.columns, "模块");
    const owner = col(row, matrix.columns, "业务主责");
    const pack = col(row, matrix.columns, "工作包");
    if (!owner || owner === "—") { missingOwner.push(name); continue; }
    if (!MEMBERS.includes(owner)) { badOwner.push(`${name}=${owner}`); continue; }
    if (MEMBER_PACKAGE[owner]) {
      if (pack !== MEMBER_PACKAGE[owner]) badPackage.push(`${name}: ${owner}/${pack}`);
    } else if (PACKAGES.includes(pack)) {
      badPackage.push(`${name}: ${owner}/${pack}（A/I 不占业务工作包）`);
    }
  }
  check("owner-assigned-every-row", missingOwner.length === 0,
    missingOwner.length ? `缺主责 ${missingOwner.length} 行: ${missingOwner.join(",")}` : "63 行全部有唯一主责");
  check("owner-member-valid", badOwner.length === 0,
    badOwner.length ? `主责取值不在九成员内: ${badOwner.slice(0, 4).join(",")}` : "主责取值在九成员内");
  check("owner-package-consistent", badPackage.length === 0,
    badPackage.length ? `成员与工作包不配对: ${badPackage.slice(0, 4).join(" / ")}` : "成员↔工作包逐行一致");

  if (readme[0]) {
    const owner = col(readme[0], matrix.columns, "业务主责");
    const pack = col(readme[0], matrix.columns, "工作包");
    check("readme-row-unassigned", owner === "—" && pack === "—", `README 行 主责=${owner} 工作包=${pack}`);
  } else {
    check("readme-row-unassigned", false, "找不到 README 行，无法核「索引页不分配责任」");
  }

  const stateCount = { "✔": 0, "◐": 0, "☐": 0 };
  const badState = [];
  for (const row of modules) {
    const state = col(row, matrix.columns, "已复刻");
    if (STATES.includes(state)) stateCount[state] += 1;
    else badState.push(`${col(row, matrix.columns, "模块")}=${state}`);
  }
  check("state-column-values-valid", badState.length === 0,
    badState.length ? `状态列出现未知标记: ${badState.slice(0, 4).join(",")}` : `表体 ✔${stateCount["✔"]} ◐${stateCount["◐"]} ☐${stateCount["☐"]}`);
  const declared = canonicalTally(matrixText);
  check("current-tally-anchor-present", declared !== null,
    declared ? "锚点行存在" : `缺少「${CANON}」锚点行`);
  check("current-tally-matches-table", declared !== null
    && declared.pass === stateCount["✔"] && declared.part === stateCount["◐"] && declared.none === stateCount["☐"],
    `锚点现值 ${declared ? `✔${declared.pass}/◐${declared.part}/☐${declared.none}` : "取不到"}，表体 ✔${stateCount["✔"]}/◐${stateCount["◐"]}/☐${stateCount["☐"]}`);

  const feBadOwner = [];
  const feBadHelper = [];
  for (const row of frontendRows) {
    const name = col(row, frontend.columns, "冻结包");
    const owner = col(row, frontend.columns, "界面主责");
    const helper = col(row, frontend.columns, "后端协作");
    if (!MEMBERS.includes(owner)) feBadOwner.push(`${name}=${owner}`);
    if (helper === null) { feBadHelper.push(`${name}=<缺列>`); continue; }
    for (const part of helper.split(/[/、,，+&]/).map((s) => s.trim()).filter((s) => s && s !== "—")) {
      if (!MEMBERS.includes(part)) feBadHelper.push(`${name}:${part}`);
    }
  }
  check("frontend-owner-valid", feBadOwner.length === 0,
    feBadOwner.length ? `界面主责非法/缺失: ${feBadOwner.slice(0, 4).join(",")}` : "54 行界面主责均在九成员内");
  check("frontend-helper-valid", feBadHelper.length === 0,
    feBadHelper.length ? `后端协作取值非法: ${feBadHelper.slice(0, 4).join(",")}` : "后端协作取值均为成员或 —");
}

function canonicalTally(text) {
  const line = splitLines(text).lines.find((l) => l.startsWith(CANON));
  if (!line) return null;
  const m = line.match(/✔\s*(\d+)\s*\/\s*◐\s*(\d+)\s*\/\s*☐\s*(\d+)/);
  return m ? { pass: Number(m[1]), part: Number(m[2]), none: Number(m[3]) } : null;
}

function duplicated(list) {
  const seen = new Set();
  const dup = new Set();
  for (const item of list) { if (seen.has(item)) dup.add(item); seen.add(item); }
  return [...dup];
}

function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}

function diffText(a, b) {
  const onlyA = [...a].filter((x) => !b.has(x));
  const onlyB = [...b].filter((x) => !a.has(x));
  return `onlyA=[${onlyA}] onlyB=[${onlyB}] 当前 ${a.size} 基线 ${b.size}`;
}

function report() {
  const failed = checks.filter((c) => !c.ok);
  for (const c of checks) console.log(`${c.ok ? "OK  " : "FAIL"} ${c.name}: ${c.detail}`);
  console.log(`GATE: ${failed.length ? "FAIL" : "PASS"} (${checks.length} checks, fail=${failed.length})`);
  return failed.length ? 1 : 0;
}

function show(ref, path) {
  return execFileSync("git", ["show", `${ref}:${path}`], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

// 反证：每项检查各注入一处它自己该抓的违规，要求该项名字出现在 FAIL 集里。
// 漏一项就是门禁自己造假绿，之后的 PASS 一律不能采信。
function selftest() {
  const matrix = readFileSync(join(root, MATRIX), "utf8");
  const frontend = readFileSync(join(root, FRONTEND), "utf8");
  const probes = [
    ["matrix-table-found", () => matrix.replace("| 模块 | zh |", "| 改名 | zh |")],
    ["frontend-table-found", () => frontend.replace("| 冻结包 |", "| 改名包 |")],
    ["matrix-row-denominator", () => duplicateRow(matrix, "attachment", "extra-module")],
    ["frontend-row-denominator", () => duplicateRow(frontend, frontendFirstRow(frontend), "ui-extra")],
    ["row-column-count", () => patchCell(matrix, "attachment", "备注", "多一个 | 裸竖线")],
    ["name-unique", () => patchCell(matrix, "approval", "模块", "agent-team")],
    ["matrix-set-diff-zero", () => patchCell(matrix, "approval", "模块", "approval-renamed")],
    ["frontend-set-diff-zero", () => patchCell(frontend, frontendFirstRow(frontend), "冻结包", "ui-renamed")],
    ["owner-assigned-every-row", () => patchCell(matrix, "attachment", "业务主责", "—")],
    ["owner-member-valid", () => patchCell(matrix, "attachment", "业务主责", "Z")],
    ["owner-package-consistent", () => patchCell(matrix, "attachment", "业务主责", "E")],
    ["readme-row-unassigned", () => patchCell(matrix, "README", "业务主责", "B")],
    ["state-column-values-valid", () => patchCell(matrix, "attachment", "已复刻", "▣")],
    ["current-tally-anchor-present", () => dropLine(matrix, CANON)],
    // 只动数字、锚点行留在原位——这样才证明「按数对账」这条检查本身在跑，
    // 而不是靠锚点消失顺带红一次。
    ["current-tally-matches-table", () => matrix.replace(`${CANON}：**✔ 9 / ◐ 54 / ☐ 0**`,
      `${CANON}：**✔ 12 / ◐ 51 / ☐ 0**`)],
    ["frontend-owner-valid", () => patchCell(frontend, frontendFirstRow(frontend), "界面主责", "—")],
    ["frontend-helper-valid", () => patchCell(frontend, frontendFirstRow(frontend), "后端协作", "张三")],
  ];
  let missed = 0;
  for (const [target, mutate] of probes) {
    checks.length = 0;
    let brokenMatrix = matrix;
    let brokenFrontend = frontend;
    try {
      const next = mutate();
      if (target.startsWith("frontend")) brokenFrontend = next;
      else brokenMatrix = next;
    } catch (e) {
      console.log(`MISSED ${target} (探针无法施加: ${e.message})`);
      missed++;
      continue;
    }
    try {
      audit(brokenMatrix, brokenFrontend, matrix, frontend);
    } catch (e) {
      console.log(`MISSED ${target} (门禁执行异常: ${e.message})`);
      missed++;
      continue;
    }
    const hit = checks.filter((c) => !c.ok).map((c) => c.name);
    if (hit.includes(target)) console.log(`CAUGHT ${target} -> ${hit.join(",")}`);
    else { console.log(`MISSED ${target} -> FAIL 集为 [${hit.join(",")}]`); missed++; }
  }
  checks.length = 0;
  audit(matrix, frontend, matrix, frontend);
  const baselineGreen = checks.every((c) => c.ok);
  console.log(`SELFTEST: ${missed === 0 && baselineGreen ? "PASS" : "FAIL"} (probes=${probes.length}, missed=${missed}, baseline=${baselineGreen ? "green" : "RED"})`);
  return missed === 0 && baselineGreen ? 0 : 1;
}

function frontendFirstRow(text) {
  const table = findTable(splitLines(text).lines, ["冻结包", "界面主责"]);
  if (!table) throw new Error("前端表没找到");
  const row = table.rows.find((r) => !isSeparator(r.cells));
  return row.cells[0];
}

const args = process.argv.slice(2);
if (args.includes("--selftest")) process.exitCode = selftest();
else if (args.length) { console.error("用法: node scripts/check_p0_ownership.cjs [--selftest]"); process.exitCode = 2; }
else {
  let baseline = null;
  try {
    baseline = { matrix: show(OWNER_COLUMN_COMMIT, MATRIX), frontend: show(OWNER_COLUMN_COMMIT, FRONTEND) };
  } catch (e) {
    console.log(`GATE: FAIL (取不到 ${OWNER_COLUMN_COMMIT} 的责任列前版本: ${e.message.trim().split(/\r?\n/)[0]})`);
    process.exitCode = 1;
  }
  if (baseline) {
    audit(readFileSync(join(root, MATRIX), "utf8"), readFileSync(join(root, FRONTEND), "utf8"),
      baseline.matrix, baseline.frontend);
    process.exitCode = report();
  }
}
