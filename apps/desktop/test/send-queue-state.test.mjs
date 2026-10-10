import { test } from 'node:test';
import assert from 'node:assert/strict';

function ref(val) { return { value: val }; }

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '..', 'renderer', 'send-queue-state.js'), 'utf8');
eval(src);

const { createSendQueueAssembly } = globalThis.SaCodeSendQueue;

test('send 在 sendBusy 时直接跳过', async () => {
  const sendBusy = ref(true);
  const deps = makeDeps({ sendBusy });
  const asm = createSendQueueAssembly(deps);
  let called = false;
  deps.api.userSend = async () => { called = true; };
  await asm.send();
  assert.equal(called, false, 'sendBusy 时不应该发送');
});

test('send 空文本时跳过', async () => {
  const draft = ref('   ');
  const deps = makeDeps({ draft });
  const asm = createSendQueueAssembly(deps);
  let called = false;
  deps.api.userSend = async () => { called = true; };
  await asm.send();
  assert.equal(called, false, '空文本不应该发送');
});

test('send 在 turn 运行中委托给 enqueueDraft', async () => {
  const turn = ref({ running: true });
  const draft = ref('一条消息');
  const deps = makeDeps({ turn, draft });
  const asm = createSendQueueAssembly(deps);
  let enqueued = false;
  deps.api.queueEnqueue = async () => { enqueued = true; };
  await asm.send();
  assert.equal(enqueued, true, 'turn 运行中应该走 enqueueDraft');
});

test('enqueueDraft 在 busySend 未读取时拒绝', async () => {
  const deps = makeDeps();
  deps.globalAppearance = { value: { busySend: null } };
  const asm = createSendQueueAssembly(deps);
  let called = false;
  deps.api.queueEnqueue = async () => { called = true; };
  await asm.enqueueDraft();
  assert.equal(called, false, 'busySend 未读取时不应入队');
});

test('startTask 在 approval 待处理时拒绝', async () => {
  const approval = ref({ name: 'write' });
  const deps = makeDeps({ approval });
  const asm = createSendQueueAssembly(deps);
  let called = false;
  deps.api.taskStart = async () => { called = true; };
  await asm.startTask();
  assert.equal(called, false, '有 approval 时不应起轮');
});

test('startTask 在 turn 运行时拒绝', async () => {
  const turn = ref({ running: true });
  const deps = makeDeps({ turn });
  const asm = createSendQueueAssembly(deps);
  let called = false;
  deps.api.taskStart = async () => { called = true; };
  await asm.startTask();
  assert.equal(called, false, 'turn 运行时不应起轮');
});

test('cancelTurn 设置 suppressed 标记', async () => {
  const modelApprovalsSuppressed = { value: false };
  const deps = makeDeps({ modelApprovalsSuppressed });
  const asm = createSendQueueAssembly(deps);
  await asm.cancelTurn();
  assert.equal(modelApprovalsSuppressed.value, true, '取消后应设 suppressed');
});

test('cancelTurn 清除模型来源审批', async () => {
  const approval = ref({ source: 'model' });
  const deps = makeDeps({ approval });
  const asm = createSendQueueAssembly(deps);
  await asm.cancelTurn();
  assert.equal(approval.value, null, '模型审批应被清除');
});

test('队列回读跨会话时保留当前清单和待确认项', async () => {
  let generation = 0;
  let resolve;
  const rows = [{ id: 'current' }], pending = [{ requestId: 'r1' }];
  const deps = makeDeps({ queueRows: ref(rows), queuePending: ref(pending), getSessionGeneration: () => generation });
  deps.api.queueDescribe = () => new Promise(done => { resolve = done; });
  const assembly = createSendQueueAssembly(deps);
  const reading = assembly.refreshQueue();
  generation++;
  resolve({ nextTurn: [{ id: 'old' }] });
  await reading;
  assert.deepEqual(deps.queueRows.value, rows);
  assert.deepEqual(deps.queuePending.value, pending);
});

