import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {registerAcpIpc}=createRequire(import.meta.url)('../acp-ipc.cjs');
test('ACP读取只有两个固定动作且逐字段校验身份',async()=>{
  const handlers=new Map(),calls=[];
  registerAcpIpc({handle:(id,fn)=>handlers.set(id,fn)},async(...args)=>{calls.push(args);return {version:1};});
  assert.deepEqual([...handlers.keys()],['sacode:acpDelegationList','sacode:acpDelegationDescribe']);
  await handlers.get('sacode:acpDelegationList')({}, {sessionId:'current'});
  await handlers.get('sacode:acpDelegationDescribe')({}, {sessionId:'current',delegationId:'delegation-1'});
  assert.deepEqual(calls,[['acp/delegation/list',{sessionId:'current'}],['acp/delegation/describe',{sessionId:'current',delegationId:'delegation-1'}]]);
  for(const args of [null,{}, {sessionId:3},{sessionId:' '},{sessionId:'current',start:true},{sessionId:'x\n'},{sessionId:'x'.repeat(257)}])await assert.rejects(handlers.get('sacode:acpDelegationList')({},args),/bad-acp-arguments/);
  await assert.rejects(handlers.get('sacode:acpDelegationDescribe')({}, {sessionId:'current',delegationId:''}),/bad-acp-arguments/);
  assert.equal(calls.length,2);
});
