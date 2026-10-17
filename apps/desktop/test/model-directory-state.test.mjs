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

// 目录是发送键唯一的路由依据，而 modelsDescribe 有两条真实可达的失败形状：
// host-bridge.cjs 的 5 秒请求窗口（timeout: model/registry/describe）与宿主进程不在时的 host-unavailable。
// 落空后若没人再扫一遍，选择器就一直停在「请选择模型」——所以自愈要长在目录自己身上，且必须有界。
// 注：桌面实跑两轮都没复现这个竞态（宿主在首扫前就应答了），本用例钉的是契约形状而不是实跑观察。
function createWithTimers(api, ticks) {
  assert.ok(existsSync(path), '模型目录状态尚未提取');
  const ctx = vm.createContext({ setTimeout: (fn, ms) => { ticks.push(ms); return setTimeout(fn, 0); } });
  vm.runInContext(readFileSync(path, 'utf8'), ctx);
  return ctx.SaCodeModelDirectory.createModelDirectory(api);
}
test('首扫赶上宿主未就绪时自愈，不留在空目录', async () => {
  const ticks = []; let n = 0;
  const state = createWithTimers({ modelsDescribe: async () => { if (++n === 1) throw Error('-32002 host-not-ready'); return view; } }, ticks);
  await state.load();
  const s = state.getSnapshot();
  assert.equal(s.status, 'ready'); assert.equal(s.groups.length, 1);
  assert.equal(s.groups[0].models[0].id, 'm'); assert.equal(n, 2);
  assert.ok(ticks.length === 1 && ticks[0] > 0, '重试之间必须有间隔，不能空转打满宿主');
});
test('宿主一直不应答时如实报错且重试有界', async () => {
  const ticks = []; let n = 0;
  const state = createWithTimers({ modelsDescribe: async () => { n++; throw Error('host-down-' + n); } }, ticks);
  await state.load();
  const s = state.getSnapshot();
  assert.equal(s.status, 'error'); assert.match(s.error, /host-down-/);
  assert.ok(n >= 2, '至少试过一次重试'); assert.ok(n <= 5, '重试必须收敛，实测次数=' + n);
});
