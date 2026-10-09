import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { syncBuiltinESMExports } from 'node:module';
import childProcess from 'node:child_process';

const scratch = join(dirname(fileURLToPath(import.meta.url)), '..', 'tmp');
const moduleUrl = new URL('./pack-computer-use.mjs', import.meta.url);
const hash = b => createHash('sha256').update(b).digest('hex');
// 小归档由测试自己写入，绝不执行 SDK 或原生内容。
function tar(entries) {
  const blocks = [];
  for (const [name, data] of entries) {
    const b = Buffer.from(data); const h = Buffer.alloc(512);
    h.write(name); h.write('0000755\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
    h.write(b.length.toString(8).padStart(11, '0') + '\0', 124);
    h.write('00000000000\0', 136); h.fill(32, 148, 156); h[156] = 48;
    h.write('ustar\0', 257); h.write('00', 263);
    h.write([...h].reduce((a, v) => a + v, 0).toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(h, b, Buffer.alloc((512 - b.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}
function crc32(b) {
  let c = 0xffffffff;
  for (const v of b) { c ^= v; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); }
  return (c ^ 0xffffffff) >>> 0;
}
function zip(entries) {
  const files = []; const directory = []; let offset = 0;
  for (const [name, text] of entries) {
    const n = Buffer.from(name); const b = Buffer.from(text); const h = Buffer.alloc(30); const c = Buffer.alloc(46);
    h.writeUInt32LE(0x04034b50); h.writeUInt16LE(20, 4); h.writeUInt32LE(crc32(b), 14);
    h.writeUInt32LE(b.length, 18); h.writeUInt32LE(b.length, 22); h.writeUInt16LE(n.length, 26);
    c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6);
    c.writeUInt32LE(crc32(b), 16); c.writeUInt32LE(b.length, 20); c.writeUInt32LE(b.length, 24);
    c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    files.push(h, n, b); directory.push(c, n); offset += h.length + n.length + b.length;
  }
  const d = Buffer.concat(directory); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(d.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...files, d, end]);
}
async function fixture(t, platform = 'linux', arch = 'x64', extras = []) {
  // 夹具落在仓库根的 tmp/（已 gitignore）：解包过程不在受版本控制的目录里留残渣。
  await fs.mkdir(scratch, { recursive: true });
  const dir = await fs.mkdtemp(join(scratch, 'pack-fixture-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const providerDir = join(dir, 'provider'); const sdkDir = join(dir, 'sdk');
  await fs.mkdir(providerDir); await fs.mkdir(join(sdkDir, 'computer-use'), { recursive: true });
  await fs.mkdir(join(sdkDir, 'dist'));
  await fs.writeFile(join(providerDir, 'provider.mjs'), "import '@qwen-code/cua-sdk/computer-use';\n");
  await fs.writeFile(join(providerDir, 'package.json'), JSON.stringify({ name: 'sacode-computer-use', version: '0.1.0', type: 'module', dependencies: { '@qwen-code/cua-sdk': '0.20.11' }, devDependencies: { nope: '1' }, scripts: { test: 'bad' } }));
  const manifest = { name: '@qwen-code/cua-sdk', version: '0.20.11', license: 'MIT', type: 'module', exports: { '.': './dist/index.js', './computer-use': './computer-use/index.js' }, files: ['dist', 'computer-use', 'LICENSE.md'], devDependencies: { nope: '1' }, scripts: { postinstall: 'bad' } };
  await fs.writeFile(join(sdkDir, 'package.json'), JSON.stringify(manifest));
  await fs.writeFile(join(sdkDir, 'LICENSE.md'), 'MIT License\nPermission is hereby granted, free of charge\n');
  await fs.writeFile(join(sdkDir, 'computer-use/index.js'), 'export const sample = 1;');
  await fs.writeFile(join(sdkDir, 'dist/index.js'), 'export const sample = 1;');
  await fs.mkdir(join(sdkDir, 'computer-use/test')); await fs.writeFile(join(sdkDir, 'computer-use/test/nope.js'), 'bad');
  const win = platform === 'win32'; const releaseArch = arch === 'x64' ? 'x86_64' : 'arm64';
  const name = `cua-driver-rs-0.20.11-${win ? 'windows' : 'linux'}-${releaseArch}-binary.${win ? 'zip' : 'tar.gz'}`;
  const entries = [[win ? 'cua_driver_sdk.dll' : 'libcua_driver_sdk.so', 'library'], ['cua_driver_node_runtime.node', 'native'], ...(win ? [['qwen-cua-driver-uia.exe', 'worker']] : []), ...extras];
  const bytes = win ? zip(entries) : tar(entries); const nativeArchive = join(dir, name); const checksumFile = join(dir, 'checksums.txt');
  await fs.writeFile(nativeArchive, bytes); await fs.writeFile(checksumFile, `${hash(bytes)}  ${name}\n`);
  return { dir, manifest, options: { providerDir, sdkDir, nativeArchive, checksumFile, outDir: join(dir, 'out'), nodeExecutable: process.execPath, platform, arch } };
}
async function pack(options) { const m = await import(moduleUrl); return m.packComputerUse(options); }

for (const arch of ['x64', 'arm64']) test(`Linux ${arch} 真实归档打包保持导出并排除开发内容`, async t => {
  const { options } = await fixture(t, 'linux', arch); await pack(options);
  const sdk = join(options.outDir, 'node_modules/@qwen-code/cua-sdk');
  assert.equal(await fs.readFile(join(options.outDir, 'provider.mjs'), 'utf8'), await fs.readFile(join(options.providerDir, 'provider.mjs'), 'utf8'));
  const p = JSON.parse(await fs.readFile(join(sdk, 'package.json')));
  assert.equal(p.exports['./computer-use'], './computer-use/index.js'); assert.equal(p.devDependencies, undefined); assert.equal(p.scripts, undefined);
  assert.equal(await fs.readFile(join(sdk, `.native/linux-${arch === 'x64' ? 'x86_64' : 'arm64'}/libcua_driver_sdk.so`), 'utf8'), 'library');
  await assert.rejects(fs.stat(join(sdk, 'computer-use/test')));
  assert.ok(await fs.stat(join(sdk, 'LICENSE.md')));
  assert.ok(!(await fs.readFile(join(options.outDir, 'package.json'), 'utf8')).includes(options.providerDir));
});
for (const [name, change, expected] of [
  ['坏 checksum', async f => fs.writeFile(f.options.checksumFile, `${'0'.repeat(64)}  ${f.options.nativeArchive.split(/[\\/]/).pop()}\n`), /checksum|SHA256/i],
  ['错误 SDK', async f => fs.writeFile(join(f.options.sdkDir, 'package.json'), JSON.stringify({ ...f.manifest, version: '0.20.10' })), /SDK/],
  ['非 MIT SDK', async f => fs.writeFile(join(f.options.sdkDir, 'package.json'), JSON.stringify({ ...f.manifest, license: 'Apache-2.0' })), /SDK.*MIT/],
  ['重复 checksum 条目', async f => { const text = await fs.readFile(f.options.checksumFile); await fs.appendFile(f.options.checksumFile, text); }, /checksum/],
  ['缺 provider', async f => fs.unlink(join(f.options.providerDir, 'provider.mjs')), /provider/i],
  ['缺 license', async f => fs.unlink(join(f.options.sdkDir, 'LICENSE.md')), /license|许可证/i],
  ['不可信 Node', async f => { f.options.nodeExecutable = f.options.nativeArchive; }, /Node/],
  ['不支持 asset', async f => { f.options.platform = 'darwin'; }, /平台|asset/],
  ['缺生产依赖', async f => fs.writeFile(join(f.options.sdkDir, 'package.json'), JSON.stringify({ ...f.manifest, dependencies: { missing: '1.0.0' } })), /依赖/],
]) test(`${name} 拒绝且不留下发布或暂存目录`, async t => {
  const f = await fixture(t); await change(f); await assert.rejects(pack(f.options), expected);
  await assert.rejects(fs.stat(f.options.outDir)); assert.ok(!(await fs.readdir(f.dir)).some(n => n.includes('.pack-')));
});
test('已有 outDir 及其内容保持原样', async t => {
  const { options } = await fixture(t); await fs.mkdir(options.outDir); await fs.writeFile(join(options.outDir, 'keep'), 'untouched');
  await assert.rejects(pack(options), /已存在/); assert.equal(await fs.readFile(join(options.outDir, 'keep'), 'utf8'), 'untouched');
});
test('原生归档路径穿越拒绝', async t => {
  const { options, dir } = await fixture(t, 'linux', 'x64', [['../escape', 'bad']]);
  await assert.rejects(pack(options), /归档路径/); await assert.rejects(fs.stat(join(dir, 'escape')));
});
test('生产依赖及嵌套 package scope 保留，连续构建内容一致', async t => {
  const { options, manifest, dir } = await fixture(t);
  const dep = join(options.sdkDir, 'node_modules/local-dep');
  await fs.mkdir(join(dep, 'lib'), { recursive: true });
  await fs.writeFile(join(dep, 'package.json'), JSON.stringify({ name: 'local-dep', version: '1.0.0', main: './lib/index.js' }));
  await fs.writeFile(join(dep, 'LICENSE'), 'MIT License');
  await fs.writeFile(join(dep, 'lib/index.js'), 'module.exports = 1;');
  await fs.writeFile(join(dep, 'lib/package.json'), JSON.stringify({ type: 'commonjs' }));
  await fs.writeFile(join(options.sdkDir, 'package.json'), JSON.stringify({ ...manifest, dependencies: { 'local-dep': '1.0.0' } }));
  await pack(options);
  const bundledNode = join(options.outDir, options.platform === 'win32' ? 'node.exe' : 'node');
  assert.equal(hash(await fs.readFile(bundledNode)), hash(await fs.readFile(process.execPath)));
  const nested = 'node_modules/@qwen-code/cua-sdk/node_modules/local-dep/lib/package.json';
  assert.equal(JSON.parse(await fs.readFile(join(options.outDir, nested))).type, 'commonjs');
  const other = join(dir, 'out2'); await pack({ ...options, outDir: other });
  const snapshot = async (at, prefix = '') => {
    const result = [];
    for (const name of (await fs.readdir(at)).sort()) {
      const p = join(at, name); const key = prefix + name;
      if ((await fs.stat(p)).isDirectory()) result.push(...await snapshot(p, key + '/'));
      else result.push([key, hash(await fs.readFile(p))]);
    }
    return result;
  };
  assert.deepEqual(await snapshot(options.outDir), await snapshot(other));
});
test('Windows 真实 OS 签名检查拒绝非有效 PE 小归档', { skip: process.platform !== 'win32' }, async t => {
  const { options, dir } = await fixture(t, 'win32');
  // 小夹具不是 PE；真实 Windows 会报告 UnknownError，而不是可执行 PE 的 NotSigned。
  await assert.rejects(pack(options), /Authenticode.*(?:NotSigned|UnknownError)/);
  await assert.rejects(fs.stat(options.outDir));
  assert.ok(!(await fs.readdir(dir)).some(n => n.includes('.pack-')));
});
// 只替换 OS 签名命令；文件系统与摘要验证仍走真实实现。
for (const status of ['NotSigned', 'Valid']) test(`Windows worker Authenticode=${status}`, async t => {
  const { options } = await fixture(t, 'win32');
  const original = childProcess.execFileSync;
  childProcess.execFileSync = (exe, args, config) => {
    assert.match(exe, /powershell/i); assert.ok(args.join(' ').includes('Get-AuthenticodeSignature'));
    assert.ok(config.env.SACODE_SIGNATURE_FILE.endsWith('qwen-cua-driver-uia.exe'));
    return status;
  };
  syncBuiltinESMExports();
  try {
    if (status === 'Valid') { await pack(options); assert.ok(await fs.stat(options.outDir)); }
    else { await assert.rejects(pack(options), /Authenticode.*NotSigned/); await assert.rejects(fs.stat(options.outDir)); }
  } finally { childProcess.execFileSync = original; syncBuiltinESMExports(); }
});
