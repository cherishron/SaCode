// 组装 CLI 平台包：复制仓颉可执行文件与其运行期 DLL。二进制不入库，只由脚本生成。
import { cpSync, mkdirSync, readdirSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const SDK = process.env.CANGJIE_HOME || "D:\Program Files\HuaWei\Cangjie";
const RT = join(SDK, "runtime", "lib", "windows_x86_64_cjnative");
const out = "npm/dsh-cli-win32-x64/bin";
execFileSync("cjpm", ["build"], { cwd: "apps/cli", stdio: "inherit" });
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join("apps/cli", "target", "release", "bin", "main.exe"), join(out, "dsh.exe"));
let n = 1;
for (const f of readdirSync(RT)) {
  if (/\.dll$/.test(f) && (f === "libboundscheck.dll" || f.startsWith("libcangjie-runtime") || f.startsWith("libcangjie-std-"))) {
    cpSync(join(RT, f), join(out, f));
    n += 1;
  }
}
if (existsSync(join(SDK, "third_party", "mingw", "lib", "libgcc_s_seh-1.dll"))) {
  cpSync(join(SDK, "third_party", "mingw", "lib", "libgcc_s_seh-1.dll"), join(out, "libgcc_s_seh-1.dll"));
  cpSync(join(SDK, "third_party", "mingw", "lib", "libwinpthread-1.dll"), join(out, "libwinpthread-1.dll"));
}
console.log(`packed ${n} 个文件到 ${out}`);
