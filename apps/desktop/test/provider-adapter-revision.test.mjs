// 排序读面不能将旧提案升级为最新修订，空操作也必须拒绝冲突。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const source = readFileSync(new URL('../renderer/pages/model-center-adapter.ts', import.meta.url), 'utf8');
const { createModelCenterAdapters } = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'));

test('默认模型读面与写入保留宿主身份及提案修订',async()=>{
  const calls=[];
  const adapter=createModelCenterAdapters({modelsDescribe:async()=>({providers:[],revision:4,writable:true,defaultProviderId:'p',defaultModel:'m'}),modelsCatalog:async()=>[],modelsSetDefault:async(...args)=>{calls.push(args);}})['provider-settings'];
  const view=await adapter.describe();assert.equal(view.defaultProviderId,'p');assert.equal(view.defaultModel,'m');
  await adapter.setDefault('p','m',4);assert.deepEqual(calls,[['p','m',4]]);
});

test('目录实例添加仅发送目录身份和原提案修订，冲突不重试',async()=>{
  const calls=[];
  const adapter=createModelCenterAdapters({modelsCreateInstance:async(...args)=>{calls.push(args);throw Error('settings-conflict');}})['provider-settings'];
  await assert.rejects(adapter.createInstance('stepfun',4),/settings-conflict/);
  assert.deepEqual(calls,[['stepfun',4]]);
});
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

test('内置供应商仅调用启停接口，不发送目录草稿', async () => {
  const calls=[];
  const adapter=createModelCenterAdapters({modelsSetEnabled:async(...args)=>calls.push(args),modelsSave:async()=>assert.fail('内置供应商不能整条更新')})['provider-settings'];
  await adapter.save({id:'builtin',declared:true,enabled:false,name:'目录名称',baseUrl:'https://example.com',key:''},7);
  assert.deepEqual(calls,[['builtin',false,7]]);
});

test('内置供应商密钥沿启停回执修订独立保存',async()=>{
  const calls=[];
  const adapter=createModelCenterAdapters({modelsSetEnabled:async(...args)=>{calls.push(['enabled',...args]);return {revision:8};},modelsSaveCredential:async(...args)=>{calls.push(['credential',...args]);return {saved:true};},modelsSave:async()=>assert.fail('不能改目录')})['provider-settings'];
  await adapter.save({id:'builtin',declared:true,enabled:true,key:'fixture-key'},7);
  assert.deepEqual(calls,[['enabled','builtin',true,7],['credential','builtin','fixture-key',8]]);
});

test('内置供应商密钥失败保留成功修订供重试且不泄露底层消息',async()=>{
  const adapter=createModelCenterAdapters({modelsSetEnabled:async()=>({revision:8}),modelsSaveCredential:async()=>{throw Error('fixture-secret');}})['provider-settings'];
  await assert.rejects(adapter.save({id:'builtin',declared:true,enabled:true,key:'fixture-key'},7),e=>e.configurationRevision===8&&/配置已保存，但密钥未保存/.test(e.message)&&!e.message.includes('fixture-secret'));
});

test('配置部分保存必须传回明确失败提示，不报告密钥成功', async () => {
  const adapter = createModelCenterAdapters({ modelsSave: async () => ({ revision: 8, saveStatus: { configuration: 'saved', credential: 'failed' } }) })['provider-settings'];
  await assert.rejects(adapter.save({ id: 'p', declared: false, key: 'fixture' }, 7), /配置已保存，但密钥未保存/);
});

const budgetAdapter = stats => createModelCenterAdapters({
  usageStatus: async () => ({}), customsDescribe: async () => ({models:[{id:'m'}],revision:1}),
  modelsDescribe: async () => ({providers:[]}), ledgerStats: async () => stats,
})['budget-stats'];

test('金额非法或安全整数溢出时显示待核，不展示部分合计', async () => {
  for (const values of [[10,-1],[NaN],[Infinity],[0.5],[Number.MAX_SAFE_INTEGER,1]]) {
    const view=await budgetAdapter({usageKindTotals:values.map(usedMicros=>({key:'chat',currency:'CNY',usedMicros}))}).describe();
    assert.equal(view.costs.model.amountMicro,null);
    assert.match(view.costs.model.note,/待核算/);
  }
});

test('模型金额无效或存在重复币种行时不以最后一行覆盖预算用量', async () => {
  for (const rows of [[{key:'m',currency:'CNY',usedMicros:-1}],
    [{key:'m',currency:'CNY',usedMicros:10},{key:'m',currency:'USD',usedMicros:20}]]) {
    assert.equal((await budgetAdapter({modelTotals:rows}).describe()).models[0].used,null);
  }
});

test('有效零金额保留，正常同币种合计和模型用量不受影响', async () => {
  const view=await budgetAdapter({usageKindTotals:[{key:'chat',currency:'CNY',usedMicros:0},{key:'chat',currency:'CNY',usedMicros:10}],modelTotals:[{key:'m',currency:'CNY',usedMicros:0}]}).describe();
  assert.equal(view.costs.model.amountMicro,10);
  assert.deepEqual(view.models[0].used,{micro:0,currency:'CNY'});
});

test('密钥重试沿部分保存回执修订，仅调用绑定凭据接口', async () => {
  const calls=[];
  const adapter=createModelCenterAdapters({modelsSave:async()=>({revision:9,saveStatus:{configuration:'saved',credential:'failed'}}),modelsSaveCredential:async(...args)=>calls.push(args)})['provider-settings'];
  let failure;
  try { await adapter.save({id:'p',key:'fixture-key',declared:false},8); } catch(e) { failure=e; }
  assert.equal(failure.configurationRevision,9);
  assert.equal(failure.message.includes('fixture-key'),false);
  await adapter.saveCredential('p','fixture-key',failure.configurationRevision);
  assert.deepEqual(calls,[['p','fixture-key',9]]);
});
