import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import { promisify } from 'node:util';

// 计划第 142 行「跨证书」这一小格的 HTTP 端到端集成用例。
//
// 前面所有 remote-auth / remote-tls / remote-transport-tls-pin 用例里的「证书」维度
// 都落在**同一个 daemon** 上——TLS 是否真接进 ServerBuilder、pin 是否真接进 dispatcher、
// 明文是否被拒。这里钉的是**跨实例**这一维：两个独立 daemon（各自自签证书、各自 instance.id、
// 各自内存里的 token 表），从 A 拿到的 bearer 打到 B 上必须被拒。
//
// 为什么这一条不是 remote-auth.test.mjs 里「重启后旧令牌找不到」的等价重复：
//   - 那条走的是**同一 daemon 重启**、tokens 内存清空 → 与过期同 fall-through 分支；
//   - 本条走的是**两个并行活 daemon**，各自的 `RemoteIdentityStore` 从零开始、
//     各自的 instanceId 随机；A 的 token 在 B 的 map 里天然不存在，且这个「不存在」
//     不是重启造成的，而是**拓扑层面的**（不同进程 = 不同信任域）。攻击面是「客户端
//     误把 A 的 endpoint 换成 B 的 endpoint、以为自己的 token 还活着」。
//
// 为什么要在 TLS 上做（而不是纯 HTTP）：
//   - 计划 §4 明写「所有网络都禁止明文 bearer」，跨实例的 token 面**必须**在同一档
//     TLS 保护下才谈得上验证；这里两台都是自签证书，客户端按 certPem 显式信任，
//     不走系统 CA。
//   - `authenticate()` 只看 bearer 字符串与 store 内 map，与 TLS 层无关；但用例要
//     模拟真实客户端形态（客户端 A 有 A 的证书信任，切到 B 端点时如果 pin/证书没切
//     就是抓包场景，本条测试先只验证授权面本身对跨实例 token 的处置）。
//
// 断言结构：
//   1. A 与 B 都跑 https（`https://127.0.0.1:` 打头），两台各自的自签证书都可用；
//   2. A 上完成登记 + 换令牌，同一 token 在 A 上跑一次 initialize 前置证明它是活的；
//   3. 同一 token 打到 B：`-32001 authz-denied:invalid-token`，响应体不含
//      `protocolVersion|capabilities`（未越过 gate），也不含 `deviceId|principal`
//      （未透露是哪台设备）；
//   4. 在 A 上再跑一次 initialize 仍然通过（说明被拒的确实是"跨实例"而不是 token
//      因为某种原因在 A 上也失效了）；
//   5. B 的审计日志有一条 `outcome: denied` + `reason: unauthenticated-invalid`，
//      且 `principalId` 与 `deviceId` 都是空串——拒绝不透露主体，与 remote-auth
//      里的「重启后旧令牌」走同一归因分支。
//
// 变异反证（本轮不跑，注释记录）：把 store.authenticate 的 `tokens[tokenValue]` 查找
// 换成 `tokens.has(tokenValue) ? Some(...) : ...` 但把 map 换成长期缓存——跨实例的
// 拒绝会退化成 "token expired" 语义（因为 B 里没有 A 的 token，B 会走 fall-through）；
// 但**攻击面**变了：客户端会以为"token 过期了、重新换一张"，而实际上它连的都不是
// 它应该连的那台。本用例的 3、4 两条断言组合起来能杀这个变异——第 3 条只认
// `invalid-token`，第 4 条要求同一 token 在原 daemon 上仍然可用。
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

async function makeCert(dir) {
  const certPath = path.join(dir, 'server.crt');
  const keyPath = path.join(dir, 'server.key');
  await execFileAsync(openssl, [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=127.0.0.1',
    '-addext', 'subjectAltName=IP:127.0.0.1',
    '-keyout', keyPath, '-out', certPath,
  ]);
  const certPem = await readFile(certPath, 'utf8');
  return { certPath, keyPath, certPem };
}

