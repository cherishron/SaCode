/**
 * bundle-sidecar.mjs — 构建 release sacode CLI 并复制为 Tauri externalBin。
 *
 * Tauri externalBin 约定：src-tauri/binaries/<name>-<target-triple>[.exe]。
 * 挂在 `npm run tauri -- build` 的 beforeBuildCommand 链首，保证任何环境
 * （本地 / CI）打出的安装器都内嵌 sacode 后端，双击即可用、无需额外服务。
 *
 * 用法：node scripts/bundle-sidecar.mjs
 * 可用环境变量：
 *   SACODE_SIDECAR_SKIP_BUILD=1  跳过 cargo build（假定 target/release/sacode.exe 已存在）
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const repoRoot = path.resolve(desktopDir, '..', '..');
const srcTauri = path.join(desktopDir, 'src-tauri');

function hostTriple() {
  // 不用 `rustc -vV` 子进程（cmd.exe 在沙箱/CI 中可能 EBUSY）。
  // 直接从 Node 的 platform/arch 推导，覆盖 SaCode 支持的全部平台。
  const p = process.platform;
  const a = process.arch;
  if (p === 'win32' && a === 'x64') return 'x86_64-pc-windows-msvc';
  if (p === 'win32' && a === 'arm64') return 'aarch64-pc-windows-msvc';
  if (p === 'darwin' && a === 'x64') return 'x86_64-apple-darwin';
  if (p === 'darwin' && a === 'arm64') return 'aarch64-apple-darwin';
  if (p === 'linux' && a === 'x64') return 'x86_64-unknown-linux-gnu';
  if (p === 'linux' && a === 'arm64') return 'aarch64-unknown-linux-gnu';
  throw new Error(`不支持的 platform/arch: ${p}/${a}`);
}

function main() {
  const triple = hostTriple();
  const isWindows = process.platform === 'win32';
  const builtName = isWindows ? 'sacode.exe' : 'sacode';
  const src = path.join(repoRoot, 'target', 'release', builtName);

  if (process.env.SACODE_SIDECAR_SKIP_BUILD !== '1') {
    console.log('[bundle-sidecar] cargo build --release -p sacode-cli --bin sacode ...');
    execSync('cargo build --release -p sacode-cli --bin sacode', {
      cwd: repoRoot,
      stdio: 'inherit',
    });
  }

  if (!fs.existsSync(src)) {
    throw new Error(`未找到 release sacode 二进制：${src}（先去掉 SACODE_SIDECAR_SKIP_BUILD 再跑）`);
  }

  const outDir = path.join(srcTauri, 'binaries');
  fs.mkdirSync(outDir, { recursive: true });
  const dest = path.join(outDir, `sacode-${triple}${isWindows ? '.exe' : ''}`);
  fs.copyFileSync(src, dest);
  const sizeMb = (fs.statSync(dest).size / 1024 / 1024).toFixed(1);
  console.log(`[bundle-sidecar] ${path.relative(repoRoot, src)} -> ${path.relative(repoRoot, dest)} (${sizeMb} MB, triple=${triple})`);
}

main();
