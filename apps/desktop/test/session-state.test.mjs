import { test } from 'node:test';
import assert from 'node:assert/strict';

// 模拟 Vue ref：一个带 .value 的对象
function ref(val) { return { value: val }; }

// 加载被测模块（经典脚本挂在 globalThis 上）
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '..', 'renderer', 'session-state.js'), 'utf8');
eval(src);

const { createSessionAssembly } = globalThis.SaCodeSessionState;

test('selectSession 在 catalogBusy 时直接跳过', async () => {
  const catalogBusy = ref(true);
  const deps = makeDeps({ catalogBusy });
  const asm = createSessionAssembly(deps);
  let called = false;
  deps.applySelection = async () => { called = true; };
  await asm.selectSession('s1');
  assert.equal(called, false, 'catalogBusy 时不应该调用 applySelection');
});

test('selectSession 选中当前已选会话时跳过', async () => {
  const catalog = ref({ entries: [{ id: 's1', current: true }] });
  const deps = makeDeps({ catalog });
  const asm = createSessionAssembly(deps);
  let called = false;
  deps.applySelection = async () => { called = true; };
  await asm.selectSession('s1');
  assert.equal(called, false, '已选中的会话不应该重复切换');
});

test('createSession 空标题时跳过', async () => {
  const newSessionTitle = ref('  ');
  const deps = makeDeps({ newSessionTitle });
  const asm = createSessionAssembly(deps);
  let created = false;
  deps.api.sessionCreate = async () => { created = true; return { id: 'new' }; };
  await asm.createSession();
  assert.equal(created, false, '空标题不应该创建会话');
});

test('createSession 在 catalogBusy 时跳过', async () => {
  const newSessionTitle = ref('新会话');
  const catalogBusy = ref(true);
  const deps = makeDeps({ newSessionTitle, catalogBusy });
  const asm = createSessionAssembly(deps);
  let created = false;
  deps.api.sessionCreate = async () => { created = true; return { id: 'new' }; };
  await asm.createSession();
  assert.equal(created, false, 'catalogBusy 时不应该创建会话');
});

test('startNewSession 设置默认标题后触发创建', async () => {
  const newSessionTitle = ref('');
  const deps = makeDeps({ newSessionTitle });
  const asm = createSessionAssembly(deps);
  let createdTitle = null;
  deps.api.sessionCreate = async (title) => { createdTitle = title; return { id: 'new1' }; };
  await asm.startNewSession();
  assert.equal(createdTitle, '新会话', '应以默认标题创建会话');
  assert.equal(newSessionTitle.value, '', '创建后标题应被清空');
});

test('refreshCatalog 从 API 读取并更新 catalog', async () => {
  const catalog = ref(null);
  const catalogBusy = ref(false);
  const catalogNote = ref('');
  const deps = makeDeps({ catalog, catalogBusy, catalogNote });
  const apiCatalog = { entries: [{ id: 's1', current: true }] };
  deps.api.sessionCatalog = async () => apiCatalog;
  const asm = createSessionAssembly(deps);
  await asm.refreshCatalog();
  assert.deepEqual(catalog.value, apiCatalog);
  assert.equal(catalogBusy.value, false, '完成后 catalogBusy 应恢复');
});

test('refreshCatalog 在 busy 时不重复读取', async () => {
  const catalogBusy = ref(true);
  const deps = makeDeps({ catalogBusy });
  let called = false;
  deps.api.sessionCatalog = async () => { called = true; return { entries: [] }; };
  const asm = createSessionAssembly(deps);
  await asm.refreshCatalog();
  assert.equal(called, false, 'busy 时不应该重复读取');
});

test('applySelection 切换后旧草稿保存、新草稿恢复', async () => {
  const draft = ref('旧草稿');
  const selectedScrollId = ref('old');
  const sessionDrafts = new Map();
  const catalog = ref({ entries: [{ id: 'old', current: true }] });
  const sessionGeneration = { value: 0 };
  const deps = makeDeps({
    draft, selectedScrollId, sessionDrafts, catalog,
    getSessionGeneration: () => sessionGeneration.value,
    incrementSessionGeneration: () => { sessionGeneration.value++; },
  });
  deps.api.sessionSelect = async () => {};
  deps.api.sessionCatalog = async () => ({ entries: [{ id: 'new', current: true }] });
  const asm = createSessionAssembly(deps);
  await asm.applySelection('new');
  assert.equal(sessionDrafts.get('old'), '旧草稿', '旧会话草稿应被保存');
  assert.equal(selectedScrollId.value, 'new', '应切到新会话');
  assert.equal(sessionGeneration.value, 1, 'sessionGeneration 应自增');
});

