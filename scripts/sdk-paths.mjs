// pack-cli 的两条路径判据单独成模块：它决定「装出来的 dsh 缺不缺 DLL」，
// 而这两个函数原先写死在脚本正文里，跑不到、也测不到。
// 本文件由 pack-cli.mjs 抽取而来，抽取时保持原语义不动，先让测试能对上旧行为。
import { join } from "node:path";

// SDK 根目录：环境变量优先，缺省落回本机默认安装位。
// 缺省值必须用正斜杠：JS 源码里 "D:\Program Files\HuaWei\Cangjie" 的反斜杠是转义符
// （\P、\C 都不是合法转义，反斜杠被丢掉），实际得到 "D:Program FilesHuaWeiCangjie"
// 这种谁都不存在的路径，于是没设 CANGJIE_HOME 的机器上运行期库一颗都拷不到。
// Windows 的 Node 认正斜杠，两边都不用拼 sep。
export function sdkRoot(env) {
  return env.CANGJIE_HOME || "D:/Program Files/HuaWei/Cangjie";
}

// 仓颉运行期库目录（决定随包分发哪几颗 libcangjie-*.dll）。
export function runtimeLibDir(env) {
  return join(sdkRoot(env), "runtime", "lib", "windows_x86_64_cjnative");
}

// 把 PATH 拆成候选目录。Windows 只用 ';' 分隔，而每个条目自己带盘符冒号
// （"C:\tools"）——把 ':' 也当分隔符会切成 ["C", "\tools"]，于是 MinGW / OpenSSL
// 那几颗「在 PATH 上明明有」的 DLL 永远搜不到（本机实测就是这个形态）。
export function pathEntries(value, platform) {
  const sep = platform === "win32" ? ";" : ":";
  return (value || "").split(sep).filter((d) => d.length > 0);
}
