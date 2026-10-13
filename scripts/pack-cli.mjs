// 同平台原生产物包：CLI、Host、daemon、运行库、扩展源码与可复核清单。
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, existsSync, readFileSync, writeFileSync, chmodSync, statSync, rmSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { selectedPlatform } from './platform.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const spec = selectedPlatform();
if (!process.env.SACODE_STDX_LIB_DIR && spec.os !== 'win32') {
  const resolved = join(root, '.deps/stdx', `resolved-${spec.target}.json`);
  if (existsSync(resolved)) process.env.SACODE_STDX_LIB_DIR = JSON.parse(readFileSync(resolved, 'utf8')).directory;
}
if (!process.argv.includes('--no-build')) execFileSync(process.execPath, ['scripts/build-platform.mjs'], { stdio: 'inherit' });
const version = JSON.parse(readFileSync('npm/sacode-cli/package.json', 'utf8')).version;
const pkg = join(root, 'npm', `sacode-cli-${spec.target}`);
const bin = join(pkg, 'bin');
const inputMap = JSON.parse(readFileSync(join(root, 'apps/desktop/.tmp-test/platform-build', spec.target, 'binaries.json'), 'utf8'));
const buildRecord = JSON.parse(readFileSync(join(root, 'apps/desktop/.tmp-test/platform-build', spec.target, 'build.json'), 'utf8'));
if (buildRecord.target !== spec.target || buildRecord.results.some(r => r.exit !== 0)) throw new Error('本轮构建记录与打包目标不匹配');
for (const file of Object.values(inputMap)) if (!existsSync(file)) throw new Error(`缺本轮产物 ${file}`);
rmSync(bin, { recursive: true, force: true });
rmSync(join(pkg, 'extjs'), { recursive: true, force: true });
mkdirSync(bin, { recursive: true });
if (spec.os === 'win32') {
  process.env.SACODE_PACK_PREBUILT = '1';
  process.env.SACODE_CLI_EXE = inputMap.cli;
  await import('./pack-cli-windows.mjs');
} else {
  if (!process.env.CANGJIE_HOME) throw new Error('打包需显式 CANGJIE_HOME');
  let runtime = process.env.SACODE_RUNTIME_LIB_DIR || join(process.env.CANGJIE_HOME, 'runtime/lib', spec.folder);
  if (!existsSync(runtime) && spec.os === 'darwin') runtime = join(process.env.CANGJIE_HOME, 'runtime/lib', spec.folder.replace('macos_', 'darwin_'));
  const stdx = process.env.SACODE_STDX_LIB_DIR;
  if (!runtime || !existsSync(runtime) || !stdx || !existsSync(stdx)) throw new Error('目标 runtime/stdx 目录缺失，不能生成残缺包');
  let count = 0;
  for (const directory of [runtime, stdx, process.env.OPENSSL_HOME].filter(Boolean)) {
    for (const f of readdirSync(directory)) {
      if (/\.so(?:\.|$)|\.dylib$/.test(f) && !/unittest|testmacro|prop_test|std-ast/.test(f)) {
        cpSync(join(directory, f), join(bin, f), { dereference: true }); count++;
      }
    }
  }
  if (!count) throw new Error('未收集到目标动态库');
  // Linux OpenSSL 可由系统提供，作为显式安装前提；CI 在剥离 SDK 的 smoke 中检查。
  cpSync('extjs', join(pkg, 'extjs'), { recursive: true, filter: src => !/[/\\](?:node_modules|test|\.tmp-test)(?:[/\\]|$)/.test(src) });
}
const roles = spec.os === 'ohos' ? [['apps/cli', 'sacode']] : [['apps/cli', 'sacode'], ['apps/host', 'sacode-host'], ['apps/daemon', 'sacode-daemon']];
for (const [member, name] of roles) {
  const input = inputMap[member.split('/').at(-1)];
  if (!input || !existsSync(input)) throw new Error(`缺目标产物 ${input}`);
  cpSync(input, join(bin, name + spec.suffix));
  if (spec.os !== 'win32') chmodSync(join(bin, name), 0o755);
}
const packageJson = { name: `@stand-alone/sacode-${spec.target}`, version, license: 'MulanPSL-2.0',
  ...(spec.os === 'ohos' ? {} : { os: [spec.os], cpu: [spec.cpu] }),
  publishConfig: { access: 'public' }, files: ['bin', 'extjs', 'build-manifest.json'] };
writeFileSync(join(pkg, 'package.json'), JSON.stringify(packageJson, null, 2) + '\n');
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const files = readdirSync(bin).filter(f => statSync(join(bin, f)).isFile()).sort().map(f => ({ path: `bin/${f}`,
  sha256: createHash('sha256').update(readFileSync(join(bin, f))).digest('hex'), bytes: statSync(join(bin, f)).size }));
const dirty = !!execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim();
writeFileSync(join(pkg, 'build-manifest.json'), JSON.stringify({ sha, dirty, target: spec.target, version, files, runtimeVerified: false }, null, 2) + '\n');
console.log(`平台包 ${pkg}；版本 ${version}；运行结果需另验`);
