import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function load(name, extra = {}) {
  const context = vm.createContext(extra);
  vm.runInContext(readFileSync(new URL(`../renderer/${name}`, import.meta.url), 'utf8'), context);
  return context;
}
function fixture(api = {}) {
  let timer, revision = 0, generation = 0;
  const draft = { value: '原稿' }, error = { value: '' };
  const context = load('enhance.js', {
    setTimeout: callback => { timer = callback; return 1; }, clearTimeout: () => { timer = null; },
    document: { getElementById: () => ({}) },
    window: { sacode: { promptEnhance: async () => {}, promptPoll: async () => ({ settled: true, ok: true, text: '改写' }), promptCancel: async () => {}, ...api },
      SaCodeComposerEdit: { replace: (_node, text) => { draft.value = text; return true; }, undo: (_node, text) => { draft.value = text; return true; } } },
  });
  const state = context.SaCodeEnhance.createEnhanceAssembly({ ref: value => ({ value }), draft, error,
    getDraftRevision: () => revision, getSessionGeneration: () => generation,
    catalogError: e => e.message, updateDraft: value => { draft.value = value; revision++; }, focusComposerCaret: () => {} });
  return { state, draft, error, poll: () => timer(), changeSession: () => generation++ };
}

test('目录错误映射直接可用且未知错误不丢失', () => {
  const { SaCodeSessionCatalog: api } = load('session-catalog.js');
  assert.equal(typeof api.catalogError, 'function');
  assert.match(api.catalogError(Error('selection-replay-rejected')), /所选会话无法读取/);
  assert.equal(api.catalogError(Error('unknown-failure')), 'unknown-failure');
});
test('增强使用注入状态并支持回退', async () => {
  const { state, draft } = fixture();
  await state.startEnhance();
  assert.equal(state.enhance.value.busy, true);
  // 轮询回执必须更新真实草稿，而不是仅更新增强状态。
  const f = fixture(); await f.state.startEnhance(); await f.poll();
  assert.equal(f.draft.value, '改写');
  f.state.undoEnhance(); assert.equal(f.draft.value, '原稿');
  state.clearEnhance(); assert.equal(draft.value, '原稿');
});
test('增强在途编辑后迟到结果不得覆盖新草稿', async () => {
  const { state, draft, poll } = fixture();
  await state.startEnhance(); state.userEditDraft('新稿'); await poll();
  assert.equal(draft.value, '新稿'); assert.equal(state.enhance.value.undo, false);
});
test('会话代数实时读取，换会话后增强结果作废', async () => {
  const { state, draft, poll, changeSession } = fixture();
  await state.startEnhance(); changeSession(); await poll();
  assert.equal(draft.value, '原稿'); assert.equal(state.enhance.value.busy, false);
});
test('取消在途增强后结果不能替换草稿', async () => {
  const { state, draft } = fixture(); await state.startEnhance(); await state.cancelEnhance();
  assert.equal(state.enhance.value.busy, false); assert.equal(draft.value, '原稿');
});

test('会话切换后的增强失败不得覆盖当前会话错误', async () => {
  const f = fixture({ promptPoll: async () => { throw Error('旧会话网络失败'); } });
  await f.state.startEnhance();
  f.changeSession(); f.error.value = '当前会话错误';
  await f.poll();
  assert.equal(f.error.value, '当前会话错误');
  assert.equal(f.state.enhance.value.busy, false);
});

test('编辑草稿后的失败回执不覆盖用户当前提示', async () => {
  const f = fixture({ promptPoll: async () => ({ settled: true, ok: false, error: 'timeout' }) });
  await f.state.startEnhance();
  f.state.userEditDraft('新的草稿'); f.error.value = '当前编辑提示';
  await f.poll();
  assert.equal(f.error.value, '当前编辑提示');
  assert.equal(f.draft.value, '新的草稿');
});
