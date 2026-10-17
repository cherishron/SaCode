import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../renderer/send-queue-state.js';

function fixture(taskStart) {
  const ref = value => ({ value });
  const deps = {
    api: { taskStart }, selectedCustomModel: ref('custom-1'), approval: ref(null),
    turn: ref({ running: false }), error: ref(''),
    modelApprovalsSuppressed: ref(false), modelTurnRequestId: ref(null),
    getSessionGeneration: () => 0, startPolling: () => {}, stopPolling: () => {},
  };
  return { deps, controller: globalThis.SaCodeSendQueue.createSendQueueAssembly(deps) };
}
test('起轮把选中的自定义模型交给宿主', async () => {
  let selected;
  const { deps, controller } = fixture(async id => { selected = id; return { turnRequestId: '7' }; });
  await controller.startTask();
  assert.equal(selected, 'custom-1');
  assert.equal(deps.modelTurnRequestId.value, '7');
});
test('自定义模型被删除时保留错误并清空失效选中态', async () => {
  const { deps, controller } = fixture(async () => { throw Error('-32000 custom-model-not-found'); });
  await controller.startTask();
  assert.equal(deps.selectedCustomModel.value, '');
  assert.equal(deps.turn.value.running, false);
  assert.ok(deps.error.value.length > 0);
});
test('会话切换后不应用迟到起轮回执', async () => {
  let generation = 0, resolve;
  const { deps } = fixture(() => new Promise(r => { resolve = r; }));
  deps.getSessionGeneration = () => generation;
  const controller = globalThis.SaCodeSendQueue.createSendQueueAssembly(deps);
  const pending = controller.startTask();
  generation++;
  resolve({ turnRequestId: 'old' });
  await pending;
  assert.equal(deps.modelTurnRequestId.value, null);
});