test('队列回读移除已被核心接纳的待确认项', async () => {
  const deps = makeDeps({ queuePending: ref([{ requestId: 'r1' }, { requestId: 'r2' }]) });
  const row = { id: 'q1', source: { rpcId: 'r1' } };
  deps.api.queueDescribe = async () => ({ nextTurn: [row] });
  await createSendQueueAssembly(deps).refreshQueue();
  assert.deepEqual(deps.queueRows.value, [row]);
  assert.deepEqual(deps.queuePending.value, [{ requestId: 'r2' }]);
});

test('队列编辑提交文本内容并回读核心投影', async () => {
  const deps = makeDeps();
  let submitted;
  deps.api.queueUpdate = async (...args) => { submitted = args; };
  deps.api.queueDescribe = async () => ({ nextTurn: [] });
  const assembly = createSendQueueAssembly(deps);
  await assembly.updateQueue('q1', { kind: 'edit', content: [{ type: 'text', text: '新' }, { type: 'image' }, { type: 'text', text: '消息' }] });
  assert.deepEqual(submitted, ['q1', 'edit', '新消息']);
  assert.deepEqual(deps.queueRows.value, []);
});

function makeDeps(overrides = {}) {
  const api = {
    userSend: async () => {},
    queueEnqueue: async () => {},
    taskStart: async () => ({ turnRequestId: 'tr1' }),
    turnStart: async () => {},
    turnCancel: async () => {},
    sessionCatalog: async () => ({ entries: [] }),
  };
  return {
    api, ref,
    draft: overrides.draft ?? ref(''),
    error: overrides.error ?? ref(''),
    turn: overrides.turn ?? ref({ running: false, settled: false, text: '', finishReason: '', cancelled: false, interrupted: false, delivered: 0 }),
    approval: overrides.approval ?? ref(null),
    sendBusy: overrides.sendBusy ?? ref(false),
    queuePending: overrides.queuePending ?? ref([]),
    queueRows: overrides.queueRows ?? ref([]),
    fileEditor: overrides.fileEditor ?? { state: { busy: false }, dirty: () => false },
    attachments: overrides.attachments ?? ref([]),
    uploads: overrides.uploads ?? ref({}),
    selectedCustomModel: overrides.selectedCustomModel ?? ref(''),
    modelDirectory: overrides.modelDirectory ?? { getSnapshot: () => ({ status: 'ready', groups: [], current: null }) },
    globalAppearance: overrides.globalAppearance ?? ref({ busySend: 'queue' }),
    sessionGeneration: overrides.sessionGeneration ?? { value: 0 },
    getSessionGeneration: overrides.getSessionGeneration ?? (() => 0),
    draftRevision: overrides.draftRevision ?? { value: 0 },
    getDraftRevision: overrides.getDraftRevision ?? (() => 0),
    getRpcSeq: overrides.getRpcSeq ?? (() => 0),
    incrementRpcSeq: overrides.incrementRpcSeq ?? (() => 0),
    getSendTicket: overrides.getSendTicket ?? (() => 0),
    incrementSendTicket: overrides.incrementSendTicket ?? (() => 0),
    modelApprovalsSuppressed: overrides.modelApprovalsSuppressed ?? { value: false, set: v => { overrides.modelApprovalsSuppressed?.set?.(v); } },
    modelTurnRequestId: overrides.modelTurnRequestId ?? { value: null },
    getPollGeneration: overrides.getPollGeneration ?? (() => 0),
    startPolling: overrides.startPolling ?? (() => {}),
    stopPolling: overrides.stopPolling ?? (() => {}),
    clearEnhance: overrides.clearEnhance ?? (() => {}),
    clearAttachments: overrides.clearAttachments ?? (() => {}),
    removeAttachment: overrides.removeAttachment ?? (() => {}),
    updateDraft: overrides.updateDraft ?? (() => {}),
    refresh: overrides.refresh ?? (async () => {}),
    refreshCatalog: overrides.refreshCatalog ?? (async () => {}),
    refreshQueue: overrides.refreshQueue ?? (async () => {}),
    projectQueueRow: row => row,
    cleanErr: overrides.cleanErr ?? ((e) => String((e && e.message) || e)),
    imageDraftAllowed: overrides.imageDraftAllowed,
    startTask: overrides.startTask,
  };
}
