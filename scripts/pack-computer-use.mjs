// 本地离线打包合同：SDK 为已展开的 npm 包，生产依赖须已安装在其 Node 查找链上。
// checksumFile 为调用方从官方渠道取得的 sha256sum 清单；本脚本不联网，也不把清单自称为签名。
// nativeArchive 必须使用官方资产名；直接解析 ZIP / ustar tar.gz，禁止执行安装脚本及归档命令。
// nodeExecutable 只接受当前独立 Node >=22 exe，不执行任意输入 exe。
// 独立 Node 随 provider 分发，入口只从 resourcesPath 解析，不复用 Electron。
// Linux 必须使用 glibc；无需传本机原生目录。
// 发布父目录应由调用方独占；同一打包器的并发调用由排他锁保护，失败只清理自己新建的暂存目录。
import * as fs from 'node:fs/promises';
import { resolve, join, dirname, basename, isAbsolute, relative, parse } from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync, inflateRawSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';

const VERSION = '0.20.11';
const SDK = '@qwen-code/cua-sdk';
const LIMIT = 512 * 1024 * 1024;
const fail = message => { throw new Error(`pack-computer-use：${message}`); };
async function exists(path) {
  try { await fs.lstat(path); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
}
async function regular(path, label) {
  const s = await fs.lstat(path).catch(() => fail(`${label} 缺失`));
  if (!s.isFile() || s.isSymbolicLink()) fail(`${label} 必须是普通文件`);
}
const digest = data => createHash('sha256').update(data).digest('hex');
function safePath(name) {
  if (!name || name.includes('\\') || name.includes(':') || name.includes('\0') || isAbsolute(name) || name.split('/').some(p => p === '..' || p === '' && name !== './')) fail(`不安全归档路径：${name}`);
  const clean = name.replace(/^\.\//, '');
  if (!clean || clean.split('/').some(p => p === '.' || p === '..')) fail(`不安全归档路径：${name}`);
  return clean;
}
function crc32(b) {
  let c = 0xffffffff;
  for (const v of b) { c ^= v; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); }
  return (c ^ 0xffffffff) >>> 0;
}
function unzip(b) {
  let end = b.length - 22;
  while (end >= Math.max(0, b.length - 65557) && b.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0 || end < b.length - 65557) fail('ZIP 中央目录缺失');
  if (b.readUInt16LE(end + 4) || b.readUInt16LE(end + 6) || b.readUInt16LE(end + 8) !== b.readUInt16LE(end + 10) || end + 22 + b.readUInt16LE(end + 20) !== b.length) fail('不支持分卷 ZIP');
  const count = b.readUInt16LE(end + 10); let offset = b.readUInt32LE(end + 16); const result = [];
  if (count === 65535 || offset + b.readUInt32LE(end + 12) !== end) fail('ZIP64 或中央目录损坏');
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || b.readUInt32LE(offset) !== 0x02014b50) fail('ZIP 条目损坏');
    const flags = b.readUInt16LE(offset + 8); const method = b.readUInt16LE(offset + 10);
    const compressed = b.readUInt32LE(offset + 20); const size = b.readUInt32LE(offset + 24);
    const length = b.readUInt16LE(offset + 28); const extra = b.readUInt16LE(offset + 30); const comment = b.readUInt16LE(offset + 32);
    const mode = b.readUInt32LE(offset + 38) >>> 16; const local = b.readUInt32LE(offset + 42);
    if (flags & 1 || ![0, 8].includes(method) || size > LIMIT || (mode & 0xf000) === 0xa000 || b.readUInt16LE(offset + 34)) fail('不支持加密、链接或特殊 ZIP 条目');
    if (offset + 46 + length + extra + comment > end) fail('ZIP 目录截断');
    const rawName = b.subarray(offset + 46, offset + 46 + length);
    const name = rawName.toString('utf8'); const directory = name.endsWith('/');
    safePath(directory ? name.slice(0, -1) : name);
    if (local + 30 > b.readUInt32LE(end + 16) || b.readUInt32LE(local) !== 0x04034b50) fail('ZIP 本地头损坏');
    const localName = b.readUInt16LE(local + 26); const localExtra = b.readUInt16LE(local + 28);
    if (!b.subarray(local + 30, local + 30 + localName).equals(rawName) || b.readUInt16LE(local + 8) !== method || b.readUInt16LE(local + 6) !== flags) fail('ZIP 本地头不匹配');
    const start = local + 30 + localName + localExtra;
    if (start + compressed > b.readUInt32LE(end + 16)) fail('ZIP 数据截断');
    const data = method === 0 ? b.subarray(start, start + compressed) : inflateRawSync(b.subarray(start, start + compressed), { maxOutputLength: LIMIT });
    if (data.length !== size || crc32(data) !== b.readUInt32LE(offset + 16)) fail('ZIP 大小或 CRC 不符');
    if (!directory) result.push([safePath(name), data, mode & 0o777]);
    offset += 46 + length + extra + comment;
  }
  if (offset !== end) fail('ZIP 目录长度不符');
  return result;
}
function untar(compressed) {
  const b = gunzipSync(compressed, { maxOutputLength: LIMIT }); const result = []; let offset = 0;
  const text = (h, start, length) => h.subarray(start, start + length).toString('utf8').split('\0')[0];
  const octal = value => { if (!/^[0-7]+$/.test(value.trim())) fail('tar 数字字段损坏'); return Number.parseInt(value.trim(), 8); };
  while (offset + 512 <= b.length) {
    const h = b.subarray(offset, offset + 512);
    if (h.every(v => v === 0)) {
      if (b.length - offset < 1024 || !b.subarray(offset).every(v => v === 0)) fail('tar 结束标记损坏');
      return result;
    }
    const expected = octal(text(h, 148, 8)); const copy = Buffer.from(h); copy.fill(32, 148, 156);
    if ([...copy].reduce((a, v) => a + v, 0) !== expected) fail('tar 头 checksum 不符');
    const size = octal(text(h, 124, 12)); const type = h[156];
    const prefix = text(h, 345, 155); const raw = (prefix ? prefix + '/' : '') + text(h, 0, 100);
    if (![0, 48, 53].includes(type)) fail('tar 禁止链接、PAX 及特殊条目');
    if (type === 53 && (raw === './' || raw === '.')) {
      if (size !== 0) fail('tar 根目录含数据');
      offset += 512; continue;
    }
    const name = safePath(type === 53 && raw.endsWith('/') ? raw.slice(0, -1) : raw);
    offset += 512;
    if (size > LIMIT || offset + size > b.length) fail('tar 数据截断');
    if (type !== 53) result.push([name, b.subarray(offset, offset + size), octal(text(h, 100, 8)) & 0o777]);
    offset += Math.ceil(size / 512) * 512;
  }
  fail('tar 缺结束标记');
}
function target(platform, arch) {
  if (!['win32-x64', 'linux-x64', 'linux-arm64'].includes(`${platform}-${arch}`)) fail('平台没有允许的官方 asset');
  const key = `${platform === 'win32' ? 'windows' : 'linux'}-${arch === 'x64' ? 'x86_64' : 'arm64'}`;
  return { key, archive: `cua-driver-rs-${VERSION}-${key}-binary.${platform === 'win32' ? 'zip' : 'tar.gz'}`, required: [platform === 'win32' ? 'cua_driver_sdk.dll' : 'libcua_driver_sdk.so', 'cua_driver_node_runtime.node', ...(platform === 'win32' ? ['qwen-cua-driver-uia.exe'] : [])] };
}
function cleanManifest(p) {
  // 白名单保留运行时解析字段；不输出 registry 元数据、scripts、开发依赖或本机路径。
  const result = {};
  for (const key of ['name', 'version', 'type', 'license', 'main', 'module', 'types', 'exports', 'imports', 'engines', 'dependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta', 'bin', 'browser', 'sideEffects']) if (p[key] !== undefined) result[key] = p[key];
  for (const [name, spec] of Object.entries({ ...p.dependencies, ...p.optionalDependencies, ...p.peerDependencies })) {
    if (!/^(@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i.test(name) || typeof spec !== 'string' || /(?:file:|link:|workspace:|[\\/]|:)/.test(spec)) fail(`依赖不是可移植版本：${name}`);
  }
  const check = value => {
    if (typeof value === 'string' && (isAbsolute(value) || /^[A-Za-z]:|\\|\.\.\//.test(value))) fail('manifest 包含绝对或越界路径');
    if (value && typeof value === 'object') for (const child of Object.values(value)) check(child);
  };
  for (const key of ['main', 'module', 'types', 'exports', 'imports', 'bin', 'browser']) check(result[key]);
  return result;
}
const excluded = name => /^(?:test|tests|__tests__|node_modules|\.native|\.git|coverage|examples?|\.cache)$/i.test(name) || /(?:\.test\.|\.spec\.|\.map$|^tsconfig|lock\.|^package-lock|^\.npmrc|^\.env)/i.test(name);
async function copyTree(source, dest) {
  const s = await fs.lstat(source);
  if (s.isSymbolicLink() || (!s.isDirectory() && !s.isFile())) fail('包中禁止符号链接及特殊文件');
  if (s.isDirectory()) {
    await fs.mkdir(dest, { recursive: true });
    for (const name of (await fs.readdir(source)).sort()) {
      if (excluded(name)) continue;
      if (name === 'package.json') {
        await regular(join(source, name), '嵌套 package.json');
        await writeJson(join(dest, name), cleanManifest(await json(join(source, name))));
      } else await copyTree(join(source, name), join(dest, name));
    }
  } else {
    await fs.mkdir(dirname(dest), { recursive: true }); await fs.copyFile(source, dest, fs.constants.COPYFILE_EXCL);
    await fs.chmod(dest, s.mode & 0o777);
  }
}
async function json(path) { return JSON.parse(await fs.readFile(path, 'utf8')); }
async function writeJson(path, value) { await fs.writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); }
// Windows 上刚写完的整棵树常被杀软/索引器短暂持有句柄，rename 会抛 EPERM 而不是真冲突；
// 只在目标确实还不存在时重试，避免把「已有人占了 outDir」误当成锁抖动盖掉。
async function publishRename(source, dest) {
  for (let attempt = 0; ; attempt++) {
    try { await fs.rename(source, dest); return; }
    catch (error) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error?.code) || attempt === 9 || await exists(dest)) throw error;
      await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
}
async function findDependency(source, name) {
  let at = source;
  while (true) {
    const candidate = join(at, 'node_modules', name);
    if (await exists(join(candidate, 'package.json'))) return candidate;
    const next = dirname(at); if (next === at) fail(`缺少本地生产依赖：${name}`); at = next;
  }
}
async function packageCopy(source, dest, expectedName, ancestors = new Map()) {
  const p = await json(join(source, 'package.json'));
  if (p.name !== expectedName) fail(`依赖包名不匹配：${expectedName}`);
  const sourceReal = await fs.realpath(source);
  if (ancestors.has(sourceReal)) return;
  await fs.mkdir(dest, { recursive: true });
  // SDK 固定公共目录；其他依赖保留运行时树，但过滤测试与安装脚本。
  const names = expectedName === SDK ? ['dist', 'computer-use', ...(await fs.readdir(source)).filter(n => /^(?:LICENSE|NOTICE)(?:\.|$)/i.test(n))] : await fs.readdir(source);
  if (!names.some(n => /^LICENSE(?:\.|$)/i.test(n))) fail(`包缺许可证 license：${expectedName}`);
  for (const name of names.sort()) if (!excluded(name) && name !== 'package.json' && name !== 'scripts') await copyTree(join(source, name), join(dest, name));
  await writeJson(join(dest, 'package.json'), cleanManifest(p));
  // 校验所有静态 export 叶子，保留目录，不只拷 dist 而丢 computer-use。
  const verify = async value => {
    if (typeof value === 'string' && value.startsWith('./') && !value.includes('*')) await regular(join(dest, value), `导出 ${value}`);
    else if (value && typeof value === 'object') for (const child of Object.values(value)) await verify(child);
  };
  await verify(p.exports);
  const chain = new Map(ancestors); chain.set(sourceReal, dest);
  for (const name of Object.keys({ ...p.dependencies, ...p.optionalDependencies, ...p.peerDependencies }).sort()) {
    const dependency = await findDependency(source, name);
    const real = await fs.realpath(dependency);
    if (!chain.has(real)) await packageCopy(dependency, join(dest, 'node_modules', name), name, chain);
  }
}

export async function packComputerUse({ providerDir, sdkDir, nativeArchive, checksumFile, outDir, nodeExecutable, platform = process.platform, arch = process.arch }) {
  for (const [key, value] of Object.entries({ providerDir, sdkDir, nativeArchive, checksumFile, outDir, nodeExecutable })) if (typeof value !== 'string' || !isAbsolute(value)) fail(`${key} 必须是绝对路径`);
  const out = resolve(outDir); const parent = dirname(out);
  if (out === parse(out).root) fail('输出不能是根目录');
  if (await exists(out)) fail('outDir 已存在，拒绝覆盖');
  if (!(await fs.lstat(parent)).isDirectory()) fail('输出父目录不存在');
  for (const input of [providerDir, sdkDir]) {
    const rel = relative(resolve(input), out);
    if (!rel || (!rel.startsWith('..') && !isAbsolute(rel))) fail('输出不能位于输入目录内');
  }
  const asset = target(platform, arch);
  if (Number(process.versions.node.split('.')[0]) < 22 || process.versions.electron) fail('必须使用独立 Node >=22 打包，不接受 Electron 运行时');
  await regular(nodeExecutable, 'Node exe');
  if (await fs.realpath(nodeExecutable) !== await fs.realpath(process.execPath)) fail('Node exe 不属于当前可信运行时');
  await regular(join(providerDir, 'provider.mjs'), 'provider.mjs');
  const provider = await json(join(providerDir, 'package.json'));
  if (provider.dependencies?.[SDK] !== VERSION || Object.keys(provider.dependencies).length !== 1) fail('provider 必须只依赖固定 SDK');
  const sdk = await json(join(sdkDir, 'package.json'));
  if (sdk.name !== SDK || sdk.version !== VERSION || sdk.license !== 'MIT') fail('SDK 必须是 @qwen-code/cua-sdk 0.20.11 / MIT');
  const licenses = (await fs.readdir(sdkDir)).filter(n => /^LICENSE(?:\.|$)/i.test(n));
  if (!licenses.length) fail('SDK 缺许可证 license');
  for (const name of licenses) { await regular(join(sdkDir, name), '许可证'); if (!(await fs.readFile(join(sdkDir, name), 'utf8')).trim()) fail('许可证为空'); }
  if (basename(nativeArchive) !== asset.archive) fail('归档不是目标平台官方 asset 名');
  await regular(nativeArchive, '原生归档'); await regular(checksumFile, '官方 checksum 清单');
  if ((await fs.stat(nativeArchive)).size > LIMIT) fail('归档超出大小限制');
  const bytes = await fs.readFile(nativeArchive);
  const lines = (await fs.readFile(checksumFile, 'utf8')).split(/\r?\n/).map(line => /^([a-f\d]{64})\s+\*?(.+)$/i.exec(line.trim())).filter(Boolean).filter(m => m[2] === asset.archive);
  if (lines.length !== 1 || lines[0][1].toLowerCase() !== digest(bytes)) fail('SHA256 与官方 checksum 清单不匹配或条目不唯一');
  const entries = platform === 'win32' ? unzip(bytes) : untar(bytes);
  let total = 0; const seen = new Set();
  for (const [name, data] of entries) {
    const key = name.toLowerCase(); total += data.length;
    if (seen.has(key) || total > LIMIT) fail('归档重复条目或膨胀过大'); seen.add(key);
  }
  for (const name of asset.required) if (!entries.some(([n, b]) => n === name && b.length)) fail(`原生归档缺少 ${name}`);
  const lockPath = join(parent, `.${basename(out)}.pack-lock`);
  const lock = await fs.open(lockPath, 'wx').catch(() => fail('输出正在打包或锁已存在'));
  let temp;
  try {
    if (await exists(out)) fail('outDir 已存在，拒绝覆盖');
    temp = await fs.mkdtemp(join(parent, `.${basename(out)}.pack-`));
    const native = join(temp, 'node_modules', SDK, '.native', asset.key);
    await fs.mkdir(native, { recursive: true });
    for (const [name, data, mode] of entries) {
      const dest = join(native, name); await fs.mkdir(dirname(dest), { recursive: true });
      await fs.writeFile(dest, data, { flag: 'wx', mode: mode || 0o644 });
    }
    if (platform === 'win32') {
      if (process.platform !== 'win32') fail('Windows Authenticode 必须在 Windows 验证');
      const powershell = join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
      let status;
      try {
        status = execFileSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; (Get-AuthenticodeSignature -LiteralPath $env:SACODE_SIGNATURE_FILE).Status.ToString()"], { encoding: 'utf8', timeout: 30000, windowsHide: true, shell: false, env: { ...process.env, SACODE_SIGNATURE_FILE: join(native, 'qwen-cua-driver-uia.exe') } }).trim();
      } catch { fail('Authenticode 检查命令失败，不允许发布'); }
      if (status !== 'Valid') fail(`Authenticode worker 必须 Valid，实际 ${status}`);
    }
    await packageCopy(sdkDir, join(temp, 'node_modules', SDK), SDK);
    await fs.copyFile(join(providerDir, 'provider.mjs'), join(temp, 'provider.mjs'), fs.constants.COPYFILE_EXCL);
    await fs.copyFile(nodeExecutable, join(temp, platform === 'win32' ? 'node.exe' : 'node'), fs.constants.COPYFILE_EXCL);
    if (platform !== 'win32') await fs.chmod(join(temp, 'node'), 0o755);
    await writeJson(join(temp, 'package.json'), cleanManifest({ ...provider, engines: { node: '>=22' } }));
    if (await exists(out)) fail('outDir 已存在，拒绝覆盖');
    await publishRename(temp, out); temp = undefined;
    return { outDir: out, provider: join(out, 'provider.mjs'), nativeDir: join(out, 'node_modules', SDK, '.native', asset.key), nodeVersion: process.versions.node, nativeSha256: digest(bytes), electronRunAsNode: false };
  } finally {
    if (temp) await fs.rm(temp, { recursive: true, force: true });
    await lock.close(); await fs.unlink(lockPath);
  }
}
