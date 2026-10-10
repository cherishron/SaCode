import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, existsSync } from 'node:fs';
const path = new URL('../renderer/model-directory-state.js', import.meta.url);
const view = { revision: 7, defaultProviderId: 'p', defaultModel: 'm', providers: [{ id: 'p', name: '供应商', models: [{ id: 'm', name: '模型', image: true, contextWindow: '128k' }] }] };
function create(api) {
  assert.ok(existsSync(path), '模型目录状态尚未提取');
  const ctx = vm.createContext({}); vm.runInContext(readFileSync(path, 'utf8'), ctx);
  return ctx.SaCodeModelDirectory.createModelDirectory(api);
}
test('目录快照保留模型能力与容量并通知订阅者', async () => {
  const state = create({ modelsDescribe: async () => view });
  let notices = 0; const unsubscribe = state.subscribe(() => notices++);
  await state.load(); const s = state.getSnapshot();
  assert.equal(s.status, 'ready'); assert.equal(s.routable, true);
  assert.equal(s.contextWindow, '128k'); assert.equal(s.groups[0].models[0].image, true);
  assert.equal(notices, 2); unsubscribe(); await state.load(); assert.equal(notices, 2);
});
test('选择模型带当前修订号写回宿主，失败不伪造成功', async () => {
  const state = create({ modelsDescribe: async () => view, modelsSetDefault: async (p,m,r) => {
    assert.equal(p,'p'); assert.equal(m,'m'); assert.equal(r,7); throw Error('stale-revision');
  } });
  await state.load(); await assert.rejects(state.select({provider:'p',model:'m'}), /stale-revision/);
  assert.equal(state.getSnapshot().status, 'error'); assert.equal(state.getSnapshot().pending, null);
});
test('迟到目录响应不能覆盖较新的加载结果', async () => {
  let resolve, n = 0;
  const state = create({modelsDescribe: () => ++n === 1 ? new Promise(r=>{resolve=r;}) : Promise.resolve(view)});
  const old = state.load(); await state.load(); resolve({...view,defaultModel:'missing'}); await old;
  assert.equal(state.getSnapshot().current.model, 'm'); assert.equal(state.getSnapshot().routable,true);
});
test('失效默认指针不能声明可路由', async () => {
  const state = create({modelsDescribe:async()=>({...view,defaultModel:'missing'})}); await state.load();
  assert.equal(state.getSnapshot().routable,false); assert.equal(state.getSnapshot().contextWindow,'');
});
