// 从本次构建的同平台载荷生成 npm tgz、服务压缩包与桌面候选，不自动发布。
import { execFileSync } from 'node:child_process';
import { mkdirSync, cpSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectedPlatform } from './platform.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const spec = selectedPlatform();
const output = join(root, 'apps/desktop/dist/releases', spec.target);
// 输出只属于本目标本次打包，清掉旧文件避免将旧安装器混入校验和。
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
execFileSync(process.execPath, ['scripts/pack-cli.mjs', '--no-build'], { cwd: root, stdio: 'inherit' });
const platform = join(root, 'npm', `sacode-cli-${spec.target}`);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npmRun = (args, cwd) => {
  if (process.platform === 'win32') execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', npm, ...args], { cwd, stdio: 'inherit' });
  else execFileSync(npm, args, { cwd, stdio: 'inherit' });
};
if (spec.os === 'ohos') {
  execFileSync('tar', ['-czf', join(output, `sacode-${spec.target}.tar.gz`), '-C', platform, '.'], { stdio: 'inherit' });
} else {
  npmRun(['pack', '--pack-destination', output], platform);
  npmRun(['pack', '--pack-destination', output], join(root, 'npm/sacode-cli'));
  execFileSync('tar', ['-czf', join(output, `sacode-${spec.target}.tar.gz`), '-C', platform, '.'], { stdio: 'inherit' });
  const host = join(platform, 'bin', `sacode-host${spec.suffix}`);
  execFileSync(process.execPath, ['scripts/pack-host.mjs', host, 'apps/desktop/dist/host', join(platform, 'bin'),
    ...(process.env.SACODE_CA_BUNDLE ? [`--ca-bundle=${process.env.SACODE_CA_BUNDLE}`] : [])], { cwd: root, stdio: 'inherit' });
  npmRun(['ci'], join(root, 'apps/desktop'));
  npmRun(['run', 'vendor'], join(root, 'apps/desktop'));
  rmSync(join(root, 'apps/desktop/dist/electron'), { recursive: true, force: true });
  const osFlag = { win32: '--win', linux: '--linux', darwin: '--mac' }[spec.os];
  npmRun(['exec', '--', 'electron-builder', osFlag, `--${spec.cpu}`, '--publish', 'never',
    '--config.electronDist=node_modules/electron/dist'], join(root, 'apps/desktop'));
  const unpacked = spec.os === 'darwin' ? 'mac' + (spec.cpu === 'arm64' ? '-arm64' : '') + '/SaCode.app'
    : spec.os === 'win32' ? 'win-unpacked' : 'linux' + (spec.cpu === 'arm64' ? '-arm64' : '') + '-unpacked';
  execFileSync(process.execPath, ['scripts/verify-desktop-payload.mjs', join(root, 'apps/desktop/dist/electron', unpacked)],
    { cwd: root, stdio: 'inherit' });
  for (const file of readdirSync(join(root, 'apps/desktop/dist/electron'))) {
    if (/\.(?:exe|AppImage|deb|dmg|zip|blockmap|yml)$/.test(file)) cpSync(join(root, 'apps/desktop/dist/electron', file), join(output, file));
  }
}
const sums = readdirSync(output).filter(f => f !== 'SHA256SUMS' && f !== 'build.json').sort()
  .map(f => `${createHash('sha256').update(readFileSync(join(output, f))).digest('hex')}  ${f}`).join('\n');
writeFileSync(join(output, 'SHA256SUMS'), sums + '\n');
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
writeFileSync(join(output, 'build.json'), JSON.stringify({ sha, target: spec.target, deviceRunVerified: false,
  dirty: !!execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' }).trim() }, null, 2) + '\n');
console.log(`构建候选 ${output}，未自动发布或宣称设备运行通过`);
