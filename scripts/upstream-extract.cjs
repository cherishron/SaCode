// 把已下载的上游原文按篇提取骨架 + 契约要点，输出汇总文本供一次 Read。
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.argv[2];
const OUT = process.argv[3];

const KW = /(event|tool|approval|protocol|api|must|shall|MUST|SHALL|不允许|必须|审批|工具|事件|协议|签名|契约|不变量|invariant|surface|flush|append|projection|cancel|lease|token|budget|usage)/i;

const files = fs.readdirSync(ROOT).filter(f => f.endsWith(".md")).sort();
const lines = [];
for (const f of files) {
  const p = path.join(ROOT, f);
  const raw = fs.readFileSync(p, "utf8");
  const arr = raw.split(/\r?\n/);
  lines.push(`===== ${f}  (${arr.length} 行, ${Buffer.byteLength(raw)} 字节) =====`);
  // 章节骨架
  const heads = arr.filter(l => /^#{1,4}\s/.test(l));
  lines.push("--- 章节骨架 ---");
  lines.push(...heads);
  // 契约要点行（含关键词的整行，去重前后避免长段落）
  const hits = [];
  let hitCount = 0;
  for (const l of arr) {
    if (hitCount >= 50) break;
    if (l.trim().length === 0) continue;
    if (KW.test(l) && !/^#{1,4}\s/.test(l)) {
      hits.push(l.trim().slice(0, 200));
      hitCount++;
    }
  }
  lines.push("--- 契约要点行 (限 50) ---");
  lines.push(...hits);
  lines.push("");
}
fs.writeFileSync(OUT, lines.join("\n"), "utf8");
console.log(`汇总写入 ${OUT}，共 ${lines.length} 行`);
