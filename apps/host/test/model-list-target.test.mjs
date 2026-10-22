import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';

const { HostBridge } = createRequire(import.meta.url)('../../desktop/host-bridge.cjs');
const repo = resolve(import.meta.dirname, '../../..');

test('模型目录仅将本机凭据发给其注册提供商，草稿不得解析本机引用', { timeout: 30000 }, async t => {
  assert.ok(process.env.SACODE_HOST && existsSync(process.env.SACODE_HOST), '须指定本轮构建的 SACODE_HOST');
  const base = join(repo, 'target/tmp/model-list-target');
  mkdirSync(base, { recursive: true });
  const root = mkdtempSync(join(base, 'run-'));
  const seen = [];
  const server = createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization });
    res.setHeader('content-type', 'application/json');
    res.end('{"data":[{"id":"synthetic-model"}]}');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (['path', 'systemroot', 'windir'].includes(k.toLowerCase())) env[k] = v;
  }
  Object.assign(env, { TMP: root, TEMP: root, SACODE_USER_SETTINGS_DIR: join(root, 'settings'),
    SACODE_BOUND_SYNTHETIC_KEY: 'synthetic-bound-secret', SACODE_OTHER_SYNTHETIC_KEY: 'synthetic-other-secret' });
  const bridge = new HostBridge(resolve(process.env.SACODE_HOST), env);
  t.after(() => bridge.stop(10000));
  await bridge.start(root);
  await bridge.request('initialize');
  const registry = await bridge.request('model/registry/describe');
  await bridge.request('model/registry/update', { expectedRevision: registry.revision,
    draft: { id: 'bound', name: '合成提供商', baseUrl, protocol: 'openai-completions',
      credentialRef: 'SACODE_BOUND_SYNTHETIC_KEY', models: [{ id: 'synthetic-model', name: '合成模型', contextWindow: '', maxTokens: '', image: false }] } });
  const bad = [
    { baseUrl, credentialRef: 'SACODE_BOUND_SYNTHETIC_KEY' },
    { providerId: 'missing', baseUrl, credentialRef: 'SACODE_BOUND_SYNTHETIC_KEY' },
    { providerId: 'missing' },
    { providerId: 'bound', baseUrl },
    { providerId: 'bound', credentialRef: 'SACODE_OTHER_SYNTHETIC_KEY' },
    { providerId: 'bound', apiKey: 'untrusted-inline' },
  ];
  for (const params of bad) await assert.rejects(bridge.request('model/list', params),
    /credential-target-not-bound|provider-target-override-forbidden|provider-not-found/);
  assert.equal(seen.length, 0, '拒绝必须发生在网络调用前');
  const listed = await bridge.request('model/list', { providerId: 'bound' });
  assert.deepEqual(listed.models, ['synthetic-model']);
  assert.equal(seen[0].auth, 'Bearer synthetic-bound-secret');
  const inline = await bridge.request('model/list', { baseUrl, apiKey: 'synthetic-inline-secret' });
  assert.deepEqual(inline.models, ['synthetic-model']);
  assert.equal(seen[1].auth, 'Bearer synthetic-inline-secret');
});
