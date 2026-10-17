// 原生执行载荷的可复现构建入口；编译证据不代表沙箱准入通过。
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const [sourceArg, outputArg, sourceSha] = process.argv.slice(2);
if (process.platform !== 'win32' || !sourceArg || !outputArg || !/^[0-9a-f]{40}$/.test(sourceSha || '')) {
  console.error('用法（Windows）：node scripts/pack-windows-execution.mjs <冻结源码目录> <新输出目录> <源码 SHA>');
  process.exit(2);
}
const source = resolve(sourceArg), output = resolve(outputArg);
const names = ['windows_job.cs', 'windows_appcontainer.cs', 'windows_job_broker.cs'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
// 不覆盖其他打包过程的载荷；编译目录位于普通临时目录，避免继承仓库完整性标签。
if (existsSync(output)) throw Error('原生执行输出目录已存在，请使用独立新目录');
const build = mkdtempSync(join(tmpdir(), 'sacode-execution-pack-'));
const inputs = names.map(name => {
  const original = join(source, 'core/native', name), bytes = readFileSync(original);
  const frozen = join(build, name);
  writeFileSync(frozen, bytes, { flag: 'wx' });
  return { name, original, frozen, sha256: hash(bytes), bytes: bytes.length };
});
const compiler = join(process.env.SystemRoot || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
const binary = join(build, 'sacode-job-broker.exe');
const args = ['/nologo', '/platform:x64', '/target:exe', '/r:System.Web.Extensions.dll', `/out:${binary}`, ...inputs.map(row => row.frozen)];
const result = spawnSync(compiler, args, { windowsHide: true, timeout: 30000, encoding: 'utf8' });
writeFileSync(join(build, 'build.log'), (result.stdout || '') + (result.stderr || '') + (result.error?.message || ''));
writeFileSync(join(build, 'build-exit.txt'), String(result.status));
if (result.status !== 0) throw Error(`原生执行编译失败：${build}`);
for (const row of inputs) if (hash(readFileSync(row.original)) !== row.sha256) throw Error('编译期间原生源码发生变化');
const payload = readFileSync(binary);
const manifest = {
  version: 1, protocolVersion: 1, sourceSha, sourceState: 'hash-bound-inputs',
  evidence: 'build-only', runtimeVerification: null,
  compiler: { path: compiler, sha256: hash(readFileSync(compiler)) },
  command: [compiler, ...args], buildDirectory: build, buildExit: result.status,
  sources: inputs.map(({ name, sha256, bytes }) => ({ path: `core/native/${name}`, sha256, bytes })),
  files: [{ name: 'sacode-job-broker.exe', sha256: hash(payload), bytes: payload.length }],
};
mkdirSync(output);
writeFileSync(join(output, 'sacode-job-broker.exe'), payload, { flag: 'wx' });
writeFileSync(join(output, 'execution-provider-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, buildExit: result.status, sha256: hash(payload), evidence: manifest.evidence }));
