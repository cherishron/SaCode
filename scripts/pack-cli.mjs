// 组装 CLI 平台包：复制仓颉可执行文件与其运行期 DLL。二进制不入库，只由脚本生成。
import { cpSync, mkdirSync, readdirSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { sdkRoot, runtimeLibDir, pathEntries } from "./sdk-paths.mjs";

const SDK = sdkRoot(process.env);
const RT = runtimeLibDir(process.env);
const STDX = process.env.STDX_HOME || "C:/Users/jingg/stdx-work/stdx-1.1.3.1/windows_x86_64_cjnative/dynamic/stdx";
const OPENSSL_HOME = process.env.OPENSSL_HOME || "";
const out = "npm/sacode-cli-win32-x64/bin";
const extOut = "npm/sacode-cli-win32-x64/extjs";
// server.cjs 里 require("./host.cjs")，两个文件必须同去，少一个就是起不来的包。
const EXT_SRC = ["extjs/server.cjs", "extjs/host.cjs"];
// example/ 下的样例工具也要带：自检是按 "example/echo.cjs" 这种相对宿主目录的路径去加载的，
// 缺目录时注册拿不到工具，往后调用与按 callId 取消会连锁失败（实测 4 条红）。
// 整目录的 .cjs 一起收，不挑子集——挑子集等于把「哪几条断言用什么」写进两份源码里。
const EXT_EXAMPLE = "extjs/example";
execFileSync("cjpm", ["build"], { cwd: "apps/cli", stdio: "inherit" });
rmSync(out, { recursive: true, force: true });
rmSync(extOut, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
mkdirSync(extOut, { recursive: true });
cpSync(join("apps/cli", "target", "release", "bin", "main.exe"), join(out, "sacode.exe"));
// 扩展宿主源码要随包走：从 npm 装出来的 dsh 没有仓库目录可退，`sacode extjs` 会在工作目录
// 这一步直接炸掉（实测 IllegalArgumentException: WorkingDirectory "extjs" not exist）。
for (const f of EXT_SRC) {
  if (!existsSync(f)) {
    console.error(`缺少扩展宿主源码 ${f}，不能出残缺的平台包`);
    process.exit(2);
  }
  cpSync(f, join(extOut, f.split("/")[1]));
}
if (!existsSync(EXT_EXAMPLE)) {
  console.error(`缺少样例工具目录 ${EXT_EXAMPLE}，装出来的 dsh 跑不了扩展宿主自检`);
  process.exit(2);
}
mkdirSync(join(extOut, "example"), { recursive: true });
let ex = 0;
for (const f of readdirSync(EXT_EXAMPLE)) {
  if (f.endsWith(".cjs")) {
    cpSync(join(EXT_EXAMPLE, f), join(extOut, "example", f));
    ex += 1;
  }
}
let n = 1;
// 运行期不需要的模块 DLL 不进包：unittest 系是测试框架自身，ast 是宏/反射的编译期模块，
// 四颗合计 28.6MB（bin 目录 42MB → 14MB）。反证不是靠推理：从安装结果里删掉这 4 颗后，
// 剥掉 SDK 的 PATH 逐子命令仍全绿（2026-10-05 提交 45db763 后实测 all 100 / stream 21 / tool 11 / ext 8 /
// cancel 9 / extjs 12 / headless 36 / att 23，seed 与 projection 输出正常）；同法删掉真依赖
// libcangjie-runtime.dll 时 exec 当场 rc=127「error while loading shared libraries」——
// 缺了就会响亮地炸，所以绿不是静默降级换来的。
const RUNTIME_DENY = [
  "libcangjie-std-ast.dll",
  "libcangjie-std-unittest.dll",
  "libcangjie-std-unittest.testmacro.dll",
  "libcangjie-std-unittest.prop_test.dll"
];
for (const f of readdirSync(RT)) {
  if (/\.dll$/.test(f) && !RUNTIME_DENY.includes(f) && (f === "libboundscheck.dll" || f.startsWith("libcangjie-runtime") || f.startsWith("libcangjie-std-"))) {
    cpSync(join(RT, f), join(out, f));
    n += 1;
  }
}
// MinGW 运行期 DLL：仓颉编译器基于 GCC，产物链接 libgcc/libwinpthread/libstdc++。
// SDK 不一定带 mingw（本机就没有 third_party/mingw），从 OPENSSL_HOME 或 PATH 上搜——
// 不随包分发则剥掉 PATH 后 exe 启动直接 0xC0000135（STATUS_DLL_NOT_FOUND）。
const MINGW_DLLS = ["libgcc_s_seh-1.dll", "libwinpthread-1.dll", "libstdc++-6.dll"];
let mgw = 0;
for (const dll of MINGW_DLLS) {
  let found = false;
  const sources = [];
  if (OPENSSL_HOME) sources.push(OPENSSL_HOME);
  sources.push(join(SDK, "third_party", "mingw", "lib"));
  for (const dir of pathEntries(process.env.PATH, process.platform)) { sources.push(dir); }
  for (const dir of sources) {
    const candidate = join(dir, dll);
    if (existsSync(candidate)) {
      cpSync(candidate, join(out, dll));
      mgw += 1;
      found = true;
      break;
    }
  }
  if (!found) {
    console.error(`缺 MinGW 运行时：找不到 ${dll}（exe 启动会 0xC0000135）`);
    process.exit(1);
  }
}
// stdx 运行期 DLL：core 直接 import stdx.net.http（RealSseProvider）与 stdx.encoding.json，
// 平台包必须带这些 DLL，否则剥掉 SDK 后 sacode realstream 会缺 DLL 当场炸（rc=127）。
if (!existsSync(STDX)) {
  console.error(`缺少 stdx 动态库目录 ${STDX}，装出来的 dsh 跑不了真实流`);
  process.exit(2);
}
let sx = 0;
const STDX_DENY = /^libstdx\.unittest|^lib-macro/;
for (const f of readdirSync(STDX)) {
  if (/^libstdx.*\.dll$/.test(f) && !STDX_DENY.test(f)) {
    cpSync(join(STDX, f), join(out, f));
    sx += 1;
  }
}
// TLS 靠 OpenSSL FFI：RealSseProvider 走 https 必须有这颗，否则 TLS 握手阶段直接炸。
if (existsSync(join(STDX, "libcangjie-dynamicLoader-opensslFFI.dll"))) {
  cpSync(join(STDX, "libcangjie-dynamicLoader-opensslFFI.dll"), join(out, "libcangjie-dynamicLoader-opensslFFI.dll"));
  sx += 1;
}
// OpenSSL 3 运行期：libstdx.net.tls 经 tlsFFI → opensslFFI 链加载 libcrypto/libssl，
// 不随包分发则剥掉 PATH 后 sacode realstream 会缺 DLL（rc=127 can not load openssl library）。
// Git Bash 下 process.env.PATH 用 Unix 路径（/mingw64/bin），Node 在 Windows 上解析不了，
// 需要用 OPENSSL_HOME 显式给 Windows 路径（cygpath -w 转换后的）。
const OPENSSL_DLLS = ["libcrypto-3-x64.dll", "libssl-3-x64.dll"];
let ssl = 0;
for (const dll of OPENSSL_DLLS) {
  let found = false;
  if (OPENSSL_HOME && existsSync(join(OPENSSL_HOME, dll))) {
    cpSync(join(OPENSSL_HOME, dll), join(out, dll));
    ssl += 1;
    console.log(`  + ${dll} ← ${OPENSSL_HOME}`);
    found = true;
  } else {
    const pathDirs = pathEntries(process.env.PATH, process.platform);
    for (const dir of pathDirs) {
      if (!dir) continue;
      const candidate = join(dir, dll);
      if (existsSync(candidate)) {
        cpSync(candidate, join(out, dll));
        ssl += 1;
        console.log(`  + ${dll} ← ${dir}`);
        found = true;
        break;
      }
    }
  }
  if (!found) {
    console.error(`缺 OpenSSL 3 运行时：找不到 ${dll}（TLS 将抛 TlsException）`);
    process.exit(1);
  }
}
console.log(`packed ${n} 个文件到 ${out}（其中 stdx ${sx} + openssl ${ssl} + mingw ${mgw}），扩展宿主 ${EXT_SRC.length} + 样例工具 ${ex} 个到 ${extOut}`);
