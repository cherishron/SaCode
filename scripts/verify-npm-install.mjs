// 仅安装本次本地 tgz，不运行包脚本/旧自测，不访问真实用户数据。
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectedPlatform } from './platform.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const spec = selectedPlatform();
if (spec.os === 'ohos') throw new Error('不在宿主机运行 OHOS 交叉产物');
const base = join(root, 'apps/desktop/.tmp-test/npm-install'); mkdirSync(base, { recursive: true });
const dir = mkdtempSync(join(base, spec.target + '-'));
const npm = (args, cwd) => process.platform === 'win32'
  ? execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd', ...args], { cwd, encoding: 'utf8' })
  : execFileSync('npm', args, { cwd, encoding: 'utf8' });
try {
  const archive = pkg => JSON.parse(npm(['pack', '--json', '--pack-destination', dir], pkg))[0].filename;
  const native = archive(join(root, 'npm', `sacode-cli-${spec.target}`));
  const main = archive(join(root, 'npm/sacode-cli'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ private: true, name: 'sacode-private-install-verifier', version: '0.0.0' }));
  npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', '--offline', '--omit=optional', `./${native}`, `./${main}`], dir);
  const req = createRequire(join(dir, 'package.json'));
  const cli = req.resolve('@stand-alone/sacode/bin/cli.js');
  const env = { ...process.env, SACODE_USER_SETTINGS_DIR: join(dir, 'settings') };
  for (const key of Object.keys(env)) if (/^SACODE_(?:PROVIDER|COMPUTER|EXTJS|HOST|REMOTE|DATA)/.test(key)) delete env[key];
  // 去掉 SDK 搜索路径，确保启动依赖真的来自平台包（系统 PATH 保留）。
  env.PATH = (env.PATH || '').split(process.platform === 'win32' ? ';' : ':')
    .filter(p => !/cangjie|stdx-work/i.test(p)).join(process.platform === 'win32' ? ';' : ':');
  delete env.LD_LIBRARY_PATH; delete env.DYLD_LIBRARY_PATH;
  const run = spawnSync(process.execPath, [cli, '--help'], { cwd: dir, env, encoding: 'utf8', timeout: 10000 });
  if (run.error || run.status !== 0 || !run.stdout.includes('usage:')) throw new Error(`npm 安装后 CLI 启动失败 ${run.error?.message || run.stderr}`);
  const platform = dirname(req.resolve(`@stand-alone/sacode-${spec.target}/package.json`));
  for (const name of ['sacode', 'sacode-host', 'sacode-daemon']) if (!existsSync(join(platform, 'bin', name + spec.suffix))) throw new Error(`npm 包缺 ${name}`);
  const { HostBridge } = req(join(root, 'apps/desktop/host-bridge.cjs'));
  const bridge = new HostBridge(join(platform, 'bin', 'sacode-host' + spec.suffix), env);
  try {
    await bridge.start(dir);
    const result = await bridge.request('initialize'); if (!result) throw new Error('Host 初始化无结果');
  }
  finally { const exit = await bridge.stop(); if (exit.forced) throw new Error('Host 需要强杀才能退出'); }
  console.log('npm 本地 tgz 安装、无 SDK CLI 帮助与包内 Host 初始化 PASS；非真实开发任务');
} finally { rmSync(dir, { recursive: true, force: true }); }
