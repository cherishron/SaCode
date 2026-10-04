// 提供商配置面：桌面模型页的每个动作都必须穿过 NDJSON 落到仓颉核心，
// 而且重启之后还在——「装上就能用」的前提是配置与凭据能跨进程存活。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { HostBridge } = createRequire(import.meta.url)('../host-bridge.cjs');

const HOST = process.env.DSH_HOST || fileURLToPath(new URL('../dist/host/bin/dsh-host.exe', import.meta.url));

const draft = (id, baseUrl) => ({
  id, name: '显示名', baseUrl, protocol: 'openai-completions', credentialRef: 'SA_CODE_TEST_KEY',
  models: [{ id: 'm-1', name: '模型一', contextWindow: '128k', maxTokens: '4k', image: false },
           { id: 'm-2', name: '模型二', contextWindow: '', maxTokens: '', image: false }],
});

async function boot(dir) {
  assert.ok(existsSync(HOST), '缺少自包含宿主');
  const bridge = new HostBridge(HOST, { ...process.env, SACODE_USER_SETTINGS_DIR: join(dir, 'settings') });
  await bridge.start(dir);
  return bridge;
}

// 只挂 /models：第一次令牌给清单，之后的令牌一律 401，用来把「现取」和「缓存」区分开。
async function stubCatalog(acceptToken) {
  const seenAuth = [];
  const server = createServer((req, res) => {
    if (req.url === '/models') {
      seenAuth.push(req.headers.authorization || '');
      if (req.headers.authorization === `Bearer ${acceptToken}`) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'm-1' }, { id: 'm-2' }, { id: 'm-1' }] }));
        return;
      }
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end('{"error":{"message":"unauthorized"}}');
      return;
    }
    res.writeHead(404); res.end('{}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, port: server.address().port, seenAuth };
}

async function registerProvider(dir, port) {
  const bridge = await boot(dir);
  const empty = await bridge.request('model/registry/describe');
  const saved = await bridge.request('model/registry/update', {
    draft: draft('mine', `http://127.0.0.1:${port}`), expectedRevision: empty.revision,
  });
  await bridge.request('model/registry/set-default', {
    providerId: 'mine', model: 'm-1', expectedRevision: saved.revision,
  });
  return { bridge };
}

test('宿主声明配置面能力，并把注册表读写与两类拒绝分开回传', { timeout: 30000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'sacode-registry-'));
  const stub = await stubCatalog('unused');
  t.after(() => { stub.server.closeAllConnections(); stub.server.close(); });

  const bridge = await boot(dir);
  t.after(() => bridge.stop());
  const init = await bridge.request('initialize');
  for (const m of ['model/registry/describe', 'model/registry/update', 'model/registry/set-default',
                   'credential/set', 'credential/describe', 'model/list']) {
    assert.ok(init.capabilities.includes(m), `能力声明缺 ${m}`);
  }

  const empty = await bridge.request('model/registry/describe');
  assert.deepEqual(empty.providers, []);
  assert.equal(empty.revision, 0);
  assert.equal(empty.writable, true);

  const saved = await bridge.request('model/registry/update', {
    draft: draft('mine', `http://127.0.0.1:${stub.port}`), expectedRevision: empty.revision,
  });
  assert.equal(saved.providers.length, 1);
  assert.equal(saved.providers[0].baseUrl, `http://127.0.0.1:${stub.port}`);
  assert.equal(saved.revision, 1);

  // 版本落后要报成冲突，而且报的码要能和「内容不合法」区分开
  await assert.rejects(
    () => bridge.request('model/registry/update', { draft: draft('mine', `http://127.0.0.1:${stub.port}`), expectedRevision: 0 }),
    /settings-conflict/,
  );
  await assert.rejects(
    () => bridge.request('model/registry/update', {
      draft: { ...draft('mine', `http://127.0.0.1:${stub.port}`), apiKey: '不该被接受的明文' }, expectedRevision: saved.revision,
    }),
    /settings-rejected/,
  );

  const defaulted = await bridge.request('model/registry/set-default', {
    providerId: 'mine', model: 'm-2', expectedRevision: saved.revision,
  });
  assert.equal(defaulted.defaultProviderId, 'mine');
  assert.equal(defaulted.defaultModel, 'm-2');
});

