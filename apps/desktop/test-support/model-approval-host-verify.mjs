import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {createHash} from 'node:crypto';
import {fixtureHostEnv} from './fixture-env.mjs';
const require=createRequire(import.meta.url),{HostBridge}=require('../host-bridge.cjs'),modelApproval=require('../renderer/model-approval.js');
const exe=resolve(process.env.SACODE_HOST||'');assert.ok(process.env.SACODE_HOST&&existsSync(exe),'必须指定已重建 Host');
const evidence=mkdtempSync(resolve('apps/desktop/.tmp-test/model-approval-host-'));
const source=readFileSync(new URL('../main.cjs',import.meta.url),'utf8'),handlers=new Map();
const begin=source.indexOf('ipcMain.handle("sacode:turnPoll"'),end=source.indexOf('ipcMain.handle("sacode:turnCancel"',begin);
assert.ok(begin>=0&&end>begin);
const startBegin=source.indexOf('ipcMain.handle("sacode:taskStart"'),startEnd=source.indexOf('\nipcMain.handle(',startBegin+1);
assert.ok(startBegin>=0&&startEnd>startBegin);
let bridge,scenario;const results=[];
const server=createServer(async(req,res)=>{
 try {
  let body='';for await(const chunk of req)body+=chunk;
  scenario.requests.push(JSON.parse(body));
  res.writeHead(200,{'content-type':'text/event-stream'});
  if(scenario.requests.length===1){
   const calls=[['write',{path:'result.txt',content:'桌面审批消费链\n'}],['update_goal',{goal_id:'goal-1',status:'completed'}]];
   res.end('data: '+JSON.stringify({choices:[{index:0,delta:{tool_calls:calls.map(([name,args],index)=>({index,id:'gui-'+index,type:'function',function:{name,arguments:JSON.stringify(args)}}))}}]})+'\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"total_tokens":3}}\n\ndata: [DONE]\n\n');
  }else res.end('data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"total_tokens":3}}\n\ndata: [DONE]\n\n');
 }catch(error){scenario.serverError=error.stack;res.destroy(error);}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{
 for(const decision of ['allowed-once','denied','cancelled']){
  const root=join(evidence,decision);mkdirSync(root);scenario={root,requests:[],rpc:[]};
  bridge=new HostBridge(exe,fixtureHostEnv(root,{PATH:join(process.env.SystemRoot,'System32'),TMP:root,TEMP:root,SACODE_PROVIDER_MODEL:'desktop-approval-protocol-fixture',SACODE_PROVIDER_BASE_URL:`http://127.0.0.1:${server.address().port}/v1/chat/completions`}));await bridge.start(root);
  const ipcContext={ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},bridge,modelApproval,modelTurnRequestId:null,isStr:value=>typeof value==='string',withHost:work=>work()};
  vm.runInNewContext(source.slice(begin,end),ipcContext);
  vm.runInNewContext(source.slice(startBegin,startEnd),ipcContext);
  await bridge.request('goal/create',{sessionId:'current',objective:'文件审批与目标完成'});
  await bridge.request('session/append',{eventType:'user/message',data:'写入指定文件'});
  const started=await handlers.get('sacode:taskStart')({},{});
  assert.equal(typeof started.turnRequestId,'string');assert.equal(started.turnRequestId,ipcContext.modelTurnRequestId);
  let answered=false,settled;const deadline=Date.now()+45000;
  while(Date.now()<deadline){
   const poll=await handlers.get('sacode:turnPoll')();
   const proposal=modelApproval.selectProposal(poll.approvalRequests,'current',poll.running,poll.turnRequestId);
   if(proposal){
    assert.equal(proposal.turnRequestId,started.turnRequestId,'审批必须绑定本次真实 task/start 信封身份');
    assert.deepEqual(JSON.parse(proposal.argumentsJson),{path:'result.txt',content:'桌面审批消费链\n'});
    assert.equal(bridge.notifications.some(n=>n.method==='approval/asked'),false);
    assert.equal(answered,false);answered=true;
    scenario.proposal=proposal;
    if(decision==='cancelled'){
     scenario.cancelStarted=Date.now();
     assert.equal((await bridge.request('turn/cancel')).cancelRequested,true);
     assert.equal((await modelApproval.answer({approvalAnswer:()=>{throw Error('停止后的提案不得再应答');}},proposal,'allowed-once',()=>false)).stale,true);
     continue;
    }
    const answer=await modelApproval.answer({approvalAnswer:async(id,d)=>{scenario.rpc.push({method:'approval/answer',id,decision:d});return bridge.request('approval/answer',{approvalId:id,decision:d});},toolCall:()=>{throw Error('模型工具不得再次由桌面执行');}},proposal,decision,()=>true);
    assert.equal(answer.accepted,true);
   }
   if(poll.settled){settled=poll;break;}await sleep(40);
  }
  assert.ok(settled);assert.equal(answered,true);assert.equal(scenario.serverError,undefined);
  const goal=await bridge.request('goal/describe',{sessionId:'current'});
  if(decision==='allowed-once'){
   assert.equal(readFileSync(join(root,'result.txt'),'utf8'),'桌面审批消费链\n');assert.equal(goal.phase,'complete');assert.equal(scenario.requests.length,2);
  }else if(decision==='denied'){assert.equal(existsSync(join(root,'result.txt')),false);assert.equal(goal.phase,'blocked');assert.equal(goal.blockedReason,'goal-no-progress');}
  else{assert.equal(existsSync(join(root,'result.txt')),false);assert.equal(goal.phase,'active');assert.equal(settled.cancelled,true);assert.ok(Date.now()-scenario.cancelStarted<5000);}
  assert.equal(scenario.rpc.length,decision==='cancelled'?0:1);
  const log=readFileSync(join(root,'session.log'),'utf8');
  if(decision!=='cancelled')assert.equal(log.split('\n').filter(l=>l.includes('\ttool/runtime/call\twrite ')).length,1,'拒绝也记录调用尝试；两种结果均只能尝试一次');
  if(decision==='denied')assert.ok(log.includes('\ttool/runtime/result\tdenied:write:approval-denied'));
  results.push({decision,passed:true,goal,settled});
  writeFileSync(join(root,'rpc.json'),JSON.stringify(scenario,null,2));
  assert.equal((await bridge.stop()).code,0);bridge=null;
  const before=scenario.requests.length;
  bridge=new HostBridge(exe,fixtureHostEnv(root,{PATH:join(process.env.SystemRoot,'System32'),TMP:root,TEMP:root,SACODE_PROVIDER_MODEL:'desktop-approval-protocol-fixture',SACODE_PROVIDER_BASE_URL:`http://127.0.0.1:${server.address().port}/v1/chat/completions`}));await bridge.start(root);
  const recovered=await bridge.request('goal/describe',{sessionId:'current'});await sleep(200);assert.equal(scenario.requests.length,before);assert.equal(recovered.phase,goal.phase);
  assert.equal((await bridge.stop()).code,0);bridge=null;
  results.at(-1).recoveryDidNotExecute=true;
 }
 console.log('MODEL_APPROVAL_HOST_PASS 3');
}finally{
 if(bridge)await bridge.stop();server.closeAllConnections();await new Promise(r=>server.close(r));
 writeFileSync(join(evidence,'results.json'),JSON.stringify(results,null,2));
 const hash=value=>createHash('sha256').update(value).digest('hex');
 writeFileSync(join(evidence,'manifest.json'),JSON.stringify({host:exe,hostSha256:hash(readFileSync(exe)),mainSha256:hash(source),helperSha256:hash(readFileSync(new URL('../renderer/model-approval.js',import.meta.url))),bridgeSha256:hash(readFileSync(new URL('../host-bridge.cjs',import.meta.url))),verifierSha256:hash(readFileSync(new URL(import.meta.url))),command:[process.execPath,...process.argv.slice(1)],scope:'真实 Host + 产品 taskStart/turnPoll IPC 分派 + 审批状态层与任务身份绑定；不是 Electron GUI 验收'},null,2));
 console.log('MODEL_APPROVAL_HOST_EVIDENCE='+evidence);
}