test('切换被后端拒绝时保留当前会话、草稿与选择代次，解除忙碌状态', async()=>{
  const deps=makeDeps({draft:ref('尚未发送的草稿'),selectedScrollId:ref('old'),catalog:ref({entries:[{id:'old',current:true}]})});
  let resets=0;
  deps.fileEditor.reset=()=>resets++;
  deps.api.sessionSelect=async()=>{throw Error('session-storage-unavailable');};
  await createSessionAssembly(deps).selectSession('new');
  assert.equal(deps.draft.value,'尚未发送的草稿');
  assert.equal(deps.selectedScrollId.value,'old');
  assert.equal(deps.catalog.value.entries[0].id,'old');
  assert.equal(deps.catalogBusy.value,false);
  assert.equal(resets,0);
  assert.match(deps.error.value,/session-storage-unavailable/);
});

test('新建被后端拒绝时保留名称草稿与当前会话', async()=>{
  const deps=makeDeps({newSessionTitle:ref('待创建名称'),draft:ref('当前消息'),selectedScrollId:ref('old')});
  deps.api.sessionCreate=async()=>{throw Error('session-storage-unavailable');};
  await createSessionAssembly(deps).createSession();
  assert.equal(deps.newSessionTitle.value,'待创建名称');
  assert.equal(deps.draft.value,'当前消息');
  assert.equal(deps.selectedScrollId.value,'old');
  assert.equal(deps.catalogBusy.value,false);
});

test('会话元信息保存绑定目标与修订，拒绝重复提交并刷新真实目录',async()=>{
  let resolve,calls=0;const deps=makeDeps({catalog:ref({entries:[{id:'s1',durable:7,status:'ready'},{id:'s2',durable:9,status:'ready'}]})});
  deps.api.sessionRename=async(...args)=>{calls++;assert.deepEqual(args,['s1','新标题',7]);await new Promise(r=>resolve=r);};
  deps.api.sessionCatalog=async()=>({entries:[{id:'s1',title:'新标题',durable:8},{id:'s2',title:'乙',durable:9}]});
  const state=createSessionAssembly(deps);const first=state.mutateMetadata('s1','rename','新标题');
  assert.equal(await state.mutateMetadata('s1','rename','重复'),false);assert.equal(calls,1);
  resolve();assert.equal(await first,true);assert.equal(deps.catalog.value.entries[1].title,'乙');
  assert.equal(deps.catalogBusy.value,false);
});
test('会话元信息失败保留原目录，在途任务与无效目标不发请求',async()=>{
  const deps=makeDeps({catalog:ref({entries:[{id:'s1',durable:1,status:'ready'}]})});let calls=0;
  deps.api.sessionArchive=async()=>{calls++;throw Error('session-revision-conflict');};
  const state=createSessionAssembly(deps);
  deps.turn.value.running=true;assert.equal(await state.mutateMetadata('s1','archive',true),false);
  deps.turn.value.running=false;assert.equal(await state.mutateMetadata('unknown','archive',true),false);assert.equal(calls,0);
  assert.equal(await state.mutateMetadata('s1','archive',true),false);assert.match(deps.catalogNote.value,/session-revision-conflict/);
  assert.equal(deps.catalog.value.entries[0].archived,undefined);assert.equal(deps.catalogBusy.value,false);
});
test('重命名 CAS 冲突时自动重读 catalog 拿新 revision 再试成功',async()=>{
  // turn 期间 durableCount 增长，entry.durable 过期，Host 回 session-revision-conflict。
  // mutateMetadata 应自动重读 catalog 拿新 durable 再试，不把原始码抛给用户。
  let renameCalls=0;const deps=makeDeps({catalog:ref({entries:[{id:'s1',durable:5,status:'ready'}]})});
  deps.api.sessionRename=async(_id,_title,rev)=>{
    renameCalls++;
    if(rev===5)throw Error('session-revision-conflict'); // 第一次用旧 revision 冲突
    if(rev===8)return; // 第二次用新 revision 成功
    throw Error('unexpected-revision:'+rev);
  };
  deps.api.sessionCatalog=async()=>({entries:[{id:'s1',title:'新名称',durable:8,status:'ready'}]});
  const state=createSessionAssembly(deps);
  const ok=await state.mutateMetadata('s1','rename','新名称');
  assert.equal(ok,true,'冲突后重试应成功');
  assert.equal(renameCalls,2,'应调用两次：第一次冲突、第二次成功');
  assert.equal(deps.catalog.value.entries[0].title,'新名称');
  assert.equal(deps.catalogBusy.value,false);
});
test('重命名 CAS 冲突后重读 catalog 找不到目标会话则报错',async()=>{
  // 冲突后重读 catalog，目标会话已不在（被删或被归档移出），不无限重试。
  const deps=makeDeps({catalog:ref({entries:[{id:'s1',durable:5,status:'ready'}]})});
  deps.api.sessionRename=async()=>{throw Error('session-revision-conflict');};
  deps.api.sessionCatalog=async()=>({entries:[]}); // 目标会话已消失
  const state=createSessionAssembly(deps);
  const ok=await state.mutateMetadata('s1','rename','新名称');
  assert.equal(ok,false);
  assert.match(deps.catalogNote.value,/session-revision-conflict/);
  assert.equal(deps.catalogBusy.value,false);
});