test('凭据每次操作现取：旋转落到下一次请求，配置与凭据跨进程存活', { timeout: 30000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'sacode-cred-'));
  const stub = await stubCatalog('test-secret-value');
  t.after(() => { stub.server.closeAllConnections(); stub.server.close(); });

  const { bridge } = await registerProvider(dir, stub.port);
  t.after(() => bridge.stop());

  const setKey = await bridge.request('credential/set', { ref: 'SA_CODE_TEST_KEY', value: 'test-secret-value' });
  assert.equal(setKey.configured, true);
  assert.equal(setKey.source, 'user-file');
  assert.equal(setKey.writable, true);
  assert.ok(!JSON.stringify(setKey).includes('test-secret-value'), '写面的回执不能把值带回来');

  const listed = await bridge.request('model/list', { providerId: 'mine' });
  assert.deepEqual(listed.models, ['m-1', 'm-2'], '去重与顺序都要保住');
  assert.ok(!JSON.stringify(listed).includes('test-secret-value'), '摘要里不带凭据材料');

  // 换凭据之后不重启也要立刻生效：下一次清单请求用的就是新值，且失败要显式报出来
  await bridge.request('credential/set', { ref: 'SA_CODE_TEST_KEY', value: 'rotated-value' });
  const wrong = await bridge.request('model/list', { providerId: 'mine' }).catch((e) => e.message);
  assert.match(String(wrong), /http-status:401/, '撤销旧凭据后应显式失败，不能读成空清单');
  assert.deepEqual(stub.seenAuth, ['Bearer test-secret-value', 'Bearer rotated-value'],
    '凭证必须每次操作现取：旋转落到下一次请求，不需要重启宿主');

  const stale = await boot(dir);  // 同一目录重开一个宿主进程
  try {
    const after = await stale.request('model/registry/describe');
    assert.equal(after.providers.length, 1, '提供商必须从盘上活过重启');
    assert.equal(after.defaultProviderId, 'mine');
    const info = await stale.request('credential/describe', { ref: 'SA_CODE_TEST_KEY' });
    assert.equal(info.configured, true, '凭据引用要能跨进程解析');
  } finally {
    const stopped = await stale.stop();
    assert.equal(stopped.code, 0);
  }
});

// 配置面不是摆设：起一轮时必须真的按注册表里的端点、模型与凭据去发请求。
test('轮次按注册表装配请求：端点、模型名与凭据都来自配置面', { timeout: 30000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'sacode-turn-'));
  const calls = [];
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const bytes of req) raw += bytes;
    calls.push({ auth: req.headers.authorization || '', body: JSON.parse(raw) });
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: '注册表答复' } }] }) + '\n\n');
    res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { total_tokens: 5 } }) + '\n\n');
    res.end('data: [DONE]\n\n');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); });

  const bridge = await boot(dir);
  t.after(() => bridge.stop());
  const empty = await bridge.request('model/registry/describe');
  const saved = await bridge.request('model/registry/update', {
    draft: draft('mine', `http://127.0.0.1:${server.address().port}`), expectedRevision: empty.revision,
  });
  await bridge.request('model/registry/set-default', {
    providerId: 'mine', model: 'm-1', expectedRevision: saved.revision,
  });
  await bridge.request('credential/set', { ref: 'SA_CODE_TEST_KEY', value: 'registry-token' });
  await bridge.request('session/submit', { eventType: 'user/message', data: '按配置面回答' });

  const start = await bridge.request('task/start');
  assert.equal(start.provider, 'real', '注册表已配置时不能再回落到示例 provider');
  let result;
  for (let i = 0; i < 300; i++) {
    result = await bridge.request('turn/poll');
    if (result.settled) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(result.text, '注册表答复');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].auth, 'Bearer registry-token', '凭据必须按引用现场解析后再发出');
  assert.equal(calls[0].body.model, 'm-1', '模型名取默认指针，不取环境变量');
});

// 装配器只会说 Chat Completions；把别的方言当成它，等于对着端点发不存在的请求体。
test('非 Chat Completions 方言的提供商在起轮前显式拒绝', { timeout: 30000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'sacode-proto-'));
  const bridge = await boot(dir);
  t.after(() => bridge.stop());
  const empty = await bridge.request('model/registry/describe');
  const saved = await bridge.request('model/registry/update', {
    draft: { ...draft('other', 'http://127.0.0.1:1'), protocol: 'anthropic-messages' }, expectedRevision: empty.revision,
  });
  await bridge.request('model/registry/set-default', {
    providerId: 'other', model: 'm-1', expectedRevision: saved.revision,
  });
  await bridge.request('session/submit', { eventType: 'user/message', data: '你好' });
  await assert.rejects(() => bridge.request('task/start'), /protocol-not-supported:anthropic-messages/);
});
