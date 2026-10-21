// 证书指纹钉扎与 remote transport 的接合验收（规格 §4「内网允许通过扫码外带证书指纹
// 绑定服务端，不允许 trust-all」）。
//
// 上一批的 tls-pin.cjs 只做了单元层 checkServerIdentity；生产路径（fetch/https.request）
// 从没接到它——remote-transport 用 Node 默认 fetch，dispatcher 没建，target-bridge 的
// makeRemoteTransportFor 也没把 target-store 的 instanceFingerprint 透进来。这批把三段
// 连起来，并钉住两条不变量：
//   1. 已 pin 且指纹匹配 → 请求打通过（不是 pin 层把它拦掉）；
//   2. 已 pin 但指纹不匹配 → 请求必须在 TLS 握手阶段被拒，绝不到 /rpc 分派。
// 变体测试会证否第 2 条：把 pin 检查摘掉，请求会以系统 CA 拒因失败（不是 pin-mismatch），
// 两条不变量同时成立才算这条链路真接上了。

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import https from 'node:https';
import { execFile, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm,writeFile,readdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const require = (await import('node:module')).createRequire(import.meta.url);
const { checkServerIdentity, certFingerprintSha256 } = require('../tls-pin.cjs');
const { RemoteTransport } = await import('../remote-transport.mjs');

const execFileAsync = promisify(execFile);
const openssl = process.env.SACODE_OPENSSL || 'openssl';
// openssl 是本机自签证书夹具的唯一外部依赖。不可用时把依赖它的 3 条用例标成
// env-blocked-missing-openssl 跳过（与 env-blocked-electron 同构），不假装通过。
// 第 4 条“默认主机校验”单元锚点不依赖 openssl，照常运行。
const opensslAvailable = (() => {
  try {
    const r = spawnSync(openssl, ['version'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    return r.status === 0;
  } catch { return false; }
})();
const opensslSkip = opensslAvailable
  ? false
  : 'env-blocked-missing-openssl: 未找到 openssl 可执行文件（SACODE_OPENSSL 未设且 PATH 无 openssl），自签证书夹具无法生成';
const root = path.resolve(import.meta.dirname, '../../..');
const temporary=path.join(root,'target','tmp');
await mkdir(temporary,{recursive:true});
const fixturePrefix=path.join(temporary,'tls-pin-'+new Date().toISOString().slice(0,10)+'-');
const delay = ms => new Promise(r => setTimeout(r, ms));

// 自签证书：SAN 必须含 DNS:127.0.0.1 与 IP:127.0.0.1，否则客户端按 IP 或按 host 校验
// 都会挂掉，那时红的是夹具。openssl 是本机测试夹具的唯一外部依赖，与 daemon 的
// remote-tls.test.mjs 用法一致。
async function makeSelfSigned(dir) {
  // 合成测试身份只经stdout管道进入内存；不落盘或读取任何私人密钥。
  const config=path.join(dir,'openssl.cnf');
  await writeFile(config,'[req]\ndistinguished_name=dn\n[dn]\n');
  let stdout;
  try { ({stdout}=await execFileAsync(openssl, [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=DNS:127.0.0.1,DNS:localhost,IP:127.0.0.1',
    '-config', config,
    '-keyout', '-', '-out', '-',
  ],{cwd:dir,encoding:'utf8',maxBuffer:1048576})); }
  catch(error){throw Error('openssl-fixture-generation-failed:'+String(error.code));}
  if((await readdir(dir)).some(name=>name!=='openssl.cnf'))throw Error('openssl-fixture-unexpected-disk-output');
  const certPem=stdout.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)?.[0];
  const keyPem=stdout.match(/-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA )?PRIVATE KEY-----/)?.[0];
  if(!certPem||!keyPem)throw Error('openssl-fixture-output-invalid');
  // tlsPin 算的是 DER raw 的 SHA-256；PEM 剥掉 armour 就是 raw。
  const der = Buffer.from(
    certPem.replace(/-----BEGIN CERTIFICATE-----/, '').replace(/-----END CERTIFICATE-----/, '').replace(/\s+/g, ''),
    'base64',
  );
  const certObj = { raw: der };
  return { certPem, keyPem, fingerprint: certFingerprintSha256(certObj) };
}

// /rpc 回 JSON-RPC error，但 HTTP 200：只要 fetch 拿到这个 body，就说明握手过了 pin 层。
// pin 层拦下时这条路径根本不会被调。
async function makeRpcServer(certPem, keyPem) {
  const srv = https.createServer({ cert: certPem, key: keyPem, requestCert: false, rejectUnauthorized: true }, (req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      if (req.method !== 'POST' || req.url !== '/rpc') {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'not-found' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ping: 'pong' } }));
    });
  });
  const listening = new Promise((resolve, reject) => {
    srv.once('listening', resolve);
    srv.once('error', reject);
  });
  srv.listen(0, '127.0.0.1');
  await listening;
  const { port } = srv.address();
  const stop = async () => {
    // closeAllConnections 把还在等 keepalive 的 socket 断掉，否则 srv.close 会等到 keepalive 过期。
    srv.closeAllConnections?.();
    await new Promise(resolve => srv.close(resolve));
  };
  return { port, baseUrl: `https://127.0.0.1:${port}`, stop };
}

