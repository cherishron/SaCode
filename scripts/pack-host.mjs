// 组装自包含 Host：可执行文件 + 全部依赖 DLL 放同一目录，
// 依赖 Windows 默认 DLL 搜索序（exe 同目录优先），因此运行时无需拼 PATH。
// OpenSSL 3（libcrypto-3-x64.dll / libssl-3-x64.dll）由 stdx 的 opensslFFI
// 包装层在运行时按默认搜索序加载；stdx TLS FFI 还导入 libwinpthread-1.dll。
// 两者均需随包分发，否则无 SDK 路径时可能在 Host 启动前即报 0xC0000135。
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, chmodSync } from "node:fs";
import { join, resolve } from "node:path";
import { selectedPlatform } from './platform.mjs';
import { copyRuntimeLibraries } from './runtime-libraries.mjs';
const spec = selectedPlatform();
const CA_FLAG = "--ca-bundle=";
const rawArgs = process.argv.slice(2);
const caArg = rawArgs.find((a) => a.startsWith(CA_FLAG));
const caBundle = caArg ? caArg.slice(CA_FLAG.length) : "";
const [exe, outDir, ...dllDirs] = rawArgs.filter((a) => !a.startsWith("--"));
if (!exe || !outDir || dllDirs.length === 0) {
  console.error("用法: node scripts/pack-host.mjs <exe> <输出目录> <DLL目录...> [--ca-bundle=<PEM 文件>]");
  process.exit(2);
}
// 先校验再清理：下面会整片删掉输出目录，锚路径写错时不能把上一轮还能跑的宿主一起删了。
if (caBundle && !existsSync(caBundle)) {
  console.error(`缺信任锚：--ca-bundle 指向的文件不存在（${caBundle}）`);
  process.exit(1);
}
if (!existsSync(exe) || dllDirs.some(d => !existsSync(d))) throw new Error('缺宿主或目标运行库目录，保留旧输出');
const output = resolve(outDir);
if ([exe, ...dllDirs, ...(caBundle ? [caBundle] : [])].some(p => resolve(p) === output || resolve(p).startsWith(output + '/')) ||
    [exe, ...dllDirs].some(p => resolve(p).startsWith(output + '\\'))) throw new Error('输入位于输出目录内，不能清理后复制自身');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, "bin"), { recursive: true });
const dst = join(outDir, "bin");
cpSync(exe, join(dst, `sacode-host${spec.suffix}`));
if (spec.os !== 'win32') chmodSync(join(dst, 'sacode-host'), 0o755);
for (const d of dllDirs) {
  copyRuntimeLibraries(d, dst, { platform: spec.os });
}
const RUNTIME_DLLS = ["libcrypto-3-x64.dll", "libssl-3-x64.dll", "libwinpthread-1.dll"];
const pathDirs = (process.env.PATH || "").split(";");
for (const dll of spec.os === 'win32' ? RUNTIME_DLLS : []) {
  if (existsSync(join(dst,dll))) continue;
  let found = false;
  for (const dir of pathDirs) {
    if (!dir) continue;
    const candidate = join(dir, dll);
    if (existsSync(candidate)) {
      cpSync(candidate, join(dst, dll));
      console.log(`  + ${dll} ← ${dir}`);
      found = true;
      break;
    }
  }
  if (!found) {
    console.error(`缺 Host 运行时：DLL 目录或 PATH 上找不到 ${dll}（不能生成自包含发布包）`);
    process.exit(1);
  }
}
if (caBundle) {
  // 文件名由壳层 paths.cjs 的查找规则决定（宿主 exe 同目录），两边漂开就没人能吃着锚。
  cpSync(caBundle, join(dst, "ca-bundle.pem"));
  console.log(`  + ca-bundle.pem ← ${caBundle}`);
}
console.log(`host 打包完成：${readdirSync(dst).length} 个文件 → ${dst}`);
