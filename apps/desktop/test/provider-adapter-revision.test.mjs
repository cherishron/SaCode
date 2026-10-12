// 排序读面不能将旧提案升级为最新修订，空操作也必须拒绝冲突。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const source = readFileSync(new URL('../renderer/pages/model-center-adapter.ts', import.meta.url), 'utf8');
const { createModelCenterAdapters } = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
test('旧排序提案即使无需写入也拒绝冲突', async () => {
  let writes = 0;
  const adapter = createModelCenterAdapters({ modelsDescribe: async () => ({ revision: 2, providers: [{ id: 'a', sortOrder: 0 }] }), modelsSort: async () => { writes++; } })['provider-settings'];
  await assert.rejects(adapter.reorder(['a'], 1), /settings-conflict/);
  assert.equal(writes, 0);
});
test('排序使用同一提案修订并逐条继承宿主回执', async () => {
  const calls = [];
  const adapter = createModelCenterAdapters({ modelsDescribe: async () => ({ revision: 4, providers: [{ id: 'a', sortOrder: 0 }, { id: 'b', sortOrder: 1 }] }), modelsSort: async (...args) => { calls.push(args); return { revision: args[2] + 1 }; } })['provider-settings'];
  await adapter.reorder(['b', 'a'], 4);
  assert.deepEqual(calls, [['b', 0, 4], ['a', 1, 5]]);
});
test('中途冲突停止排序并传回原因', async () => {
  const calls = [];
  const adapter = createModelCenterAdapters({ modelsDescribe: async () => ({ revision: 4, providers: [{ id: 'a', sortOrder: 0 }, { id: 'b', sortOrder: 1 }] }), modelsSort: async (...args) => { calls.push(args); throw Error('settings-conflict'); } })['provider-settings'];
  await assert.rejects(adapter.reorder(['b', 'a'], 4), /settings-conflict/);
  assert.equal(calls.length, 1);
});
