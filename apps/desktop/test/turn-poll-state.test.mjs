import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,existsSync} from 'node:fs';
const file=new URL('../renderer/turn-poll-state.js',import.meta.url);
function fixture(poll){
  assert.ok(existsSync(file),'轮询模块尚未提取');
  let tick,epoch=0,generation=0,started=0;
  const ctx=vm.createContext({setInterval:fn=>{tick=fn;return 1;},clearInterval:()=>{}});
  vm.runInContext(readFileSync(file,'utf8'),ctx);
  const turn={value:{text:'',running:true}},usage={value:{}},approval={value:null},error={value:''},queueRows={value:[{}]};
  const state=ctx.SaCodeTurnPoll.createTurnPoll({poll,getGeneration:()=>generation,getEpoch:()=>epoch,invalidate:()=>epoch++,
    getApprovalContext:()=>({suppressed:false,sessionId:'current',requestId:'1'}),selectProposal:()=>null,
    turn,usage,approval,error,queueRows,refresh:async()=>{},refreshTools:async()=>{},refreshQueue:async()=>{},
    showContextTip:()=>{},startTask:async()=>{started++;}});
  return {state,turn,usage,error,run:()=>tick(),changeSession:()=>generation++,started:()=>started};
}
test('结算采用核心用量并正常续队列',async()=>{
  const f=fixture(async()=>({frames:['text:你好'],running:false,settled:true,used:12,budget:100,usageVerdict:'recorded'}));
  f.state.start();await f.run();assert.equal(f.turn.value.text,'你好');assert.equal(f.usage.value.used,12);assert.equal(f.started(),1);
});
test('取消结算保留半截正文且不续队列',async()=>{
  const f=fixture(async()=>({frames:['text:半截'],running:false,settled:true,cancelled:true}));
  f.state.start();await f.run();assert.equal(f.turn.value.text,'半截');assert.equal(f.started(),0);
});
test('换会话后在途轮询回执不污染新状态',async()=>{
  let resolve;const f=fixture(()=>new Promise(r=>{resolve=r;}));
  f.state.start();const pending=f.run();f.changeSession();resolve({frames:['text:旧会话'],running:false,settled:true});await pending;
  assert.equal(f.turn.value.text,'');assert.equal(f.started(),0);
});
test('轮询失败显示真实错误并清除模型审批',async()=>{
  const f=fixture(async()=>{throw Error('host-gone');});f.state.start();await f.run();assert.equal(f.error.value,'host-gone');
});