async function manage(args) {
  const proc = spawn(daemonExe, args, { env: baseEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; let err = '';
  proc.stdout.on('data', d => { out += d; });
  proc.stderr.on('data', d => { err += d; });
  const code = await new Promise(resolve => proc.on('close', c => resolve(c)));
  return { code, out, err };
}

async function bootTls(cwd, certPath, keyPath) {
  const proc = spawn(daemonExe, ['--port', '0'], {
    cwd,
    env: {
      ...baseEnv,
      SACODE_USER_SETTINGS_DIR: path.join(cwd, 'settings'),
      SACODE_REMOTE_ACCESS: '1',
      SACODE_REMOTE_IDENTITY: path.join(cwd, 'instance.id'),
      SACODE_REMOTE_POLICY: policyFile,
      SACODE_REMOTE_TLS_CERT: certPath,
      SACODE_REMOTE_TLS_KEY: keyPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = ''; let err = '';
  proc.stdout.on('data', d => { out += d; });
  proc.stderr.on('data', d => { err += d; });
  const closed = new Promise(resolve => proc.on('close', code => resolve(code)));
  const end = Date.now() + 15000;
  while (!/127\.0\.0\.1:(\d+)/.test(out) && proc.exitCode === null && Date.now() < end) await delay(20);
  assert.match(out, /127\.0\.0\.1:(\d+)/, `daemon 未监听：stdout=${out} stderr=${err}`);
  assert.match(out, /https:\/\/127\.0\.0\.1:/, `监听必须是 https：${out}`);
  const port = Number(out.match(/127\.0\.0\.1:(\d+)/)[1]);

  const httpsPost = (ca, p, body, headers = {}) => new Promise((resolve, reject) => {
    const req = https.request({
      host: '127.0.0.1', port, path: p, method: 'POST',
      ca: [ca], servername: '127.0.0.1', timeout: 10000,
      headers: { 'content-type': 'application/json', ...headers },
    }, res => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', d => { buf += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: buf }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.write(body);
    req.end();
  });

  const stop = async () => {
    proc.kill('SIGKILL');
    await Promise.race([closed, delay(5000)]);
    await rm(cwd, { recursive: true, force: true });
  };
  return { port, httpsPost, out, stop, cwd };
}

test('A 换出的 bearer 打到 B 上必须被拒；两实例的 token 表互不可见', async () => {
  const dirA = await mkdtemp(path.join(root, 'target', 'sacode-ccert-a-'));
  const dirB = await mkdtemp(path.join(root, 'target', 'sacode-ccert-b-'));
  const certA = await makeCert(dirA);
  const certB = await makeCert(dirB);
  assert.notEqual(certA.certPem, certB.certPem,
    '两台 daemon 必须各自一张自签证书——同一张就用不了这套用例');

  let a; let b;
  try {
    a = await bootTls(dirA, certA.certPath, certA.keyPath);
    b = await bootTls(dirB, certB.certPath, certB.keyPath);

    // 在 A 上建票、登记、换令牌。
    const snapshotA = `${path.join(dirA, 'instance.id')}.devices.json`;
    const created = await manage(['--manage', 'enroll-ticket', snapshotA, 'p-ccert']);
    assert.equal(created.code, 0, `建票失败：${created.err}`);
    const ticket = created.out.replace(/\r/g, '').trim().split('\n')[1];
    assert.match(ticket, /^[0-9a-f]{32}$/, '登记秘密形状应合法');

    const enrollA = await a.httpsPost(certA.certPem, '/auth/enroll',
      JSON.stringify({ enrollmentSecret: ticket, deviceName: 'phone-x', kind: 'mobile' }));
    assert.equal(enrollA.status, 200, `A 上登记应成功：${enrollA.body}`);
    const dev = JSON.parse(enrollA.body);

    const tokA = await a.httpsPost(certA.certPem, '/auth/token',
      JSON.stringify({ deviceId: dev.deviceId, credential: dev.credential }));
    assert.equal(tokA.status, 200);
    const tok = JSON.parse(tokA.body);
    const bearer = { authorization: `Bearer ${tok.accessToken}` };

    // 前置证明：同一 token 在 A 上真的可用——否则后面打 B 的红可能是一开始就红。
    const initOnA = await a.httpsPost(certA.certPem, '/rpc',
      JSON.stringify({ jsonrpc: '2.0', id: 'a-1', method: 'initialize', params: {} }),
      bearer);
    assert.equal(initOnA.status, 200);
    assert.match(initOnA.body, /protocolVersion/,
      `A 上的 initialize 必须真的执行：${initOnA.body.slice(0, 200)}`);
    assert.doesNotMatch(initOnA.body, /-32001/);

    // 打 B：同一 bearer，另一台 daemon。
    const initOnB = await b.httpsPost(certB.certPem, '/rpc',
      JSON.stringify({ jsonrpc: '2.0', id: 'b-1', method: 'initialize', params: {} }),
      bearer);
    assert.equal(initOnB.status, 200,
      '拒绝也必须走 JSON-RPC error 而非 HTTP 错误');
    assert.match(initOnB.body, /-32001/,
      `B 必须拒绝 A 换出的 token：${initOnB.body.slice(0, 200)}`);
    assert.match(initOnB.body, /authz-denied:invalid-token/,
      `归因必须是 invalid-token：${initOnB.body.slice(0, 200)}`);
    // 反枚举：不透露「设备不存在」「令牌过期」「另一台实例」——所有跨实例的信息面都必须封。
    assert.doesNotMatch(initOnB.body, /protocolVersion|capabilities/,
      '被拒的请求不得执行 initialize 业务分支');
    assert.doesNotMatch(initOnB.body, /device|principal|instanceId/,
      '拒绝响应不得透露是哪台设备或实例');
    assert.doesNotMatch(initOnB.body, /expired|token-gone|token-not-found|missing/,
      '拒绝响应不得透露「token 丢了 vs 过期」这种可枚举信号');

    // 反向验证：同一 token 在 A 上仍然可用（被拒的原因是"跨实例"，不是"token 坏了"）。
    const initOnAAgain = await a.httpsPost(certA.certPem, '/rpc',
      JSON.stringify({ jsonrpc: '2.0', id: 'a-2', method: 'initialize', params: {} }),
      bearer);
    assert.equal(initOnAAgain.status, 200);
    assert.match(initOnAAgain.body, /protocolVersion/);
    assert.doesNotMatch(initOnAAgain.body, /-32001/);

    // B 的审计：拒绝条目必须落盘，principalId/deviceId 空，reason 与过期同归因。
    const auditPath = `${path.join(dirB, 'instance.id')}.audit.log`;
    let auditText = '';
    for (let i = 0; i < 20; i++) {
      try {
        auditText = await readFile(auditPath, 'utf8');
        if (/unauthenticated-invalid/.test(auditText)) break;
      } catch { /* 文件可能还没刷 */ }
      await delay(50);
    }
    assert.match(auditText, /unauthenticated-invalid/,
      `B 的审计必须记录这条 unauthenticated-invalid：${auditText.slice(0, 400)}`);
    // 找到那条 deny 记录：principalId 与 deviceId 都必须是空串。
    const lines = auditText.trim().split('\n');
    const denyLine = lines.find(l => /unauthenticated-invalid/.test(l));
    assert.ok(denyLine, `审计里没有 unauthenticated-invalid 行：${auditText.slice(0, 400)}`);
    assert.match(denyLine, /"principalId":"",\s*"deviceId":""/,
      `跨实例拒绝不得透露主体身份：${denyLine}`);
    // 不得回显 token 原文或提交内容片段。
    assert.doesNotMatch(auditText, new RegExp(tok.accessToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      '审计不得回显真实 bearer 令牌');
  } finally {
    if (a) await a.stop();
    if (b) await b.stop();
    await rm(dirA, { recursive: true, force: true });
    await rm(dirB, { recursive: true, force: true });
  }
});
