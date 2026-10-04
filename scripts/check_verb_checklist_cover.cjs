// 一次性核对：verb 接入清单是否恰好覆盖矩阵里全部 ◐ 行（不多不漏）
const fs = require("fs");

const ml = fs.readFileSync("docs/plans/dsh-capability-matrix.md", "utf8").split(/\r?\n/);
const hi = ml.findIndex((l) => l.startsWith("| 模块 |"));
if (hi < 0) throw new Error("矩阵表头没找到");
const cols = ml[hi].split("|").map((s) => s.trim());
const iN = cols.indexOf("模块");
const iP = cols.indexOf("阶段");
const iR = cols.indexOf("已复刻");
if (iN < 0 || iR < 0) throw new Error("列名定位失败: " + cols.join(","));

const partial = new Set();
const phaseOf = {};
let ok = 0, half = 0, none = 0;
for (let i = hi + 2; i < ml.length; i++) {
  const l = ml[i];
  if (!l.startsWith("|")) break;
  const c = l.split("|").map((s) => s.trim());
  const name = c[iN];
  if (!name) continue;
  const st = c[iR];
  if (st === "✔") ok++;
  else if (st === "◐") { half++; partial.add(name); phaseOf[name] = c[iP]; }
  else if (st === "☐" && name !== "README") { none++; partial.add(name); }
}
console.log("矩阵: ✔", ok, "◐", half, "☐(非README)", none, " 合计模块行", ok + half + none);

const bt = String.fromCharCode(96);
const cl = fs.readFileSync("docs/plans/verb-wiring-checklist-2026-10-04.md", "utf8").split(/\r?\n/);
const listed = new Set();
for (const l of cl) {
  if (!l.startsWith("| " + bt)) continue;
  const n = l.split("|")[1].trim().replace(new RegExp("^" + bt + "|" + bt + "$", "g"), "").split(" ")[0];
  if (n) listed.add(n);
}
console.log("清单覆盖:", listed.size);

const miss = [...partial].filter((x) => !listed.has(x));
const extra = [...listed].filter((x) => !partial.has(x));
console.log("漏:", miss.length ? miss.join(", ") : "无");
console.log("多(不该在 ◐ 清单里):", extra.length ? extra.join(", ") : "无");

// 分阶段计数核对
const byPhase = {};
for (const m of partial) { const p = phaseOf[m] || "?"; byPhase[p] = (byPhase[p] || 0) + 1; }
console.log("矩阵 ◐ 按阶段:", JSON.stringify(byPhase));

if (miss.length || extra.length) { console.log("RESULT: FAIL"); process.exit(1); }
console.log("RESULT: PASS 恰好覆盖");
