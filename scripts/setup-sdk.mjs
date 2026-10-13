// CI 工具链 provisioning：管理员配置官方发行 URL + 固定 SHA256，不猜资产路径或浮动版本。
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readdirSync, existsSync, appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
const manifest = JSON.parse(readFileSync(new URL('./sdk-assets.json', import.meta.url), 'utf8'));
const asset = manifest.assets[process.env.SACODE_SDK_HOST_TARGET || process.env.SACODE_TARGET || `${process.platform}-${process.arch}`];
const url = process.env.SACODE_SDK_URL || asset?.url;
const expected = process.env.SACODE_SDK_SHA256 || asset?.sha256;
if (!!process.env.SACODE_SDK_URL !== !!process.env.SACODE_SDK_SHA256) throw new Error('覆盖 SDK 下载地址与 SHA256 必须成对提供');
if (!url?.startsWith('https://') || !/^[a-fA-F0-9]{64}$/.test(expected || '')) throw new Error('需配置官方 SACODE_SDK_URL 与 SACODE_SDK_SHA256，不能假装 SDK 已存在');
const response = await fetch(url, { signal: AbortSignal.timeout(600000) });
if (!response.ok) throw new Error(`下载 SDK 失败 ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
if (createHash('sha256').update(bytes).digest('hex') !== expected.toLowerCase()) throw new Error('SDK SHA256 不匹配');
const out = resolve('.deps/sdk'); mkdirSync(out, { recursive: true });
const zip = (new URL(url).searchParams.get('fileName') || new URL(url).pathname).endsWith('.zip');
const archive = join(out, zip ? 'sdk.zip' : 'sdk.tar.gz'); writeFileSync(archive, bytes);
if (zip && process.platform === 'win32') execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${out}' -Force`], { stdio: 'inherit' });
else if (zip) execFileSync('unzip', ['-q', '-o', archive, '-d', out], { stdio: 'inherit' });
else execFileSync('tar', ['-xf', archive, '-C', out], { stdio: 'inherit' });
function find(dir) {
  if (existsSync(join(dir, 'bin', process.platform === 'win32' ? 'cjc.exe' : 'cjc'))) return dir;
  for (const child of readdirSync(dir, { withFileTypes: true })) if (child.isDirectory()) { const found = find(join(dir, child.name)); if (found) return found; }
}
const home = find(out); if (!home) throw new Error('SDK 缺 cjc');
if (process.env.GITHUB_ENV && process.env.GITHUB_PATH) {
  appendFileSync(process.env.GITHUB_ENV, `CANGJIE_HOME=${home}\n`);
  appendFileSync(process.env.GITHUB_PATH, join(home, 'bin') + '\n' + join(home, 'tools/bin') + '\n');
}
// 本机入口只落位，不修改系统 PATH 或 shell 配置；由用户 source SDK 的 envsetup。
console.log(`SDK 来源 ${url}，SHA256 ${expected}；路径 ${home}`);
