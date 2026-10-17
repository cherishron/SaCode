import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { promisify } from 'node:util';

// TLS 真的生效的验收（设计 §4「所有网络，包括内网，都禁止明文 bearer」）。
// 上一批只做到「启动校验要求证书文件存在」——那是不够的：证书存在却没接进
// ServerBuilder 的话，daemon 会在外网监听上跑明文，客户端以为自己在发 bearer
// 给 TLS 服务，实际整条凭据在网络上裸奔。这里按「配了证书就必须以 TLS 提供服务」
// 反证：明文打不进、https 打得进、坏证书拒绝启动。
const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, '../../..');
const daemonExe = process.env.SACODE_DAEMON || path.join(root, 'apps/daemon/target/release/bin/main.exe');
const policyFile = path.join(root, 'docs/plans/remote-capability-contract.json');
const openssl = process.env.SACODE_OPENSSL || 'openssl';
const baseEnv = { ...process.env };
const pathKey = Object.keys(baseEnv).find(k => k.toLowerCase() === 'path') || 'PATH';
baseEnv[pathKey] = [
  process.env.SACODE_STDX_DLL_DIR || 'C:/Users/jingg/stdx-work/stdx-1.1.3.1/windows_x86_64_cjnative/dynamic/stdx',
  process.env.SACODE_RUNTIME_DLL_DIR || 'D:/Program Files/HuaWei/Cangjie/runtime/lib/windows_x86_64_cjnative',
  baseEnv[pathKey],
].join(path.delimiter);

const delay = ms => new Promise(r => setTimeout(r, ms));

// 自签证书只是本机测试夹具：SAN 必须是 IP:127.0.0.1，否则客户端按 IP 校验会失败，
// 那时红的是夹具而不是被测面。
async function makeCert(dir, { garbage = false } = {}) {
  const certPath = path.join(dir, 'server.crt');
  const keyPath = path.join(dir, 'server.key');
  if (garbage) {
    await writeFile(certPath, 'not-a-pem-file\n');
    await writeFile(keyPath, 'not-a-pem-file\n');
    return { certPath, keyPath, certPem: 'not-a-pem-file\n' };
  }
  await execFileAsync(openssl, [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=127.0.0.1',
    '-addext', 'subjectAltName=IP:127.0.0.1',
    '-keyout', keyPath, '-out', certPath,
  ]);
  const certPem = await readFile(certPath, 'utf8');
  return { certPath, keyPath, certPem };
}

async function bootTls(extraEnv, { expectFail = false } = {}) {
  const cwd = await mkdtemp(path.join(root, 'target', 'sacode-remote-tls-'));
  const proc = spawn(daemonExe, ['--port', '0'], {
    cwd,
    env: { ...baseEnv, SACODE_USER_SETTINGS_DIR: path.join(cwd, 'settings'), ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  let err = '';
  proc.stdout.on('data', d => { out += d; });
  proc.stderr.on('data', d => { err += d; });
  const closed = new Promise(resolve => proc.on('close', code => resolve(code)));
  const portOf = (s) => (s.match(/127\.0\.0\.1:(\d+)/) || [])[1];
  if (expectFail) {
    const code = await closed;
    await rm(cwd, { recursive: true, force: true });
    return { code, err, out };
  }
  const end = Date.now() + 15000;
  while (!portOf(out) && proc.exitCode === null && Date.now() < end) await delay(20);
  const port = portOf(out);
  assert.ok(port, `daemon 未监听：stdout=${out} stderr=${err}`);
  const httpsGet = (p, opts = {}) => new Promise((resolve, reject) => {
    const req = https.request({
      host: '127.0.0.1', port, path: p, method: opts.method || 'GET',
      ca: [opts.ca], servername: '127.0.0.1', timeout: 10000,
      headers: opts.headers || {},
    }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', d => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    if (opts.body) req.write(opts.body);
    req.end();
  });
  const httpGet = (p) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method: 'POST',
      headers: { 'content-type': 'application/json' }, timeout: 10000 }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', d => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.write(JSON.stringify({ jsonrpc: '2.0', id: 'p-1', method: 'initialize', params: {} }));
    req.end();
  });
  const stop = async () => {
    proc.kill('SIGKILL');
    await Promise.race([closed, delay(5000)]);
    await rm(cwd, { recursive: true, force: true });
  };
  return { port, httpsGet, httpGet, out, stop };
}

test('配置证书后以 TLS 提供服务：https 可达、明文 HTTP 打不进认证面', async () => {
  const dir = await mkdtemp(path.join(root, 'target', 'sacode-remote-tls-fix-'));
  const { certPath, keyPath, certPem } = await makeCert(dir);
  const identity = path.join(dir, 'instance.id');
  const d = await bootTls({
    SACODE_REMOTE_ACCESS: '1',
    SACODE_REMOTE_IDENTITY: identity,
    SACODE_REMOTE_POLICY: policyFile,
    SACODE_REMOTE_TLS_CERT: certPath,
    SACODE_REMOTE_TLS_KEY: keyPath,
  });
  try {
    // 启动行报的方案必须是 https：报 http 会让操作者与客户端照着明文去连。
    assert.match(d.out, /https:\/\/127\.0\.0\.1:/, `监听行方案错误：${d.out}`);

    const health = await d.httpsGet('/health', { ca: certPem });
    assert.equal(health.status, 200, `TLS 下 /health 应可达：${health.body}`);
    assert.deepEqual(Object.keys(JSON.parse(health.body)).sort(), ['status']);

    const denied = await d.httpsGet('/rpc', {
      ca: certPem, method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'r-1', method: 'initialize', params: {} }),
    });
    assert.match(denied.body, /-32001/, 'TLS 不替代逐请求认证：无 Bearer 仍须被拒');
    assert.match(denied.body, /authz-denied:missing-bearer/);

    // 明文打同一个端口必须失败：连不上/握手失败即「bearer 不走明文」成立；
    // 若真拿到回包，则必须是错误回包且绝不含业务响应。
    let plain = null;
    try {
      plain = await d.httpGet('/rpc');
    } catch (e) {
      assert.ok(/ECONN|socket|ALPN|SSL|HTTP|parse|timeout|closed|Protobuf|protocol/i.test(String(e && e.message)),
        `明文失败的归因看不懂：${e}`);
    }
    if (plain !== null) {
      assert.ok(plain.status >= 400, `明文请求被服务了：status=${plain.status} body=${plain.body}`);
      assert.doesNotMatch(plain.body, /capabilities|protocolVersion/, '明文通道不得回业务响应');
    }
  } finally {
    await d.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test('证书与私钥不可解析 → 拒绝启动，不降级成明文服务', async () => {
  const dir = await mkdtemp(path.join(root, 'target', 'sacode-remote-tls-bad-'));
  const { certPath, keyPath } = await makeCert(dir, { garbage: true });
  const r = await bootTls({
    SACODE_REMOTE_ACCESS: '1',
    SACODE_REMOTE_IDENTITY: path.join(dir, 'instance.id'),
    SACODE_REMOTE_POLICY: policyFile,
    SACODE_REMOTE_TLS_CERT: certPath,
    SACODE_REMOTE_TLS_KEY: keyPath,
  }, { expectFail: true });
  await rm(dir, { recursive: true, force: true });
  assert.equal(r.code, 78, `应拒绝启动：code=${r.code} err=${r.err}`);
  assert.match(r.err, /tls-(cert|key)-undecodable|tls-files-unreadable/);
});
