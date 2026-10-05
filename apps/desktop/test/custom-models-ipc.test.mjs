// 第 3 层自定义模型的 IPC 面：按动作命名、逐字段校验的有限集合——
// 渲染层拼不出任意宿主方法，也没有「发任意请求」的通道；写侧载荷形状由
// 主进程守卫（customs-guard.cjs）逐个校验，与宿主动词逐个对映（断言 52）。
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

const draft = { id: 'code', name: '编程模型', description: '', enabled: true, category: 'coding',
  requires: ['tools', 'text-output'], mode: 'weighted', bindings: [] };
const binding = { providerId: 'step', modelId: 'm-a', enabled: true, order: 0, weight: 1,
  priceInMicro: 1000, priceOutMicro: 2000, priceCacheReadMicro: -1, priceCacheWriteMicro: -1,
  priceVersion: 1, currency: 'CNY' };

test('自定义模型 preload 十个通道逐动作逐字段，且无任意方法通道', async () => {
  const { api, calls } = load();
  await api.customsDescribe();
  await api.customsUpsert(draft, 0);
  await api.customsRemove('code', 1);
  await api.bindingUpsert('code', binding, 2);
  await api.bindingRemove('code', 'step', 'm-a', 3);
  await api.bindingReorder('code', ['step/m-a'], 4);
  await api.modelPull('step', 5);
  await api.modelUpstreamUpsert('step', 'm-b', 6);
  await api.customImportNew(['step/m-a'], 7);
  await api.customImportInto('code', ['step/m-c'], 8);

  assert.equal(calls[0][0], 'dsh:customsDescribe'); assert.equal(calls[0].length, 1);
  assert.equal(calls[1][0], 'dsh:customsUpsert');
  assert.equal(JSON.stringify(calls[1][1]), JSON.stringify({ draft, expectedRevision: 0 }));
  assert.equal(calls[2][0], 'dsh:customsRemove');
  assert.equal(JSON.stringify(calls[2][1]), '{"customId":"code","expectedRevision":1}');
  assert.equal(calls[3][0], 'dsh:bindingUpsert');
  assert.equal(JSON.stringify(calls[3][1]), JSON.stringify({ customId: 'code', binding, expectedRevision: 2 }));
  assert.equal(calls[4][0], 'dsh:bindingRemove');
  assert.equal(JSON.stringify(calls[4][1]), '{"customId":"code","providerId":"step","modelId":"m-a","expectedRevision":3}');
  assert.equal(calls[5][0], 'dsh:bindingReorder');
  assert.equal(JSON.stringify(calls[5][1]), JSON.stringify({ customId: 'code', keys: ['step/m-a'], expectedRevision: 4 }));
  assert.equal(calls[6][0], 'dsh:modelPull');
  assert.equal(JSON.stringify(calls[6][1]), '{"providerId":"step","expectedRevision":5}');
  assert.equal(calls[7][0], 'dsh:modelUpstreamUpsert');
  assert.equal(JSON.stringify(calls[7][1]), '{"providerId":"step","modelId":"m-b","expectedRevision":6}');
  assert.equal(calls[8][0], 'dsh:customImportNew');
  assert.equal(JSON.stringify(calls[8][1]), JSON.stringify({ items: ['step/m-a'], expectedRevision: 7 }));
  assert.equal(calls[9][0], 'dsh:customImportInto');
  assert.equal(JSON.stringify(calls[9][1]), JSON.stringify({ customId: 'code', items: ['step/m-c'], expectedRevision: 8 }));
  // 没有兜底的通用请求通道：否则这份有限集合等于不存在
  assert.equal('request' in api, false);
});

test('主进程守卫与宿主动词逐个对映（断言 52）', () => {
  const { api } = load();
  const mainSrc = readFileSync(new URL('../main.cjs', import.meta.url), 'utf8');
  const preloadSrc = readFileSync(new URL('../preload.cjs', import.meta.url), 'utf8');
  // preload 里本批十个通道名（按出现顺序）
  const names = ['customsDescribe', 'customsUpsert', 'customsRemove', 'bindingUpsert', 'bindingRemove',
    'bindingReorder', 'modelPull', 'modelUpstreamUpsert', 'customImportNew', 'customImportInto'];
  for (const n of names) {
    assert.equal(typeof api[n], 'function', `preload 缺少通道 ${n}`);
    assert.ok(preloadSrc.includes(`${n}: (`), `preload 缺少通道定义 ${n}`);
    // 每个通道在主进程都有同名 dsh: 前缀的 handle，且 handle 里出现对应宿主动词
    const verb = { customsDescribe: 'custom/describe', customsUpsert: 'custom/upsert', customsRemove: 'custom/remove',
      bindingUpsert: 'binding/upsert', bindingRemove: 'binding/remove', bindingReorder: 'binding/reorder',
      modelPull: 'model/pull', modelUpstreamUpsert: 'model/upstream/upsert',
      customImportNew: 'custom/import/new', customImportInto: 'custom/import/into' }[n];
    const handleRe = new RegExp(`ipcMain\\.handle\\("dsh:${n}"[\\s\\S]*?bridge\\.request\\("${verb.replace('/', '\\/')}"`);
    assert.ok(handleRe.test(mainSrc), `主进程缺少 dsh:${n} → ${verb} 的接线`);
  }
});

test('守卫拒收明文槽位与越界字段', () => {
  const { sanitizeDraft, sanitizeBinding, sanitizeRevision, sanitizeKeyList } = require('../customs-guard.cjs');
  // 第 3 层不认识 baseUrl 与凭据：草稿里出现就是绕行
  assert.throws(() => sanitizeDraft({ ...draft, baseUrl: 'https://x.example/v1' }), /bad-custom-draft/);
  assert.throws(() => sanitizeDraft({ ...draft, apiKey: 'sk-x' }), /bad-custom-draft/);
  assert.throws(() => sanitizeDraft({ ...draft, category: 'magic' }), /bad-custom-draft/);
  assert.throws(() => sanitizeDraft({ ...draft, requires: [] }), /bad-custom-draft/);
  assert.throws(() => sanitizeBinding({ ...binding, weight: 0 }), /bad-custom-draft/);
  assert.throws(() => sanitizeBinding({ ...binding, currency: 'cny' }), /bad-custom-draft/);
  assert.throws(() => sanitizeBinding({ ...binding, priceInMicro: -2 }), /bad-custom-draft/);
  // 版本号是乐观并发的凭据：非整数与负数拒收
  assert.throws(() => sanitizeRevision(-1), /bad-custom-revision/);
  assert.throws(() => sanitizeRevision(1.5), /bad-custom-revision/);
  // items 是 providerId/modelId 二元组
  assert.throws(() => sanitizeKeyList(['step/m-a/extra']), /bad-custom-items/);
  assert.throws(() => sanitizeKeyList(['step']), /bad-custom-items/);
  // 正常草稿原样通过（未定价绑定四档 -1）
  const out = sanitizeDraft(draft);
  assert.equal(out.mode, 'weighted');
  assert.equal(out.params, '');
  assert.equal(out.dailyTokens, -1);
  const b = sanitizeBinding({ ...binding, priceInMicro: -1, priceOutMicro: -1, currency: '' });
  assert.equal(b.priceInMicro, -1);
  assert.equal(b.currency, '');
});
