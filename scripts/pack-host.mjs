// 组装自包含 Host：可执行文件 + 全部依赖 DLL 放同一目录，
// 依赖 Windows 默认 DLL 搜索序（exe 同目录优先），因此运行时无需拼 PATH。
// OpenSSL 3（libcrypto-3-x64.dll / libssl-3-x64.dll）由 stdx 的 opensslFFI
// 包装层在运行时按默认搜索序加载；若不随包分发，剥掉 PATH 的真机将抛
// TlsException: Can not load openssl library。以下自动从 PATH 发现并打包。
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
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
const OPENSSL_DLLS = ["libcrypto-3-x64.dll", "libssl-3-x64.dll"];
const pathDirs = (process.env.PATH || "").split(";");
for (const dll of OPENSSL_DLLS) {
  let found = false;
  for (const dir of pathDirs) {
    if (!dir) continue;
    const candidate = join(dir, dll);
    if (existsSync(candidate)) {
      cpSync(candidate, join(dst, dll));
      n += 1;
      console.log(`  + ${dll} ← ${dir}`);
      found = true;
      break;
    }
  }
  if (!found) {
    console.error(`缺 OpenSSL 3 运行时：PATH 上找不到 ${dll}（TLS 将抛 TlsException）`);
    process.exit(1);
  }
}
console.log(`host 打包完成：${n} 个文件 → ${dst}`);
