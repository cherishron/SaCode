// 模型配置面走的是「按动作命名、逐字段校验」的有限 IPC 集合：渲染层拼不出任意宿主方法，
// 也拿不到「发任意请求」的通道。这条用例钉的就是这份面本身。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);

function load() {
  let api;
  const calls = [];
  vm.runInNewContext(readFileSync(new URL('../preload.cjs', import.meta.url), 'utf8'), {
    require: () => ({
      contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } },
      ipcRenderer: { invoke: (...args) => { calls.push(args); return Promise.resolve(); } },
    }),
  });
  return { api, calls };
}

const draft = { id: 'gw', name: '网关', baseUrl: 'https://gateway.example/v1', protocol: 'openai-completions', models: [{ id: 'm-1', name: '', contextWindow: '', maxTokens: '', image: false }] };

test('模型配置 preload 只发送固定动作与既定字段', async () => {
  const { api, calls } = load();
  await api.modelsDescribe();
  await api.modelsCatalog();
  await api.modelsSave(draft, 'plain-secret', 3);
  await api.modelsRemove('gw', 4);
  await api.modelsSetDefault('gw', 'm-1', 5);
  await api.modelsList({ baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'inline-key' });
  await api.modelsSort('gw', 2, 6);
  await api.modelsSetEnabled('gw', false, 7);

  assert.equal(calls[0][0], 'sacode:modelsDescribe'); assert.equal(calls[0].length, 1);
  assert.equal(calls[1][0], 'sacode:modelsCatalog'); assert.equal(calls[1].length, 1);
  assert.equal(calls[2][0], 'sacode:modelsSave');
  assert.equal(JSON.stringify(calls[2][1]), JSON.stringify({ draft, key: 'plain-secret', expectedRevision: 3 }));
  assert.equal(calls[3][0], 'sacode:modelsRemove');
  assert.equal(JSON.stringify(calls[3][1]), '{"id":"gw","expectedRevision":4}');
  assert.equal(calls[4][0], 'sacode:modelsSetDefault');
  assert.equal(JSON.stringify(calls[4][1]), '{"providerId":"gw","model":"m-1","expectedRevision":5}');
  assert.equal(calls[5][0], 'sacode:modelsList');
  assert.equal(JSON.stringify(calls[5][1]), '{"baseUrl":"http://127.0.0.1:9/v1","apiKey":"inline-key"}');
  assert.equal(calls[6][0], 'sacode:modelsSort');
  assert.equal(JSON.stringify(calls[6][1]), '{"providerId":"gw","sortOrder":2,"expectedRevision":6}');
  assert.equal(calls[7][0], 'sacode:modelsSetEnabled');
  assert.equal(JSON.stringify(calls[7][1]), '{"providerId":"gw","enabled":false,"expectedRevision":7}');
  // 没有兜底的通用请求通道：否则这份有限集合等于不存在
  assert.equal('request' in api, false);
});

test('主进程草稿守卫只交出白名单字段，明文字段一律拒收', async () => {
  const { sanitizeDraft } = require('../models-guard.cjs');
  const out = sanitizeDraft({ ...draft, credentialRef: 'ATTACKER_CHOSEN', keyConfigured: true, sortOrder: 5, enabled: false, transport: 'relay' });
  assert.equal(out.credentialRef, undefined, '凭据名由核心按 ID 派生，渲染层没有覆盖通路');
  // 白名单现在放行供应商页会编辑的三列：sortOrder/enabled/transport——
  // 守卫不认识它们时宿主会按缺省重放，一次「保存名称」就把顺序与启停静默清零。
  assert.equal(JSON.stringify(Object.keys(out).sort()), '["baseUrl","enabled","id","models","name","protocol","sortOrder","transport"]');
  assert.equal(out.sortOrder, 5);
  assert.equal(out.enabled, false);
  assert.equal(out.transport, 'relay');
  assert.equal(out.models[0].id, 'm-1');
  // 能承载明文的键位不是「忽略」，是拒绝：静默丢弃会让页面以为密钥存进去了
  assert.throws(() => sanitizeDraft({ ...draft, apiKey: 'plain-secret' }), /bad-model-draft/);
  assert.throws(() => sanitizeDraft({ ...draft, protocol: 'magic' }), /bad-model-draft/);
  assert.throws(() => sanitizeDraft({ ...draft, sortOrder: -1 }), /bad-model-draft/);
  assert.throws(() => sanitizeDraft({ ...draft, enabled: 'yes' }), /bad-model-draft/);
  assert.throws(() => sanitizeDraft({ ...draft, transport: 'tunnel' }), /bad-model-draft/);
  assert.throws(() => sanitizeDraft({ ...draft, models: [{ id: 'm-1', name: 1, contextWindow: '', maxTokens: '', image: false }] }), /bad-model-draft/);
  assert.throws(() => sanitizeDraft({ ...draft, models: [] }), /bad-model-draft/);
});
