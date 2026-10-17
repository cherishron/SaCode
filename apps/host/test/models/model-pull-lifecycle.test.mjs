// 模型发现的实际 Host 协议测试：只用回环合成服务和无效测试凭据。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { createServer as createHttpsServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { HostBridge } = createRequire(import.meta.url)('../../../desktop/host-bridge.cjs');
const host = process.env.SACODE_HOST;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fixture(run, overrides = {}) {
  assert.ok(host, '须显式指定本轮构建的 SACODE_HOST');
  const root = fileURLToPath(new URL('../../../../target/tmp/model-pull-lifecycle/', import.meta.url));
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, 'run-'));
  let mode = 'success', hits = 0, closed = 0;
  const timers = new Set();
  const pending = new Set();
  const server = createServer((req, res) => {
    hits++;
    res.on('close', () => { closed++; });
    if (mode === 'headers') { pending.add(res); return; }
    if (mode === 'denied') { res.writeHead(401); res.end('{"error":"fixture"}'); return; }
    if (mode === 'malformed') { res.end('not-json'); return; }
    if (mode === 'drip') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.flushHeaders();
      res.write('{"data":[');
      const timer = setInterval(() => res.write(' '), 25);
      timers.add(timer);
      res.on('close', () => { clearInterval(timer); timers.delete(timer); });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"data":[{"id":"discovered"}]}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const settings = join(dir, 'settings');
  const bridge = new HostBridge(resolve(host), { ...process.env, SACODE_USER_SETTINGS_DIR: settings, ...overrides });
  try {
    await bridge.start(dir);
    const saved = await bridge.request('model/registry/update', {
      draft: { id: 'fixture', name: '合成供应商', baseUrl: `http://127.0.0.1:${server.address().port}`,
        protocol: 'openai-completions', models: [{ id: 'original', name: '原模型', contextWindow: '', maxTokens: '', image: false }] }, expectedRevision: 0,
    });
    await bridge.request('model/registry/save-credential', { providerId: 'fixture', expectedRevision: saved.revision, key: 'invalid-local-model-pull-fixture' });
    await run({ bridge, saved, settings, dir, server, mode: value => { mode = value; }, hits: () => hits, closed: () => closed,
      release: () => { for (const res of pending) res.end('{"data":[{"id":"late-must-not-commit"}]}'); pending.clear(); } });
  } finally {
    try { await bridge.stop(); }
    finally {
      for (const timer of timers) clearInterval(timer);
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  }
}

async function waitFor(fn, label) {
  for (let i = 0; i < 150; i++) { const result = await fn(); if (result) return result; await pause(20); }
  assert.fail(label);
}
async function settled(bridge, operationId) {
  return waitFor(async () => {
    const view = await bridge.request('model/pull/describe', { operationId });
    return view.settled ? view : false;
  }, '模型发现线程未收束');
}
const options = { timeout: 20000 };

test('模型发现：成功与幂等结果按operationId查询，不依赖全局revision变化', options, async () => {
  await fixture(async ({ bridge, saved, hits }) => {
    const pulled = await bridge.request('model/pull', { providerId: 'fixture', expectedRevision: saved.revision, operationId: 'first' });
    assert.equal(pulled.operationId, 'first');
    const status = await bridge.request('model/pull/describe', { operationId: 'first' });
    assert.equal(status.status, 'succeeded'); assert.equal(status.settled, true);
    assert.equal(status.view.revision, pulled.revision);
    const again = await bridge.request('model/pull', { providerId: 'fixture', expectedRevision: pulled.revision, operationId: 'same-models' });
    assert.equal(again.revision, pulled.revision);
    assert.equal((await settled(bridge, 'same-models')).status, 'succeeded');
    assert.equal(hits(), 2);
    await assert.rejects(bridge.request('model/pull', { providerId: 'fixture', expectedRevision: again.revision, operationId: 'first' }), /model-pull-operation-exists/);
    assert.equal(hits(), 2, '重复操作ID不得重新发网络请求');
    const cancelled = await bridge.request('model/pull/cancel', { operationId: 'first' });
    assert.equal(cancelled.cancelRequested, false); assert.equal(cancelled.status, 'succeeded');
  });
});

test('模型发现：未响应头触发总时限，关闭连接，不落库且主循环仍可查询', options, async () => {
  await fixture(async ({ bridge, saved, mode, closed, hits }) => {
    mode('headers'); const begin = Date.now();
    const pulled = bridge.request('model/pull', { providerId: 'fixture', expectedRevision: saved.revision, operationId: 'deadline', timeoutMs: 400 });
    const failure = assert.rejects(pulled, e => /model-pull-deadline/.test(e.message) && e.data.operationId === 'deadline');
    const running = await bridge.request('model/pull/describe', { operationId: 'deadline' });
    assert.equal(running.providerId, 'fixture');
    await failure;
    assert.ok(Date.now() - begin < 2500);
    const status = await settled(bridge, 'deadline');
    assert.equal(status.status, 'timed-out');
    assert.equal((await bridge.request('model/registry/describe')).revision, saved.revision);
    await waitFor(() => closed() > 0, '超时后连接未断开'); assert.equal(hits(), 1);
  });
});

test('模型发现：持续滴流不能刷新总预算，超时后不写配置', options, async () => {
  await fixture(async ({ bridge, saved, mode, closed }) => {
    mode('drip');
    await assert.rejects(bridge.request('model/pull', { providerId: 'fixture', expectedRevision: saved.revision, operationId: 'drip', timeoutMs: 400 }), /model-pull-deadline/);
    assert.equal((await settled(bridge, 'drip')).status, 'timed-out');
    assert.equal((await bridge.request('model/registry/describe')).revision, saved.revision);
    await waitFor(() => closed() > 0, '滴流连接未关闭');
  });
});

test('模型发现：在途取消及时应答，取消后无迟到写入且不影响下一次拉取', options, async () => {
  await fixture(async ({ bridge, saved, mode, hits, closed, release }) => {
    mode('headers');
    const pulled = bridge.request('model/pull', { providerId: 'fixture', expectedRevision: saved.revision, operationId: 'cancel', timeoutMs: 10000 });
    const failure = assert.rejects(pulled, e => /model-pull-cancelled/.test(e.message) && e.data.operationId === 'cancel');
    await waitFor(() => hits() === 1, '请求未到达合成服务');
    const begin = Date.now();
    const receipt = await bridge.request('model/pull/cancel', { operationId: 'cancel' });
    assert.equal(receipt.cancelRequested, true);
    assert.ok(Date.now() - begin < 1000, '取消不应等待网络返回');
    await failure;
    assert.equal((await settled(bridge, 'cancel')).status, 'cancelled');
    await waitFor(() => closed() > 0, '取消后连接未关闭');
    release(); await pause(50);
    assert.equal((await bridge.request('model/registry/describe')).revision, saved.revision);
    mode('success');
    assert.equal((await bridge.request('model/pull', { providerId: 'fixture', expectedRevision: saved.revision, operationId: 'next' })).operationId, 'next');
    assert.equal((await settled(bridge, 'cancel')).status, 'cancelled');
  });
});

test('模型发现：拒绝缺失/越界参数，未受理操作不发网络请求', options, async () => {
  await fixture(async ({ bridge, saved, hits }) => {
    for (const args of [
      { providerId: 'fixture' },
      { providerId: 'fixture', expectedRevision: -1 },
      { providerId: 'fixture', expectedRevision: saved.revision, timeoutMs: 0 },
      { providerId: 'fixture', expectedRevision: saved.revision, timeoutMs: 25001 },
      { providerId: 'fixture', expectedRevision: saved.revision, timeoutMs: '400' },
      { providerId: 'fixture', expectedRevision: saved.revision, operationId: 'bad/id' },
    ]) await assert.rejects(bridge.request('model/pull', args));
    assert.equal(hits(), 0);
    const pulled = await bridge.request('model/pull', { providerId: 'fixture', expectedRevision: saved.revision, operationId: 'valid' });
    assert.equal(pulled.operationId, 'valid');
    assert.equal(hits(), 1);
  });
});

test('模型发现：拉取在途时拒绝第二次拉取及配置写入，不阻塞只读与取消', options, async () => {
  await fixture(async ({ bridge, saved, mode, hits }) => {
    mode('headers');
    const pulled = bridge.request('model/pull', { providerId: 'fixture', expectedRevision: saved.revision, operationId: 'owned' });
    const rejected = assert.rejects(pulled, /model-pull-cancelled/);
    await waitFor(() => hits() === 1, '请求未到达');
    await assert.rejects(bridge.request('model/pull', { providerId: 'fixture', expectedRevision: saved.revision, operationId: 'parallel' }), /model-pull-in-flight/);
    await assert.rejects(bridge.request('model/registry/set-enabled', { providerId: 'fixture', enabled: false, expectedRevision: saved.revision }), /model-pull-in-flight/);
    assert.equal((await bridge.request('model/registry/describe')).revision, saved.revision);
    await bridge.request('model/pull/cancel', { operationId: 'owned' });
    await rejected; await settled(bridge, 'owned');
    assert.equal(hits(), 1);
  });
});

test('模型发现：HTTP与解析失败保留稳定脱敏错误，非空旧模型保持', options, async () => {
  await fixture(async ({ bridge, saved, mode, hits }) => {
    for (const [value, code] of [['denied', 'http-status:401'], ['malformed', 'bad-model-catalog']]) {
      mode(value);
      await assert.rejects(bridge.request('model/pull', { providerId: 'fixture', expectedRevision: saved.revision, operationId: value }), new RegExp(code));
      const status = await settled(bridge, value);
      assert.equal(status.status, 'failed'); assert.equal(status.error, code);
    }
    assert.equal(hits(), 2);
    assert.equal((await bridge.request('model/registry/describe')).revision, saved.revision);
  });
});

test('模型发现：TLS握手停滞同样受总时限和取消约束', options, async () => {
  await fixture(async ({ bridge, saved }) => {
    const sockets = new Set();
    const server = createTcpServer(socket => {
      sockets.add(socket); socket.on('close', () => sockets.delete(socket));
      socket.on('error', () => {});
      socket.resume(); // 消费 ClientHello 但不应答，才能持续观察对端 FIN/close。
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const draft = { id: 'fixture', name: 'TLS停滞合成服务', baseUrl: `https://127.0.0.1:${server.address().port}`,
        protocol: 'openai-completions', models: [{ id: 'original', name: '原模型', contextWindow: '', maxTokens: '', image: false }] };
      const view = await bridge.request('model/registry/update', { draft, expectedRevision: saved.revision });
      await assert.rejects(bridge.request('model/pull', { providerId: 'fixture', expectedRevision: view.revision, operationId: 'tls', timeoutMs: 500 }), /model-pull-deadline/);
      assert.equal((await settled(bridge, 'tls')).status, 'timed-out');
      assert.equal((await bridge.request('model/registry/describe')).revision, view.revision);
      await waitFor(() => sockets.size === 0, 'TLS连接未关闭');
      const pending = bridge.request('model/pull', { providerId: 'fixture', expectedRevision: view.revision, operationId: 'tls-cancel', timeoutMs: 10000 });
      const cancelled = assert.rejects(pending, /model-pull-cancelled/);
      await waitFor(() => sockets.size > 0, '取消测试未建立TLS连接');
      assert.equal((await bridge.request('model/pull/cancel', { operationId: 'tls-cancel' })).cancelRequested, true);
      await cancelled;
      assert.equal((await settled(bridge, 'tls-cancel')).status, 'cancelled');
      await waitFor(() => sockets.size === 0, '取消后TLS连接未关闭');
    } finally { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); }
  });
});

test('模型发现：未知操作不猜成功，重启后的旧操作返回未知', options, async () => {
  await fixture(async ({ bridge, saved, dir }) => {
    for (const method of ['model/pull/describe', 'model/pull/cancel']) {
      await assert.rejects(bridge.request(method, { operationId: 'never-started' }), e => /model-pull-operation-unknown/.test(e.message) && e.data.outcome === 'unknown');
    }
    const pulled = await bridge.request('model/pull', { providerId: 'fixture', expectedRevision: saved.revision });
    assert.match(pulled.operationId, /^host-pull-[0-9a-f]+-1$/);
    await bridge.stop(); await bridge.start(dir);
    await assert.rejects(bridge.request('model/pull/describe', { operationId: pulled.operationId }), /model-pull-operation-unknown/);
    const again = await bridge.request('model/pull', { providerId: 'fixture', expectedRevision: pulled.revision });
    assert.notEqual(again.operationId, pulled.operationId);
  });
});

test('模型发现：桥先超时后仍可按原operationId取回结果，不重发网络', options, async () => {
  await fixture(async ({ bridge, saved, mode, hits, release }) => {
    mode('headers');
    const lost = bridge.request('model/pull', {
      providerId: 'fixture', expectedRevision: saved.revision, operationId: 'bridge-lost', timeoutMs: 5000,
    }, 150);
    await assert.rejects(lost, /timeout: model\/pull/);
    const running = await bridge.request('model/pull/describe', { operationId: 'bridge-lost' });
    assert.equal(running.status, 'running');
    assert.equal(running.timeoutMs, 5000);
    release();
    const recovered = await settled(bridge, 'bridge-lost');
    assert.equal(recovered.status, 'succeeded');
    assert.ok(recovered.view.providers[0].models.some(model => model.id === 'late-must-not-commit'));
    assert.equal(hits(), 1);
  });
});

test('模型发现：Host关闭在途请求时取消并收束，关闭后不落库', options, async () => {
  await fixture(async ({ bridge, saved, mode, hits, dir }) => {
    mode('headers');
    const pulled = bridge.request('model/pull', { providerId: 'fixture', expectedRevision: saved.revision, operationId: 'shutdown' });
    const failure = assert.rejects(pulled, /model-pull-cancelled|host-gone/);
    await waitFor(() => hits() === 1, '请求未到达');
    const exit = await bridge.stop(); await failure;
    assert.equal(exit.forced, false); assert.equal(exit.code, 0);
    await bridge.start(dir);
    assert.equal((await bridge.request('model/registry/describe')).revision, saved.revision);
  });
});

test('模型发现：实际能力声明含精确查询与取消，状态按操作查询不取全局成功', options, async () => {
  await fixture(async ({ bridge }) => {
    const initialized = await bridge.request('initialize');
    for (const method of ['model/pull', 'model/pull/describe', 'model/pull/cancel']) {
      assert.ok(initialized.capabilities.includes(method));
    }
  });
});

test('模型发现：陈旧修订与缺失供应商在发网络前拒绝，结果可按ID核对', options, async () => {
  await fixture(async ({ bridge, saved, hits }) => {
    for (const [operationId, providerId, revision, code] of [
      ['stale', 'fixture', saved.revision + 1, 'settings-conflict'],
      ['missing', 'absent', saved.revision, 'provider-not-found'],
    ]) {
      await assert.rejects(bridge.request('model/pull', { operationId, providerId, expectedRevision: revision }), new RegExp(code));
      const result = await settled(bridge, operationId);
      assert.equal(result.status, 'failed'); assert.equal(result.error, code);
    }
    assert.equal(hits(), 0);
  });
});

test('模型发现：另一Host变更配置后原拉取拒绝覆盖，明确记录冲突', options, async () => {
  await fixture(async ({ bridge, saved, mode, hits, release, settings, dir }) => {
    mode('headers');
    const pulled = bridge.request('model/pull', { providerId: 'fixture', expectedRevision: saved.revision, operationId: 'external-change' });
    const failure = assert.rejects(pulled, /settings-conflict/);
    await waitFor(() => hits() === 1, '请求未到达');
    const other = new HostBridge(resolve(host), { ...process.env, SACODE_USER_SETTINGS_DIR: settings });
    const sibling = join(dir, 'other-session'); mkdirSync(sibling);
    try {
      await other.start(sibling);
      const changed = await other.request('model/registry/set-enabled', { providerId: 'fixture', enabled: false, expectedRevision: saved.revision });
      release(); await failure;
      const result = await settled(bridge, 'external-change');
      assert.equal(result.status, 'failed'); assert.equal(result.error, 'settings-conflict');
      const actual = await bridge.request('model/registry/describe');
      assert.equal(actual.revision, changed.revision);
      assert.equal(actual.providers[0].enabled, false);
      assert.deepEqual(actual.providers[0].models.map(model => model.id), ['original']);
    } finally { await other.stop(); }
  });
});

test('模型发现：有效TLS带明确信任锚成功，无信任锚时拒绝自签证书', {
  timeout: 20000,
  skip: !process.env.SACODE_TEST_OPENSSL && '须显式提供仅测试用的 SACODE_TEST_OPENSSL 生成本地合成证书，不安装工具',
}, async () => {
  const base = fileURLToPath(new URL('../../../../target/tmp/model-pull-tls/', import.meta.url));
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, 'run-'));
  const keyFile = join(dir, 'synthetic.key'), certFile = join(dir, 'synthetic.pem');
  // 私钥动态生成，仅在忽略目录和服务进程内使用，不输出、不入库。
  execFileSync(process.env.SACODE_TEST_OPENSSL, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
    '-addext', 'basicConstraints=critical,CA:TRUE', '-keyout', keyFile, '-out', certFile], { stdio: 'pipe' });
  let hits = 0;
  const sockets = new Set();
  const server = createHttpsServer({ key: readFileSync(keyFile), cert: readFileSync(certFile) }, (_req, res) => {
    hits++; res.end('{"data":[{"id":"verified-tls"}]}');
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('tlsClientError', () => {});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const trusted of [false, true]) {
      await fixture(async ({ bridge, saved }) => {
        const changed = await bridge.request('model/registry/update', {
          draft: { id: 'fixture', name: '合成TLS供应商', baseUrl: `https://localhost:${server.address().port}`,
            protocol: 'openai-completions', models: [{ id: 'original', name: '原模型', contextWindow: '', maxTokens: '', image: false }] },
          expectedRevision: saved.revision,
        });
        const pull = bridge.request('model/pull', { providerId: 'fixture', expectedRevision: changed.revision, operationId: trusted ? 'trusted-tls' : 'untrusted-tls', timeoutMs: 5000 }, 8000);
        if (trusted) {
          const result = await pull;
          assert.ok(result.providers[0].models.some(model => model.id === 'verified-tls'));
        } else {
          await assert.rejects(pull, /model-catalog-request-failed/);
          assert.equal((await bridge.request('model/registry/describe')).revision, changed.revision);
          assert.equal(hits, 0, '不可信自签证书请求不得到达HTTP层');
        }
      }, { SACODE_CA_BUNDLE: trusted ? certFile : join(dir, 'absent.pem'), SSL_CERT_FILE: '', SSL_CERT_DIR: '', USERPROFILE: dir });
    }
    assert.equal(hits, 1);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  }
});
