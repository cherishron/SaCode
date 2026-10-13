import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {registerAcpIpc}=createRequire(import.meta.url)('../acp-ipc.cjs');
test('ACP读取只有两个固定动作且逐字段校验身份',async()=>{
  const handlers=new Map(),calls=[];
  registerAcpIpc({handle:(id,fn)=>handlers.set(id,fn)},async(...args)=>{calls.push(args);return {version:1};});
  assert.equal(handlers.size,7);
  await handlers.get('sacode:acpDelegationList')({}, {sessionId:'current'});
  await handlers.get('sacode:acpDelegationDescribe')({}, {sessionId:'current',delegationId:'delegation-1'});
  assert.deepEqual(calls,[['acp/delegation/list',{sessionId:'current'}],['acp/delegation/describe',{sessionId:'current',delegationId:'delegation-1'}]]);
  for(const args of [null,{}, {sessionId:3},{sessionId:' '},{sessionId:'current',start:true},{sessionId:'x\n'},{sessionId:'x'.repeat(257)}])await assert.rejects(handlers.get('sacode:acpDelegationList')({},args),/bad-acp-arguments/);
  await assert.rejects(handlers.get('sacode:acpDelegationDescribe')({}, {sessionId:'current',delegationId:''}),/bad-acp-arguments/);
  assert.equal(calls.length,2);
});

test('ACP运行操作逐字段校验，审批保留五字段且禁止启动向量',async()=>{
  const handlers=new Map(),calls=[];
  registerAcpIpc({handle:(id,fn)=>handlers.set(id,fn)},async(...args)=>{calls.push(args);return {version:1};});
  const fixtures={
    Create:{sessionId:'current',taskId:'task',requestId:'request',peerId:'opencode',taskText:'检查接口\n仅阅读'},
    Poll:{sessionId:'current',delegationId:'d1'},
    Answer:{sessionId:'current',delegationId:'d1',approvalId:1,decision:'allowed-once',optionId:'once'},
    Cancel:{sessionId:'current',delegationId:'d1',revision:2},
    Close:{sessionId:'current',delegationId:'d1',revision:2},
  };
  for(const [verb,args] of Object.entries(fixtures)) {
    const handler=handlers.get('sacode:acpDelegation'+verb);
    await handler({},args);
    assert.deepEqual(calls.at(-1),['acp/delegation/'+verb.toLowerCase(),args]);
    for(const bad of [null,[],{...args,executable:'cmd'}, {...args,sessionId:'other\n'},
      Object.fromEntries(Object.entries(args).slice(1))]) await assert.rejects(handler({},bad),/bad-acp-arguments/);
  }
  const answer=handlers.get('sacode:acpDelegationAnswer');
  for(const patch of [{approvalId:0},{approvalId:1.5},{approvalId:Number.MAX_SAFE_INTEGER+1},{decision:'always'},{optionId:''}])
    await assert.rejects(answer({}, {...fixtures.Answer,...patch}),/bad-acp-arguments/);
  await answer({}, {...fixtures.Answer,decision:'denied',optionId:''});
  assert.equal(calls.length,6);
});
