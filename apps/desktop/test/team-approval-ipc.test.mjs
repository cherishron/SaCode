import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('成员审批绑定团队和成员身份，不误答主会话同号工单',async()=>{
  const {registerTeamIpc}=require('../team-ipc.cjs');
  const handlers=new Map(),calls=[];
  registerTeamIpc({handle:(name,fn)=>handlers.set(name,fn)},async(method,args)=>{calls.push({method,args});return {accepted:true};});
  const answer=handlers.get('sacode:teamApprovalAnswer');
  assert.equal(typeof answer,'function');
  const args={teamSessionId:'current',memberId:'member-1',approvalId:2,decision:'allowed-once'};
  await answer(null,args);
  assert.deepEqual(calls,[{method:'team/approval/answer',args}]);
  await assert.rejects(()=>answer(null,{...args,approvalId:0}),/bad-team-arguments/);
  await assert.rejects(()=>answer(null,{...args,decision:'allow-always'}),/bad-team-arguments/);
  assert.equal(calls.length,1);
});
