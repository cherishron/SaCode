import { test } from 'node:test';
import '../renderer/turn-poll-state.js';
import assert from 'node:assert/strict';

function ref(val) { return { value: val }; }

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '..', 'renderer', 'send-queue-state.js'), 'utf8');
eval(src);

const { createSendQueueAssembly } = globalThis.SaCodeSendQueue;

test('send 在 sendBusy 时不静默丢弃：busySend=queue 时入队', async () => {
  const sendBusy = ref(true);
  const draft = ref('第二条消息');
  const deps = makeDeps({ sendBusy, draft });
  const asm = createSendQueueAssembly(deps);
  let userSent = false, enqueued = false;
  deps.api.userSend = async () => { userSent = true; };
  deps.api.queueEnqueue = async () => { enqueued = true; };
  await asm.send();
  assert.equal(userSent, false, 'sendBusy 时不应该直接发送');
  assert.equal(enqueued, true, 'sendBusy + busySend=queue 时应入队而非静默丢弃');
});

test('send 在 sendBusy 时不静默丢弃：busySend 未读取时给明确提示', async () => {
  const sendBusy = ref(true);
  const draft = ref('第二条消息');
  const error = ref('');
  const deps = makeDeps({ sendBusy, draft, error });
  deps.globalAppearance = { value: { busySend: null } };
  const asm = createSendQueueAssembly(deps);
  let userSent = false, enqueued = false;
  deps.api.userSend = async () => { userSent = true; };
  deps.api.queueEnqueue = async () => { enqueued = true; };
  await asm.send();
  assert.equal(userSent, false, '不应直接发送');
  assert.equal(enqueued, false, 'busySend 未读取时不应入队');
  assert.ok(error.value.length > 0, '应给明确提示而非静默丢弃');
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


test('同会话队列乱序回读不覆盖最新条目', async()=>{
 const deps=makeDeps(),pending=[];deps.api.queueDescribe=()=>new Promise(resolve=>pending.push(resolve));const assembly=createSendQueueAssembly(deps);
 const old=assembly.refreshQueue(),latest=assembly.refreshQueue();pending[1]({nextTurn:[{id:'latest',source:{rpcId:'r2'}}]});await latest;pending[0]({nextTurn:[{id:'old',source:{rpcId:'r1'}}]});await old;assert.equal(deps.queueRows.value[0].id,'latest');
});
test('队列读取失败保留原条目与待确认项，重试可恢复', async()=>{
 const rows=[{id:'retained',source:{rpcId:'r1'}}],pending=[{requestId:'r2'}],deps=makeDeps({queueRows:ref(rows),queuePending:ref(pending)});deps.api.queueDescribe=async()=>{throw Error('read-failed');};const assembly=createSendQueueAssembly(deps);
 assert.equal(await assembly.refreshQueue(),false);assert.deepEqual(deps.queueRows.value,rows);assert.deepEqual(deps.queuePending.value,pending);assert.match(deps.error.value,/队列读取失败：read-failed/);
 deps.api.queueDescribe=async()=>({nextTurn:[]});assert.equal(await assembly.refreshQueue(),true);assert.equal(deps.error.value,'');
});
test('跨会话迟到失败不污染当前错误', async()=>{
 let generation=0,reject;const deps=makeDeps({getSessionGeneration:()=>generation,error:ref('当前会话错误')});deps.api.queueDescribe=()=>new Promise((_,r)=>reject=r);const reading=createSendQueueAssembly(deps).refreshQueue();generation++;reject(Error('old-error'));await reading;assert.equal(deps.error.value,'当前会话错误');
});
test('队列更新后切换会话不回读新会话', async()=>{
 let generation=0,resolve,reads=0;const deps=makeDeps({getSessionGeneration:()=>generation});deps.api.queueUpdate=()=>new Promise(r=>resolve=r);deps.api.queueDescribe=async()=>{reads++;return{nextTurn:[]};};const writing=createSendQueueAssembly(deps).updateQueue('q1',{kind:'delete'});generation++;resolve();await writing;assert.equal(reads,0);
});
test('损坏队列回执不清空条目或待确认消息', async()=>{
 const deps=makeDeps({queueRows:ref([{id:'keep'}]),queuePending:ref([{requestId:'keep'}])});deps.api.queueDescribe=async()=>({nextTurn:{}});await createSendQueueAssembly(deps).refreshQueue();assert.equal(deps.queueRows.value[0].id,'keep');assert.equal(deps.queuePending.value.length,1);assert.match(deps.error.value,/bad-queue-view/);
});

// —— 发送行为补充测试 ——
// 以下四组覆盖此前要求：连续两条不丢/不重复/不串序、提交失败后可恢复、
// 内层不提前释放 sendBusy、区分首次提交 vs 已有回合的 steer 行为。

test('连续两条消息不丢、不重复、不串序', async () => {
  const sendBusy = ref(false);
  const draft = ref('第一条');
  let draftRev = 0;
  const deps = makeDeps({ sendBusy, draft });
  deps.getDraftRevision = () => draftRev;
  const calls = [];
  let resolveFirst;
  deps.api.userSend = async () => { calls.push('userSend:第一条'); return new Promise(r => { resolveFirst = r; }); };
  deps.api.queueEnqueue = async (text) => { calls.push(`queueEnqueue:${text}`); };
  deps.api.queueDescribe = async () => ({ nextTurn: [] });
  const asm = createSendQueueAssembly(deps);

  const first = asm.send();
  await new Promise(r => setTimeout(r, 0)); // 让 userSend 进入，sendBusy 置 true
  assert.equal(sendBusy.value, true, '第一条发送中 sendBusy 应为 true');

  // 用户输入第二条（draftRevision 递增，避免第一条完成后清空第二条草稿）
  draftRev = 1;
  draft.value = '第二条';
  const second = asm.send();
  await second;
  calls.push('second-done');

  resolveFirst();
  await first;
  calls.push('first-done');

  // 不丢：两条都触发了对后端的调用
  assert.equal(calls.filter(c => c.startsWith('userSend:')).length, 1, '第一条应恰好调一次 userSend');
  assert.equal(calls.filter(c => c.startsWith('queueEnqueue:')).length, 1, '第二条应恰好调一次 queueEnqueue');
  // 不串序：第一条 userSend 先于第二条 queueEnqueue
  assert.ok(calls.indexOf('userSend:第一条') < calls.indexOf('queueEnqueue:第二条'), '第一条 userSend 应先于第二条 queueEnqueue');
  // 第二条入队即返回，第一条待 userSend resolve 后才完成
  assert.ok(calls.indexOf('second-done') < calls.indexOf('first-done'), '第二条应先完成（入队即返回）');
  // 第二条文本正确
  assert.equal(calls[1], 'queueEnqueue:第二条', '第二条入队文本应为"第二条"');
});

test('提交失败后 sendBusy 释放且草稿保留，第二条可恢复', async () => {
  const sendBusy = ref(false);
  const draft = ref('失败消息');
  const deps = makeDeps({ sendBusy, draft });
  deps.api.userSend = async () => { throw new Error('network-down'); };
  const asm = createSendQueueAssembly(deps);

  await asm.send();
  assert.equal(sendBusy.value, false, '失败后 sendBusy 应被 finally 释放');
  assert.equal(draft.value, '失败消息', '失败后草稿应保留（未清空）');
  assert.match(deps.error.value, /消息发送失败/, '应显示失败提示');

  // 第二条可恢复
  let sent2 = false;
  deps.api.userSend = async () => { sent2 = true; };
  draft.value = '重试消息';
  await asm.send();
  assert.equal(sent2, true, '失败后第二条应能正常发送');
  assert.equal(sendBusy.value, false, '第二条完成后 sendBusy 应释放');
});

test('sendBusy 分支调 submitBusyDraft 不提前释放 sendBusy', async () => {
  // sendBusy=true 时 send 走 submitBusyDraft 而非 enqueueDraft。
  // enqueueDraft 的 finally 会把 sendBusy 重置为 false，此处不能调它。
  const sendBusy = ref(true);
  const draft = ref('排队消息');
  const deps = makeDeps({ sendBusy, draft });
  deps.api.queueEnqueue = async () => {};
  deps.api.queueDescribe = async () => ({ nextTurn: [] });
  const asm = createSendQueueAssembly(deps);

  await asm.send();
  assert.equal(sendBusy.value, true, '内层 submitBusyDraft 不应释放 sendBusy（由外层 send 持有）');
});

test('区分首次提交尚未完成（sendBusy）与已有运行回合（turn.running）的 steer 行为', async () => {
  // 场景 A：sendBusy=true（首次提交尚未完成），busySend=steer → submitBusyDraft，sendBusy 不释放
  const sendBusyA = ref(true);
  const draftA = ref('steer-while-sending');
  const depsA = makeDeps({ sendBusy: sendBusyA, draft: draftA });
  depsA.globalAppearance = ref({ busySend: 'steer' });
  depsA.api.queueEnqueue = async () => {};
  depsA.api.queueDescribe = async () => ({ nextTurn: [] });
  const asmA = createSendQueueAssembly(depsA);
  await asmA.send();
  assert.equal(sendBusyA.value, true, 'sendBusy 分支（steer）：submitBusyDraft 不应释放 sendBusy');

  // 场景 B：turn.running=true（已有运行回合），busySend=steer → enqueueDraft，sendBusy 被 finally 释放
  const sendBusyB = ref(false);
  const turnB = ref({ running: true, settled: false, text: '', finishReason: '', cancelled: false, interrupted: false, delivered: 0 });
  const draftB = ref('steer-while-turn');
  const depsB = makeDeps({ sendBusy: sendBusyB, turn: turnB, draft: draftB });
  depsB.globalAppearance = ref({ busySend: 'steer' });
  depsB.api.queueEnqueue = async () => {};
  depsB.api.queueDescribe = async () => ({ nextTurn: [] });
  const asmB = createSendQueueAssembly(depsB);
  await asmB.send();
  assert.equal(sendBusyB.value, false, 'turn.running 分支（steer）：enqueueDraft 的 finally 应释放 sendBusy');
});
