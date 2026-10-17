// 离线安装验收：本地 tarball → 隔离安装 → npm 命令入口，无仓颉 SDK PATH。
// 需要先运行 pack-cli.mjs；保留声明必需的 Node 运行时，不把 Node 缺失当成包错误。
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('当前验收脚本仅适用于 Windows x64 平台包');
}
const npm = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
if (!existsSync(npm)) throw new Error('当前 Node 安装未提供 npm-cli.js');
if (!existsSync(join(repo, 'npm/sacode-cli-win32-x64/bin/sacode.exe'))) {
  throw new Error('请先运行 scripts/pack-cli.mjs');
}
const dir = mkdtempSync(join(tmpdir(), 'sacode-install-smoke-'));
const artifacts = join(dir, 'artifacts');
mkdirSync(artifacts);
const run = (exe, args, cwd, env = process.env) => {
  const result = spawnSync(exe, args, { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`验收子进程失败：${result.status}`);
};
const runNpm = (args, cwd) => run(process.execPath, [npm, ...args], cwd);
console.log('隔离验收目录：' + dir);
for (const source of ['npm/sacode-cli', 'npm/sacode-cli-win32-x64']) {
  runNpm(['pack', './' + source, '--pack-destination', artifacts], repo);
}
writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'sacode-install-smoke', version: '1.0.0', private: true }));
const tarballs = readdirSync(artifacts).filter(name => name.endsWith('.tgz'));
if (tarballs.length !== 2) throw new Error('预期两个本地 tarball');
runNpm(['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', ...tarballs.map(name => join(artifacts, name))], dir);
const installed = join(dir, 'node_modules', '.bin', 'sacode.cmd');
if (!existsSync(installed)) throw new Error('安装未生成 sacode 命令');
const env = { ...process.env };
// Windows 环境变量名称不区分大小写：先去掉旧 PATH，避免同时传 Path/PATH。
for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
env.PATH = [dirname(process.execPath), join(process.env.SystemRoot, 'System32'), process.env.SystemRoot].join(';');
// 用真实 npm 生成的 cmd shim，验证它能找到 Node、平台包与二进制。
run(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'node_modules\\.bin\\sacode.cmd all'], dir, env);
console.log('NPM_INSTALL_SMOKE PASS');
// 保留隔离目录用于追溯，不操作用户的全局 npm 安装。
