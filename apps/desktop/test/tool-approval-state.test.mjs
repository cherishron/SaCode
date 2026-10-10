import { test } from 'node:test';
import assert from 'node:assert/strict';

function ref(val) { return { value: val }; }

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '..', 'renderer', 'tool-approval-state.js'), 'utf8');
eval(src);

const { createToolApprovalAssembly } = globalThis.SaCodeToolApproval;

test('askTool 需审批且有 turn 运行时拒绝', async () => {
  const turn = ref({ running: true });
  const error = ref('');
  const deps = makeDeps({ turn, error });
  const asm = createToolApprovalAssembly(deps);
  await asm.askTool({ name: 'write', needsApproval: true, description: '写文件' });
  assert.ok(error.value.length > 0, '应给出拒绝原因');
});

test('askTool 需审批且有 approval 时拒绝', async () => {
  const approval = ref({ name: 'write' });
  const error = ref('');
  const deps = makeDeps({ approval, error });
  const asm = createToolApprovalAssembly(deps);
  await asm.askTool({ name: 'write', needsApproval: true, description: '写文件' });
  assert.ok(error.value.length > 0, '应给出拒绝原因');
});

test('askTool 不需审批的工具直接调 callTool', async () => {
  const deps = makeDeps();
  const asm = createToolApprovalAssembly(deps);
  let called = null;
  deps.api.toolCall = async (name, args, id) => { called = { name, args, id }; return { result: 'ok' }; };
  await asm.askTool({ name: 'read', needsApproval: false, description: '读文件' });
  assert.equal(called?.name, 'read', '应直接调用 callTool');
});

test('callTool 成功后刷新工具与投影', async () => {
  const deps = makeDeps();
  let refreshed = false;
  deps.api.toolCall = async () => ({ result: 'done' });
  deps.refreshTools = async () => { refreshed = true; };
  deps.refresh = async () => {};
  const asm = createToolApprovalAssembly(deps);
  await asm.callTool('read', 0);
  assert.equal(refreshed, true, '应调用 refreshTools');
});

test('answerTool 清除 approval 后处理常规审批', async () => {
  const approval = ref({ name: 'write', approvalId: 'a1' });
  const deps = makeDeps({ approval });
  let answered = null;
  deps.api.approvalAnswer = async (id, ans) => { answered = { id, ans }; return { accepted: true }; };
  deps.api.toolCall = async () => ({ result: 'ok' });
  deps.refreshTools = async () => {};
  deps.refresh = async () => {};
  const asm = createToolApprovalAssembly(deps);
  await asm.answerTool('allowed-once');
  assert.equal(approval.value, null, '审批应被清除');
  assert.equal(answered?.id, 'a1', '应调用 approvalAnswer');
});

test('answerTool 模型来源审批委托给 ModelApproval', async () => {
  const approval = ref({ source: 'model', name: 'write', sessionId: 's1', turnRequestId: 'tr1' });
  const deps = makeDeps({ approval });
  let modelHandled = false;
  globalThis.SaCodeModelApproval = { answer: async () => { modelHandled = true; return { accepted: true }; } };
  deps.api.toolCall = async () => ({ result: 'ok' });
  deps.refreshTools = async () => {};
  deps.refresh = async () => {};
  const asm = createToolApprovalAssembly(deps);
  await asm.answerTool('allowed-once');
  assert.equal(modelHandled, true, '应委托给 ModelApproval.answer');
  delete globalThis.SaCodeModelApproval;
});

function makeDeps(overrides = {}) {
  const api = {
    approvalAsk: async () => ({ approvalId: 'a1' }),
    approvalAnswer: async () => ({ accepted: true }),
    toolCall: async () => ({ result: 'ok' }),
  };
  return {
    api, ref,
    turn: overrides.turn ?? ref({ running: false }),
    approval: overrides.approval ?? ref(null),
    error: overrides.error ?? ref(''),
    outcome: overrides.outcome ?? ref(''),
    outcomeKind: overrides.outcomeKind ?? ref(''),
    fileEditor: overrides.fileEditor ?? { state: { busy: false }, dirty: () => false },
    getSessionGeneration: overrides.getSessionGeneration ?? (() => 0),
    getPollGeneration: overrides.getPollGeneration ?? (() => 0),
    modelApprovalsSuppressed: overrides.modelApprovalsSuppressed ?? ref(false),
    selectedScrollId: overrides.selectedScrollId ?? ref('s1'),
    modelTurnRequestId: overrides.modelTurnRequestId ?? ref(null),
    cleanErr: overrides.cleanErr ?? ((e) => String((e && e.message) || e)),
    refreshTools: overrides.refreshTools ?? (async () => {}),
    refresh: overrides.refresh ?? (async () => {}),
  };
}
