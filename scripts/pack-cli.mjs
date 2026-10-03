// 组装 CLI 平台包：复制仓颉可执行文件与其运行期 DLL。二进制不入库，只由脚本生成。
import { cpSync, mkdirSync, readdirSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const SDK = process.env.CANGJIE_HOME || "D:\Program Files\HuaWei\Cangjie";
const RT = join(SDK, "runtime", "lib", "windows_x86_64_cjnative");
const out = "npm/dsh-cli-win32-x64/bin";
const extOut = "npm/dsh-cli-win32-x64/extjs";
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
cpSync(join("apps/cli", "target", "release", "bin", "main.exe"), join(out, "dsh.exe"));
// 扩展宿主源码要随包走：从 npm 装出来的 dsh 没有仓库目录可退，`dsh extjs` 会在工作目录
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
// 剥掉 SDK 的 PATH 逐子命令仍全绿（all 41 / stream 21 / tool 11 / ext 8 / cancel 9 / extjs 12，
// seed 与 projection 输出正常）；同法删掉真依赖 libcangjie-runtime.dll 时 exec 当场
// rc=127「error while loading shared libraries」——缺了就会响亮地炸，所以绿不是静默降级换来的。
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
if (existsSync(join(SDK, "third_party", "mingw", "lib", "libgcc_s_seh-1.dll"))) {
  cpSync(join(SDK, "third_party", "mingw", "lib", "libgcc_s_seh-1.dll"), join(out, "libgcc_s_seh-1.dll"));
  cpSync(join(SDK, "third_party", "mingw", "lib", "libwinpthread-1.dll"), join(out, "libwinpthread-1.dll"));
}
console.log(`packed ${n} 个文件到 ${out}，扩展宿主 ${EXT_SRC.length} + 样例工具 ${ex} 个到 ${extOut}`);
