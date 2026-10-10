#!/usr/bin/env node
// 同包 daemon 入口：只解析平台包内的 sacode-daemon，缺就响亮失败。
// 不回退 PATH 上的全局 daemon，也不回退仓库里的构建产物——这两条都会让
// 「装出来的包跑的到底是哪一份」变成一个读不出来的问题（旧产物造过一轮假红）。
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const PLATFORM = {
  "win32:x64": "@stand-alone/sacode-win32-x64",
  "linux:x64": "@stand-alone/sacode-linux-x64",
  "darwin:arm64": "@stand-alone/sacode-darwin-arm64",
};
const key = PLATFORM[`${process.platform}:${process.arch}`];
if (!key) {
  process.stderr.write(`sacode-daemon: 未预置当前平台的二进制 (${process.platform}/${process.arch})\n`);
  process.exit(78);
}
const binName = process.platform === "win32" ? "sacode-daemon.exe" : "sacode-daemon";
let pkgDir;
let exe;
try {
  pkgDir = path.dirname(require.resolve(`${key}/package.json`));
} catch {
  process.stderr.write(`sacode-daemon: 解析不到平台包 ${key}，请先安装 @stand-alone/sacode\n`);
  process.exit(79);
}
exe = path.join(pkgDir, "bin", binName);
if (!fs.existsSync(exe)) {
  // 两种缺法要分开说：没装平台包是「装错了」，装了但缺 daemon 是「这个包是旧pack-cli 出的残缺包」——
  // 后者需要重跑 pack-service，光重装不会改变任何东西。
  process.stderr.write(`sacode-daemon: 平台包 ${key} 的 bin/ 里没有 ${binName}，请重跑 node scripts/pack-service.mjs --out <平台包目录>\n`);
  process.exit(82);
}
// 扩展宿主与 Host 的位置同样只从包内取：装出来的 daemon 没有仓库目录可退。
// 带齐才设变量，缺了就留空让 daemon 按自己的默认走并响亮报错——
// 指一个不存在的路径只会把「包里少带了一颗」变成更难读的「路径无效」。
const env = Object.assign({}, process.env);
const extDir = path.join(pkgDir, "extjs");
if (fs.existsSync(path.join(extDir, "server.cjs"))) env.SACODE_EXTJS_DIR = extDir;
const hostName = process.platform === "win32" ? "sacode-host.exe" : "sacode-host";
const hostExe = path.join(pkgDir, "bin", hostName);
if (fs.existsSync(hostExe)) env.SACODE_HOST = hostExe;
const r = spawnSync(exe, process.argv.slice(2), { stdio: "inherit", cwd: process.cwd(), env: env });
if (r.error) { process.stderr.write(`sacode-daemon: 启动失败 ${r.error.message}\n`); process.exit(80); }
process.exit(r.status === null ? 81 : r.status);
