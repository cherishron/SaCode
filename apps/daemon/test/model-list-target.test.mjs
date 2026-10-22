import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { securityFixture, HostBridge } from './security-fixture.mjs';

test('远程模型目录 read 仅选已配置目标，拒绝攻击目标且不发凭据', { timeout: 45000 }, async t => {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push({ path: req.url, auth: req.headers.authorization });
    res.end('{"data":[{"id":"synthetic-model"}]}');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const baseUrl = `http://127.0.0.1:${server.address().port}/configured`;
  const f = await securityFixture(t, { extraEnv: { SACODE_SYNTHETIC_MODEL_KEY: 'synthetic-model-secret' },
    prepare: async ({ cwd, env, host }) => {
      const b = new HostBridge(host, env);
      await b.start(cwd);
      try {
        const v = await b.request('model/registry/describe');
        await b.request('model/registry/update', { expectedRevision: v.revision, draft: {
          id: 'bound', name: '合成提供商', baseUrl, protocol: 'openai-completions', credentialRef: 'SACODE_SYNTHETIC_MODEL_KEY',
          models: [{ id: 'synthetic-model', name: '合成模型', contextWindow: '', maxTokens: '', image: false }] } });
      } finally { await b.stop(); }
    } });
  for (const params of [
    { baseUrl: baseUrl.replace('configured', 'attacker'), credentialRef: 'SACODE_SYNTHETIC_MODEL_KEY' },
    { baseUrl, apiKey: 'synthetic-inline' }, {},
    { providerId: 'bound', baseUrl: baseUrl.replace('configured', 'attacker') },
  ]) {
    const r = await f.rpc('model/list', { workspaceId: f.cwd, ...params });
    assert.match(r.error?.message || '', /remote-model-list-requires-provider-id/);
  }
  assert.equal(seen.length, 0);
  const missing = await f.rpc('model/list', { workspaceId: f.cwd, providerId: 'missing' });
  assert.match(missing.error?.message || '', /provider-not-found/);
  assert.equal(seen.length, 0);
  const good = await f.rpc('model/list', { workspaceId: f.cwd, providerId: 'bound' });
  assert.deepEqual(good.result?.models, ['synthetic-model']);
  assert.deepEqual(seen, [{ path: '/configured/models', auth: 'Bearer synthetic-model-secret' }]);
});
