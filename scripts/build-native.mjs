// 先构建目标平台薄层，再 cjpm build；工具链或目标不匹配直接失败。
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const target = process.env.SACODE_TARGET || `${process.platform}-${process.arch}`;
const targets = {
  'linux-x64': ['x86_64-unknown-linux-gnu', 'linux-x64'],
  'linux-arm64': ['aarch64-unknown-linux-gnu', 'linux-arm64'],
  'darwin-x64': ['x86_64-apple-darwin', 'darwin-x64'],
  'darwin-arm64': ['aarch64-apple-darwin', 'darwin-arm64'],
  'ohos-arm64': ['aarch64-linux-ohos', 'ohos-arm64'],
  'ohos-x64': ['x86_64-linux-ohos', 'ohos-x64'],
};
if (target === 'win32-x64') { console.log('Windows 使用现有系统 FFI，无 POSIX 薄层'); process.exit(0); }
const spec = targets[target];
if (!spec) throw new Error(`不支持的原生目标 ${target}`);
const out = join(root, '.deps', 'native', spec[1]);
mkdirSync(out, { recursive: true });
const args = ['-std=c11', '-O2', '-fPIC', '-Wall', '-Wextra', '-Werror', '-c', join(root, 'core/native/platform_posix.c'), '-o', join(out, 'platform.o')];
if (target.startsWith('ohos-')) {
  if (!process.env.OHOS_SYSROOT || !process.env.OHOS_CC) throw new Error('OHOS 需显式提供 OHOS_CC 与 OHOS_SYSROOT；不使用 GNU Linux ABI');
  args.unshift(`--target=${spec[0]}`, `--sysroot=${process.env.OHOS_SYSROOT}`);
} else if (target !== `${process.platform}-${process.arch}`) {
  throw new Error('非 OHOS 交叉构建需独立工具链；本脚本只自动构建本机平台');
}
execFileSync(process.env.OHOS_CC && target.startsWith('ohos-') ? process.env.OHOS_CC : process.env.CC || 'cc', args, { stdio: 'inherit' });
execFileSync(target.startsWith('ohos-') ? process.env.OHOS_AR || process.env.AR || 'ar' : process.env.AR || 'ar',
  ['rcs', join(out, 'libsacode_platform.a'), join(out, 'platform.o')], { stdio: 'inherit' });
console.log(`原生静态薄层：${out}`);
if (process.argv.includes('--verify')) {
  if (target.startsWith('ohos-')) throw new Error('OHOS 交叉产物不能在 Linux 冒充运行验证');
  const base = join(root, 'apps/desktop/.tmp-test/native-verification'); mkdirSync(base, { recursive: true });
  const temporary = mkdtempSync(join(base, spec[1] + '-'));
  try {
    const exe = join(temporary, 'verify');
    execFileSync(process.env.CC || 'cc', ['-std=c11', '-Wall', '-Wextra', '-Werror', join(root, 'scripts/verify-posix.c'),
      join(out, 'libsacode_platform.a'), '-o', exe], { stdio: 'inherit' });
    execFileSync(exe, [temporary], { stdio: 'inherit', timeout: 10000 });
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
