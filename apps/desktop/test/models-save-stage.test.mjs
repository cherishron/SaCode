import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {saveModelConfiguration}=createRequire(import.meta.url)('../models-save.cjs');
const view={revision:8,providers:[{id:'p',credentialRef:'derived'}]};

test('配置失败不写凭据，并保留原错误', async()=>{
  const calls=[];
  await assert.rejects(saveModelConfiguration(async method=>{calls.push(method);throw Error('settings-conflict');},{id:'p'},'secret',7),/settings-conflict/);
  assert.deepEqual(calls,['model/registry/update']);
});
test('凭据失败交回已保存修订和稳定阶段，不泄漏底层消息', async()=>{
  const calls=[];
  const result=await saveModelConfiguration(async (method,args)=>{calls.push({method,args});if(calls.length===1)return view;throw Error('secret');},{id:'p'},'secret',7);
  assert.deepEqual(calls.map(call=>call.method),['model/registry/update','model/registry/save-credential']);
  assert.deepEqual(calls[1].args,{providerId:'p',expectedRevision:8,key:'secret'});
  assert.equal(result.revision,8);
  assert.deepEqual(result.saveStatus,{configuration:'saved',credential:'failed',reason:'credential-save-failed'});
  assert.equal(JSON.stringify(result).includes('secret'),false);
});
test('缺派生凭据名属于配置保存后的凭据失败', async()=>{
  const result=await saveModelConfiguration(async()=>({revision:8,providers:[]}),{id:'p'},'secret',7);
  assert.equal(result.saveStatus.credential,'failed');
});
test('成功与未提交密钥保持原注册表响应', async()=>{
  for(const key of ['','secret']){
    let calls=0;
    const result=await saveModelConfiguration(async()=>{calls++;return view;},{id:'p'},key,7);
    assert.equal(result,view);assert.equal(calls,key?2:1);
  }
});