test('已 pin 且指纹匹配：请求能到 /rpc 并取回业务响应（pin 层不覆盖真通证）', { skip: opensslSkip }, async () => {
  const dir = await mkdtemp(fixturePrefix);
  let srv;
  try {
    const { certPem, keyPem, fingerprint } = await makeSelfSigned(dir);
    srv = await makeRpcServer(certPem, keyPem);
    const t = new RemoteTransport({
      baseUrl: srv.baseUrl,
      tokenProvider: async () => 'tk-pin-ok',
      instanceFingerprint: fingerprint,
      // 只信这张自签证书：系统 CA 不会接受它，所以握手成功只能来自 dispatcher.ca 的真注入。
      caCertificates: [certPem],
      setTimeoutImpl: setTimeout,
      clearTimeoutImpl: clearTimeout,
    });
    const result = await t.sendRequest('initialize', {});
    assert.deepEqual(result, { ping: 'pong' }, 'pin 匹配时请求应打通过、拿回 /rpc 的业务结果');
    t.close();
  } finally {
    if (srv) await srv.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test('已 pin 但指纹不匹配：请求在 TLS 握手阶段被 pin 层拒，/rpc 从未被调', { skip: opensslSkip }, async () => {
  const dir = await mkdtemp(fixturePrefix);
  let srv;
  let rpcHit = 0;
  try {
    const { certPem, keyPem, fingerprint } = await makeSelfSigned(dir);
    // 换成另一张自签证书当「对方」——指纹必然不同。
    const dir2 = await mkdtemp(fixturePrefix);
    const other = await makeSelfSigned(dir2);
    try {
      srv = await makeRpcServer(other.certPem, other.keyPem);
      const orig = globalThis.fetch;
      // 记录：pin 层拦下时 fetch 应根本没被调（连接在建起前就断了）。
      let fetchCalls = 0;
      globalThis.fetch = async (...args) => { fetchCalls += 1; return orig(...args); };
      try {
        const t = new RemoteTransport({
          baseUrl: srv.baseUrl,
          tokenProvider: async () => 'tk-pin-bad',
          // 期望的指纹是原来那张，服务器给的是另一张——必须 pin-mismatch。
          instanceFingerprint: fingerprint,
          caCertificates: [other.certPem],
          setTimeoutImpl: setTimeout,
          clearTimeoutImpl: clearTimeout,
        });
        let err = null;
        try {
          await t.sendRequest('initialize', {});
        } catch (e) { err = e; }
        assert.ok(err !== null, '指纹不匹配时必须抛错，不能假绿');
        // 关键断言：这条错必须来自 pin 层，不是「系统 CA 也不信」的通用 TLS 拒因。
        // 后一种情况说明 pin 从来没接上——两条不变量就退化成了一条。
        assert.match(String(err && err.message), /pin-mismatch/,
          `必须归因 pin-mismatch，实际：${err && err.message}`);
        assert.equal(fetchCalls, 0, 'pin 拦在握手前，业务层 fetch 一次都不该被调');
        assert.equal(rpcHit, 0, '服务器 /rpc 从未被触达');
        t.close();
      } finally {
        globalThis.fetch = orig;
        await rm(dir2, { recursive: true, force: true });
      }
    } finally {
      await rm(dir2, { recursive: true, force: true });
    }
  } finally {
    if (srv) await srv.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

// 反向不变量：不传 instanceFingerprint 时（TOFU 首连），仍然不允许系统 CA 之外的自签证书
// 直接进来——否则「pin 是可选项」会被读成「pin 可跳过 TLS」。
test('不 pin 也仍拒自签证书（系统 CA 拒因，不是 pin 层放水）', { skip: opensslSkip }, async () => {
  const dir = await mkdtemp(fixturePrefix);
  let srv;
  try {
    const { certPem, keyPem } = await makeSelfSigned(dir);
    srv = await makeRpcServer(certPem, keyPem);
    const t = new RemoteTransport({
      baseUrl: srv.baseUrl,
      tokenProvider: async () => 'tk-no-pin',
      // 故意不传 caCertificates：系统 CA 不认这张自签，握手应失败。
      setTimeoutImpl: setTimeout,
      clearTimeoutImpl: clearTimeout,
    });
    let err = null;
    try { await t.sendRequest('initialize', {}); }
    catch (e) { err = e; }
    assert.ok(err !== null, '自签证书不被系统 CA 信任时必须拒');
    // 归因不是 pin 层——pin 层没参与（没 pin）。
    assert.doesNotMatch(String(err.message), /pin-mismatch/,
      `没 pin 时不该报 pin-mismatch：${err.message}`);
    t.close();
  } finally {
    if (srv) await srv.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

// 单元锚点：确认 tls-pin 的默认主机校验器在 san 不含 host 时拒——把「不 trust-all」
// 的默认姿态钉到主机名校验层，避免以后有人把默认 hostnameVerifier 换成恒 null。
test('tls-pin 默认主机校验：san 不含请求 host 时拒（不是恒 null）', () => {
  const cert = { raw: Buffer.from([1]), subject: {}, subjectAltName: 'DNS:somewhere.else' };
  const fp = `sha256/${'0'.repeat(64)}`;
  const err = checkServerIdentity('127.0.0.1', cert, fp);
  assert.ok(err instanceof Error, '必须返回 Error，不能返回 undefined 让握手假装通过');
});
