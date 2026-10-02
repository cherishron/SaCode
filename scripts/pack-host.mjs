// 组装自包含 Host：可执行文件 + 全部依赖 DLL 放同一目录，
// 依赖 Windows 默认 DLL 搜索序（exe 同目录优先），因此运行时无需拼 PATH。
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
const [, , exe, outDir, ...dllDirs] = process.argv;
if (!exe || !outDir || dllDirs.length === 0) {
  console.error("用法: node scripts/pack-host.mjs <exe> <输出目录> <DLL目录...>");
  process.exit(2);
}
rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, "bin"), { recursive: true });
const dst = join(outDir, "bin");
cpSync(exe, join(dst, "dsh-host.exe"));
let n = 1;
for (const d of dllDirs) {
  for (const f of readdirSync(d)) {
    if (f.endsWith(".dll")) { cpSync(join(d, f), join(dst, f)); n += 1; }
  }
}
console.log(`host 打包完成：${n} 个文件 → ${dst}`);
