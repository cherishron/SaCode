#!/usr/bin/env node
// 启动包装：按平台选二进制包，透传 argv/cwd/stdin/stdout/stderr 与退出码。
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const key = { "win32:x64": "@dsh/cli-win32-x64", "linux:x64": "@dsh/cli-linux-x64", "darwin:arm64": "@dsh/cli-darwin-arm64" }[`${process.platform}:${process.arch}`];
if (!key) {
  process.stderr.write(`dsh: 未预置当前平台的二进制 (${process.platform}/${process.arch})\n`);
  process.exit(78);
}
let exe;
try {
  const pkgDir = path.dirname(require.resolve(`${key}/package.json`));
  exe = path.join(pkgDir, "bin", process.platform === "win32" ? "dsh.exe" : "dsh");
  if (!fs.existsSync(exe)) throw new Error("missing");
} catch {
  process.stderr.write(`dsh: 找不到平台包 ${key} 的可执行文件，请先安装 @dsh/cli\n`);
  process.exit(79);
}
const r = spawnSync(exe, process.argv.slice(2), { stdio: "inherit", cwd: process.cwd(), env: process.env });
if (r.error) { process.stderr.write(`dsh: 启动失败 ${r.error.message}\n`); process.exit(80); }
process.exit(r.status === null ? 81 : r.status);
