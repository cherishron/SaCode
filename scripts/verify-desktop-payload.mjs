// 检查本次目录候选的资源与有限 require 依赖，不运行旧页面套件。
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2];
if (!out) throw new Error('用法：node scripts/verify-desktop-payload.mjs <本次解包应用目录>');
const base = resolve(out);
const resources = process.platform === 'darwin' ? join(base, 'Contents/Resources') : join(base, 'resources');
const require = createRequire(join(root, 'apps/desktop/package.json'));
const asar = require('@electron/asar');
const archive = join(resources, 'app.asar');
assert(existsSync(archive), '缺 app.asar');
const entries = new Set(asar.listPackage(archive).map(p => p.replace(/^[/\\]/, '').replaceAll('\\', '/')));
let count = 0;
for (const f of entries) {
  if (!/\.cjs$/.test(f) || f.startsWith('test-support/')) continue;
  const text = asar.extractFile(archive, f).toString('utf8');
  for (const m of text.matchAll(/require\(["'](\.\.?\/[\w./-]+)["']\)/g)) {
    const target = join(dirname(f), m[1]).replaceAll('\\', '/');
    assert(entries.has(target) || entries.has(target + '.cjs') || entries.has(target + '.js'), `缺 require 依赖 ${f} -> ${target}`); count++;
  }
}
const host = join(resources, 'host/bin', process.platform === 'win32' ? 'sacode-host.exe' : 'sacode-host');
assert(existsSync(host), '缺包内宿主');
assert(readdirSync(dirname(host)).some(f => /\.dll$|\.so(?:\.|$)|\.dylib$/.test(f)), '缺宿主动态库');
console.log(`桌面载荷依赖 PASS ${count}；宿主与库存在，不代替真实窗口/任务运行`);
