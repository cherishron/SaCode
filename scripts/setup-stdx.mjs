// 匹配仓颉 1.1.3 的 stdx 资产从官方 release 查询，不猜下载地址；离线目录优先。
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, writeFileSync, cpSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectedPlatform } from './platform.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const spec = selectedPlatform();
const base = join(root, '.deps', 'stdx');
mkdirSync(base, { recursive: true });
let directory = process.env.SACODE_STDX_LIB_DIR;
if (directory && !existsSync(join(directory, 'stdx.crypto.common.cjo'))) throw new Error('SACODE_STDX_LIB_DIR 缺 stdx.crypto.common.cjo');
function findLibrary(dir) {
  if (existsSync(join(dir, 'stdx.crypto.common.cjo'))) return dir;
  for (const child of readdirSync(dir, { withFileTypes: true })) {
    if (child.isDirectory()) { const hit = findLibrary(join(dir, child.name)); if (hit) return hit; }
  }
}
if (!directory) directory = existsSync(join(base, spec.folder)) ? findLibrary(join(base, spec.folder)) : undefined;
if (!directory && existsSync(join(base, spec.asset))) directory = findLibrary(join(base, spec.asset));
if (!directory) {
  const version = '1.1.3.1';
  const assetName = `cangjie-stdx-${spec.asset}-${version}.zip`;
  const response = await fetch(`https://gitcode.com/api/v5/repos/Cangjie/cangjie_stdx/releases/tags/v${version}`, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`查询 stdx 官方 release 失败 ${response.status}`);
  const release = await response.json();
  const asset = release.assets?.find(a => a.name === assetName);
  const url = asset?.browser_download_url;
  if (!url || !url.startsWith('https://')) throw new Error(`官方发行件不存在 ${assetName}`);
  const download = await fetch(url, { signal: AbortSignal.timeout(600000) });
  if (!download.ok) throw new Error(`下载 stdx 失败 ${download.status}`);
  const bytes = Buffer.from(await download.arrayBuffer());
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (process.env.SACODE_STDX_SHA256 && process.env.SACODE_STDX_SHA256 !== digest) throw new Error('stdx SHA256 不匹配');
  const archive = join(base, assetName); writeFileSync(archive, bytes);
  const unpack = join(base, spec.asset); mkdirSync(unpack, { recursive: true });
  if (process.platform === 'win32') execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${archive.replaceAll("'", "''")}' -DestinationPath '${unpack.replaceAll("'", "''")}' -Force`], { stdio: 'inherit' });
  else execFileSync('unzip', ['-o', '-q', archive, '-d', unpack], { stdio: 'inherit' });
  directory = findLibrary(unpack);
  if (!directory) throw new Error('stdx 发行件未找到 crypto.common 编译接口');
  writeFileSync(join(base, `download-${spec.target}.json`), JSON.stringify({ url, version, assetName, sha256: digest }, null, 2));
}
directory = resolve(directory);
// Windows 现有清单用根 .deps 相对路径，显式来源复制到相同布局；不改 cjpm 清单。
if (spec.os === 'win32') {
  const dest = join(base, spec.folder, 'dynamic', 'stdx');
  if (resolve(dest) !== directory) { mkdirSync(dest, { recursive: true }); cpSync(directory, dest, { recursive: true }); directory = dest; }
}
writeFileSync(join(base, `resolved-${spec.target}.json`), JSON.stringify({ target: spec.target, directory, version: '1.1.3.1' }, null, 2));
console.log(`SACODE_STDX_LIB_DIR=${directory}`);
if (process.env.GITHUB_ENV) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env.GITHUB_ENV, `SACODE_STDX_LIB_DIR=${directory}\n`);
}