// 构造最小 deps，允许覆盖个别字段
function makeDeps(overrides = {}) {
  const api = {
    sessionSelect: async () => {},
    sessionCreate: async () => ({ id: 'new' }),
    sessionCatalog: async () => ({ entries: [] }),
    promptCancel: async () => {},
  };
  return {
    api,
    ref,
    catalog: overrides.catalog ?? ref({ entries: [] }),
    catalogBusy: overrides.catalogBusy ?? ref(false),
    catalogNote: overrides.catalogNote ?? ref(''),
    catalogOpen: overrides.catalogOpen ?? ref(false),
    newSessionTitle: overrides.newSessionTitle ?? ref(''),
    draft: overrides.draft ?? ref(''),
    error: overrides.error ?? ref(''),
    selectedScrollId: overrides.selectedScrollId ?? ref('initial'),
    scrollSession: overrides.scrollSession ?? ref('initial'),
    turn: overrides.turn ?? ref({ running: false, settled: false, text: '', finishReason: '', cancelled: false, interrupted: false, delivered: 0 }),
    approval: overrides.approval ?? ref(null),
    sendBusy: overrides.sendBusy ?? ref(false),
    budgetBusy: overrides.budgetBusy ?? ref(false),
    appearanceBusy: overrides.appearanceBusy ?? ref(false),
    workspaceBusy: overrides.workspaceBusy ?? ref(false),
    sessionDrafts: overrides.sessionDrafts ?? new Map(),
    getSessionGeneration: overrides.getSessionGeneration ?? (() => 0),
    incrementSessionGeneration: overrides.incrementSessionGeneration ?? (() => {}),
    catalogError: overrides.catalogError ?? ((e) => String(e.message || e)),
    clearEnhance: overrides.clearEnhance ?? (() => {}),
    clearAttachments: overrides.clearAttachments ?? (() => {}),
    resetExecution: () => { overrides.turn && (overrides.turn.value={running:false}); },
    resetModelSelection: () => { if(overrides.selectedCustomModel)overrides.selectedCustomModel.value=''; },
    foldOpen: overrides.foldOpen ?? { ids: { clear: () => {} } },
    loadCustomModels: overrides.loadCustomModels ?? (async () => {}),
    fileEditor: overrides.fileEditor ?? { state: { busy: false }, dirty: () => false, reset: () => {} },
    worktreeController: overrides.worktreeController ?? { restore: async () => {} },
    resetWorktreePanel: overrides.resetWorktreePanel ?? (() => {}),
    refresh: overrides.refresh ?? (async () => {}),
    refreshTools: overrides.refreshTools ?? (async () => {}),
    refreshUsage: overrides.refreshUsage ?? (async () => {}),
    refreshWorkspace: overrides.refreshWorkspace ?? (async () => {}),
    refreshWorkspaceFiles: overrides.refreshWorkspaceFiles ?? (async () => {}),
    refreshQueue: overrides.refreshQueue ?? (async () => {}),
    refreshGlobalAppearance: overrides.refreshGlobalAppearance ?? (async () => {}),
    applySelection: overrides.applySelection,
    selectedCustomModel: overrides.selectedCustomModel ?? ref(''),
    previewFloating: overrides.previewFloating ?? ref(false),
    detailName: overrides.detailName ?? ref(''),
    budgetDraft: overrides.budgetDraft ?? ref(''),
    budgetNote: overrides.budgetNote ?? ref(''),
    appearanceNote: overrides.appearanceNote ?? ref(''),
    workspaceNote: overrides.workspaceNote ?? ref(''),
    queuePending: overrides.queuePending ?? ref([]),
    focusComposer: overrides.focusComposer ?? (() => {}),
  };
}
