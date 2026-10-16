// 固定构建入口：原生薄层与仓颉目标匹配，再串行构建必需角色，不运行旧自测。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, cpSync, symlinkSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectedPlatform } from './platform.mjs';
import { runBuild } from './run-build.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const spec = selectedPlatform();
if (!process.env.SACODE_STDX_LIB_DIR && spec.os !== 'win32') {
  const resolved = join(root, '.deps/stdx', `resolved-${spec.target}.json`);
  if (existsSync(resolved)) process.env.SACODE_STDX_LIB_DIR = JSON.parse(readFileSync(resolved, 'utf8')).directory;
}
const report = join(root, 'target/tmp/platform-build', spec.target);
mkdirSync(report, { recursive: true });
const version = execFileSync('cjc', ['-v'], { encoding: 'utf8' });
if (!/1\.1\.3\b/.test(version)) throw new Error('本批要求仓颉 1.1.3，不能混用 SDK');
if (!version.includes(spec.triple) && spec.os !== 'ohos') throw new Error(`cjc 目标不匹配 ${spec.triple}`);
if (spec.os === 'ohos' && (!process.env.OHOS_SYSROOT || !process.env.OHOS_CC)) throw new Error('OHOS 缺 native SDK/sysroot；先核工具链，不用 Linux 产物替代');
if (spec.os !== 'win32' && !existsSync(join(process.env.SACODE_STDX_LIB_DIR || '', 'stdx.crypto.common.cjo'))) throw new Error('请先设置目标 SACODE_STDX_LIB_DIR');
execFileSync(process.execPath, [join(root, 'scripts/build-native.mjs')], { cwd: root, stdio: 'inherit' });
let sourceRoot = root;
if (spec.os === 'ohos') {
  if (!process.env.CANGJIE_HOME || !existsSync(join(process.env.CANGJIE_HOME, 'runtime'))) throw new Error('OHOS 缺配套仓颉 SDK 运行库');
  // cjpm 不接受 --compile-option；sysroot 写入私有清单，不修改主工作区。
  const copy = join(report, 'source'); rmSync(copy, { recursive: true, force: true }); mkdirSync(copy, { recursive: true });
  writeFileSync(join(copy, 'cjpm.toml'), '[workspace]\nmembers = ["core", "apps/cli"]\n');
  symlinkSync(join(root, '.deps'), join(copy, '.deps'), process.platform === 'win32' ? 'junction' : 'dir');
  for (const member of ['core', 'apps/cli']) {
    mkdirSync(join(copy, member), { recursive: true });
    cpSync(join(root, member, 'src'), join(copy, member, 'src'), { recursive: true,
      filter: file => !file.endsWith('_test.cj') });
    const manifest = readFileSync(join(root, member, 'cjpm.toml'), 'utf8').replace(/\r\n/g, '\n');
    const section = `[target.${spec.triple}]`;
    const compile = `  compile-option = ${JSON.stringify(`--sysroot="${process.env.OHOS_SYSROOT}"`)}`;
    if (!manifest.includes(section + '\n')) throw new Error('OHOS target 清单缺失');
    writeFileSync(join(copy, member, 'cjpm.toml'), manifest.replace(section + '\n', section + '\n' + compile + '\n'));
    if (existsSync(join(root, member, 'cjpm.lock'))) cpSync(join(root, member, 'cjpm.lock'), join(copy, member, 'cjpm.lock'));
  }
  sourceRoot = copy;
}
const results = [];
const binaries = {};
const members = spec.os === 'ohos' ? ['core', 'apps/cli'] : ['core', 'apps/cli', 'apps/host', 'apps/daemon'];
for (const member of members) {
  const targetDir = join(report, 'target', member.split('/').at(-1));
  // 清掉本角色的私有上次产物，不能仅靠文件存在判断本次构建成功。
  rmSync(targetDir, { recursive: true, force: true });
  const args = ['build', '--target-dir', targetDir];
  if (spec.os === 'ohos') {
    args.push('--target', spec.triple);
  }
  const start = Date.now();
  try {
    await runBuild('cjpm', args, { cwd: join(sourceRoot, member), timeout: 1200000 });
    results.push({ member, exit: 0, elapsedMs: Date.now() - start });
    if (member !== 'core') {
      const candidates = [];
      const walk = dir => { for (const f of readdirSync(dir, { withFileTypes: true })) {
        const abs = join(dir, f.name); if (f.isDirectory()) walk(abs);
        else if (f.name === 'main' + spec.suffix) candidates.push(abs);
      } };
      walk(targetDir);
      if (candidates.length !== 1) throw new Error(`本轮产物不唯一 ${member}: ${candidates.join(', ')}`);
      binaries[member.split('/').at(-1)] = candidates[0];
    }
  } catch (e) {
    results.push({ member, exit: e.status, signal: e.signal, elapsedMs: Date.now() - start });
    writeFileSync(join(report, 'build.json'), JSON.stringify({ target: spec.target, version, results }, null, 2));
    throw e;
  }
}
// 单成员构建均叫 main，各角色必须独立 target，不能相互覆盖。
for (const binary of Object.values(binaries)) if (!existsSync(binary)) throw new Error(`构建成功但未取得本轮产物 ${binary}`);
writeFileSync(join(report, 'binaries.json'), JSON.stringify(binaries, null, 2));
writeFileSync(join(report, 'build.json'), JSON.stringify({ target: spec.target, version, results, deviceRunVerified: false }, null, 2));
