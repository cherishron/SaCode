// 排序读面不能将旧提案升级为最新修订，空操作也必须拒绝冲突。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const source = readFileSync(new URL('../renderer/pages/model-center-adapter.ts', import.meta.url), 'utf8');
const { createModelCenterAdapters } = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
test('旧排序提案即使无需写入也拒绝冲突', async () => {
  let writes = 0;
  const adapter = createModelCenterAdapters({ modelsDescribe: async () => ({ revision: 2, providers: [{ id: 'a', sortOrder: 1 }] }), modelsSort: async () => { writes++; } })['provider-settings'];
  await assert.rejects(adapter.reorder(['a'], 1), /settings-conflict/);
  assert.equal(writes, 0);
});
test('排序使用同一提案修订并逐条继承宿主回执', async () => {
  const calls = [];
  const adapter = createModelCenterAdapters({ modelsDescribe: async () => ({ revision: 4, providers: [{ id: 'a', sortOrder: 1 }, { id: 'b', sortOrder: 2 }] }), modelsSort: async (...args) => { calls.push(args); return { revision: args[2] + 1 }; } })['provider-settings'];
  await adapter.reorder(['b', 'a'], 4);
  assert.deepEqual(calls, [['b', 1, 4], ['a', 2, 5]]);
});
test('中途冲突停止排序并传回原因', async () => {
  const calls = [];
  const adapter = createModelCenterAdapters({ modelsDescribe: async () => ({ revision: 4, providers: [{ id: 'a', sortOrder: 1 }, { id: 'b', sortOrder: 2 }] }), modelsSort: async (...args) => { calls.push(args); throw Error('settings-conflict'); } })['provider-settings'];
  await assert.rejects(adapter.reorder(['b', 'a'], 4), /settings-conflict/);
  assert.equal(calls.length, 1);
});

test('内置供应商仅调用启停接口，不发送目录草稿或密钥', async () => {
  const calls=[];
  const adapter=createModelCenterAdapters({modelsSetEnabled:async(...args)=>calls.push(args),modelsSave:async()=>assert.fail('内置供应商不能整条更新')})['provider-settings'];
  await adapter.save({id:'builtin',declared:true,enabled:false,name:'目录名称',baseUrl:'https://example.com',key:'不应发送'},7);
  assert.deepEqual(calls,[['builtin',false,7]]);
});
