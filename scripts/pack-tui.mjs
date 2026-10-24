// 构建并收集 TUI 单文件产物到 npm 主包目录。
// 产物不是源码：npm/sacode-cli/tui/ 被 .gitignore 忽略，随 npm pack 进安装包。
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tui = join(root, 'apps/cli/tui');
const target = join(root, 'npm/sacode-cli/tui');
const builtins = new Set(builtinModules);

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npmRun = (args, cwd) => {
  if (process.platform === 'win32') execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', npm, ...args], { cwd, stdio: 'inherit' });
  else execFileSync(npm, args, { cwd, stdio: 'inherit' });
};

// 打包机第一次跑时没有 TUI 的 node_modules；有锁文件走 ci，没有才 install。
if (!existsSync(join(tui, 'node_modules/rollup'))) {
  npmRun([existsSync(join(tui, 'package-lock.json')) ? 'ci' : 'install'], tui);
}

execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: tui, stdio: 'inherit' });

const bundle = join(tui, 'dist/index.mjs');
if (!existsSync(bundle)) throw new Error('TUI 构建未产出 dist/index.mjs');

// 折叠产物必须自足：只允许 Node 内置模块；裸包、动态 import、eval 都会在安装态变成缺文件错误。
const source = readFileSync(bundle, 'utf8');
const specifiers = [...source.matchAll(/(?:^|\n)\s*import\s+(?:[^'"\n]*?\s+from\s+)?['"]([^'"]+)['"]/g)].map((match) => match[1]);
const badSpecifier = specifiers.find((specifier) => {
  const bare = specifier.startsWith('node:') ? specifier.slice('node:'.length) : specifier;
  return !builtins.has(bare);
});
if (badSpecifier) throw new Error(`TUI 产物残留外部模块导入：${badSpecifier}`);
if (/\bimport\s*\(/.test(source)) throw new Error('TUI 产物残留动态 import');
if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(source)) throw new Error('TUI 产物残留 eval/new Function');

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(bundle, join(target, 'index.mjs'));
const thirdParty = join(tui, 'dist/third-party');
if (!existsSync(join(thirdParty, 'gemini-cli/Apache-2.0.txt'))) throw new Error('TUI 缺少随包 Apache-2.0 许可证');
cpSync(thirdParty, join(target, 'third-party'), { recursive: true });
process.stdout.write(`TUI 产物已收集：${join(target, 'index.mjs')}\n`);
