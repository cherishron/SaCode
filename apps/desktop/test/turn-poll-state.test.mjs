import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,existsSync} from 'node:fs';
const file=new URL('../renderer/turn-poll-state.js',import.meta.url);
function fixture(poll,refresh=async()=>{}){
  assert.ok(existsSync(file),'轮询模块尚未提取');
  let tick,epoch=0,generation=0,started=0;
  const ctx=vm.createContext({setInterval:fn=>{tick=fn;return 1;},clearInterval:()=>{}});
  vm.runInContext(readFileSync(file,'utf8'),ctx);
  const turn={value:{text:'',running:true}},usage={value:{}},approval={value:null},error={value:''},queueRows={value:[{}]};
  const state=ctx.SaCodeTurnPoll.createTurnPoll({poll,getGeneration:()=>generation,getEpoch:()=>epoch,invalidate:()=>epoch++,
    getApprovalContext:()=>({suppressed:false,sessionId:'current',requestId:'1'}),selectProposal:()=>null,
    turn,usage,approval,error,queueRows,refresh,refreshTools:async()=>{},refreshQueue:async()=>{},
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

test('通知帧为空时仍按待答身份刷新卡片，不跨会话消费迟到投影',async()=>{
  let calls=0;const f=fixture(async()=>({frames:[],running:true,questionId:'question-1'}),async()=>{calls++;});
  f.state.start();await f.run();await f.run();assert.equal(calls,1);assert.equal(f.turn.value.questionId,'question-1');
  let resolve,entered;const ready=new Promise(r=>entered=r);
  const stale=fixture(async()=>({frames:[],running:true,questionId:'question-old'}),()=>new Promise(r=>{resolve=r;entered();}));
  stale.state.start();const pending=stale.run();await ready;stale.changeSession();resolve();await pending;
  assert.equal(stale.turn.value.questionId,undefined);
});

test('用量和工具参数增量不污染助手 Markdown，回放未完成时保留正文',async()=>{
  let options,resolve;
  const f=fixture(async()=>({frames:['text:```js\nconst x = 1;\n```','usage:12','tool-call-delta:{"path":"a.js"}'],settled:true,running:false}),o=>{if(!o?.settledTurn)return Promise.resolve();options=o;return new Promise(r=>resolve=r);});
  f.state.start();const pending=f.run();
  for(let i=0;i<5;i++)await Promise.resolve();
  assert.equal(f.turn.value.text,'```js\nconst x = 1;\n```');
  assert.equal(f.turn.value.toolCallDeltas[0],'{"path":"a.js"}');
  assert.equal(f.turn.value.projectionPending,true);assert.equal(options.settledTurn,true);
  resolve();await pending;
});
test('request-provider-failed 携带分类时显示友好提示而非原始协议串',async()=>{
  const cases=[
    ['error:request-provider-failed:provider-error:server:500','模型服务返回错误，请稍后重试或换一个供应商。'],
    ['error:request-provider-failed:provider-error:rate-limit:429','模型服务限流，请稍后重试。'],
    ['error:request-provider-failed:provider-error:client:401','请求被模型服务拒绝，请检查凭据、模型名与 API 地址。'],
    ['error:request-provider-failed:provider-error:connection','连不上模型服务，请检查 API 地址与网络。'],
    ['error:request-provider-failed:provider-error:timeout','模型服务响应超时，请稍后重试。'],
  ];
  for(const [finishReason,expected] of cases){
    const f=fixture(async()=>({frames:[],running:false,settled:true,cancelled:false,interrupted:true,finishReason}));
    f.state.start();await f.run();
    if(finishReason.endsWith('provider-error:timeout')) {
      assert.match(f.error.value,/超时/);
      assert.match(f.error.value,/网络|重试/);
      assert.equal(f.error.value.includes('request-provider-failed'),false);
    } else assert.equal(f.error.value,expected,`finishReason=${finishReason} 应显示友好提示`);
  }
});
