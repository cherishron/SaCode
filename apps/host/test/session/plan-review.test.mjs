// 计划流程合成模型回归（不依赖真实模型/人工点击）：
//   进入计划模式 → 模型 exit_plan_mode 呈交 → 用户批准/继续规划/关闭/取消 → 计划状态与有效权限。
// 关键保证：批准计划本身不授予写/执行权限，下游审批不被跳过；退出恢复进入前权限，不隐式升级。
// 结构对照 user-question.test.mjs（HTTP SSE 夹具 + HostBridge）。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const {HostBridge}=createRequire(import.meta.url)('../../../desktop/host-bridge.cjs');
const nap=ms=>new Promise(r=>setTimeout(r,ms));
const PLAN_MD='# 计划\n1. 读 a.txt\n2. 改 a.txt';

// 通用装配：每条用例一个临时会话目录 + 一台 SSE 夹具模型；handler 决定第 N 次请求返回什么。
async function withHost(handler, body) {
  assert.ok(process.env.SACODE_HOST&&existsSync(process.env.SACODE_HOST),'需要本轮Host（串行构建后指向新产物）');
  const root=process.env.SACODE_TEST_ROOT||fileURLToPath(new URL('../../../../target/tmp/plan-review-host',import.meta.url));
  mkdirSync(root,{recursive:true});
  const dir=mkdtempSync(join(root,'plan-')),project=join(dir,'project');
  mkdirSync(project);writeFileSync(join(project,'a.txt'),'seed-content');
  const failures=[];let requests=0;const state={};
  const server=createServer(async(req,res)=>{
    try{
      let raw='';for await(const b of req)raw+=b;const payload=JSON.parse(raw);requests++;
      const emit=v=>res.write('data: '+JSON.stringify(v)+'\n\n');
      res.writeHead(200,{'Content-Type':'text/event-stream'});
      await handler({payload,requests,emit,state,failures});
      res.end('data: [DONE]\n\n');
    }catch(e){failures.push(String(e));res.destroy();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const env={...process.env,SACODE_USER_SETTINGS_DIR:join(dir,'settings'),SACODE_PROVIDER_BASE_URL:'http://127.0.0.1:'+server.address().port,SACODE_PROVIDER_MODEL:'plan-fixture',SACODE_PROVIDER_KEY:'fixture-only'};
  const bridge=new HostBridge(process.env.SACODE_HOST,env);
  await bridge.start(dir);
  await bridge.request('workspace/set-directory',{directory:project});
  try{ await body({bridge,dir,state,failures}); }
  finally{ const s=await bridge.stop();assert.equal(s.code,0,'宿主须干净退出');assert.equal(s.forced,false);server.closeAllConnections();await new Promise(r=>server.close(r)); }
  return {dir,requests,state};
}

// 轮询到「待审计划卡片出现」或「轮次结算」；返回最后一次 turn/poll 与 projection。
async function waitForPendingPlan(bridge, action) {
  let last=null;
  for(let i=0;i<600;i++){
    const result=await bridge.request('turn/poll');
    const view=await bridge.request('session/projection');
    last={result,view};
    const card=(view.planCards||[]).find(c=>c.status==='pending');
    if(card){ await action({result,view,card}); }
    if(result.settled)return last;
    await nap(10);
  }
  throw new Error('计划审阅未在轮询窗口内结算');
}

test('计划：批准退出并恢复原档（只读 plan），批准不授予写权限',{timeout:90000},async()=>{
  const {requests}=await withHost(async({payload,requests,emit})=>{
    if(requests===1){
      assert.ok(payload.tools.some(t=>t.function.name==='exit_plan_mode'),'计划模式应登记 exit_plan_mode');
      emit({choices:[{index:0,delta:{tool_calls:[{index:0,id:'plan-1',function:{name:'exit_plan_mode',arguments:JSON.stringify({plan:PLAN_MD})}}]}}]});
      emit({choices:[{index:0,delta:{},finish_reason:'tool_calls'}]});
    }else if(requests===2){
      const tool=payload.messages.find(m=>m.role==='tool'&&m.tool_call_id==='plan-1');assert.ok(tool);
      assert.deepEqual(JSON.parse(tool.content),{approved:true},'批准后工具结果须为 {approved:true}');
      // 批准后立刻尝试写：原档只读 plan，必须被权限拒绝（不是批准放行）。
      emit({choices:[{index:0,delta:{tool_calls:[{index:0,id:'w-1',function:{name:'write',arguments:JSON.stringify({path:'a.txt',content:'x'})}}]}}]});
      emit({choices:[{index:0,delta:{},finish_reason:'tool_calls'}]});
    }else{
      const tool=payload.messages.find(m=>m.role==='tool'&&m.tool_call_id==='w-1');assert.ok(tool);
      assert.ok(tool.content.includes('approval-mode-denied'),'写必须被权限拒绝，不能因批准计划而放行');
      emit({choices:[{index:0,delta:{content:'已按权限拒绝写入。'}}]});emit({choices:[{index:0,delta:{},finish_reason:'stop'}]});
    }
  }, async({bridge})=>{
    assert.equal((await bridge.request('approval/set-mode',{mode:'plan'})).ok,true);
    assert.equal((await bridge.request('plan/set-mode',{active:true})).active,true);
    assert.deepEqual(await bridge.request('plan/get-mode'),{ok:true,active:true});
    await assert.rejects(bridge.request('approval/set-mode',{mode:'yolo'}),/plan-mode-active/,'计划期间不得切换权限');
    await bridge.request('session/submit',{eventType:'user/message',data:'先出计划，批准后实施'});
    await bridge.request('task/start');
    let answered=false;
    const last=await waitForPendingPlan(bridge, async({view,card})=>{
      if(answered)return;
      assert.equal(view.planActive,true);
      await assert.rejects(bridge.request('plan/review-answer',{sessionId:'other',planId:card.id,decision:'approve',feedback:'',cancelled:false}),/plan-session-changed/,'错误会话被拒');
      await assert.rejects(bridge.request('plan/review-answer',{sessionId:'current',planId:card.id,decision:'bogus',feedback:'',cancelled:false}),/plan-invalid-decision/,'非法决定被拒');
      assert.equal((await bridge.request('plan/review-answer',{sessionId:'current',planId:card.id,decision:'approve',feedback:'',cancelled:false})).accepted,true);
      await assert.rejects(bridge.request('plan/review-answer',{sessionId:'current',planId:card.id,decision:'approve',feedback:'',cancelled:false}),/plan-already-settled/,'重复答复被拒');
      answered=true;
    });
    assert.equal(last.result.settled,true);
    const view=await bridge.request('session/projection');
    assert.equal(view.planActive,false,'批准后退出计划模式');
    assert.equal((await bridge.request('plan/get-mode')).active,false);
    assert.equal((await bridge.request('approval/get-mode')).mode,'plan','退出恢复原档 plan，不隐式升级');
    assert.equal(view.planCards[0].status,'approved');
  });
  assert.equal(requests,3);
});

test('计划：从 yolo 进入，批准后恢复 yolo（不回落 build）',{timeout:90000},async()=>{
  await withHost(async({payload,requests,emit})=>{
    if(requests===1){
      emit({choices:[{index:0,delta:{tool_calls:[{index:0,id:'plan-1',function:{name:'exit_plan_mode',arguments:JSON.stringify({plan:PLAN_MD})}}]}}]});
      emit({choices:[{index:0,delta:{},finish_reason:'tool_calls'}]});
    }else{
      emit({choices:[{index:0,delta:{content:'计划已批准。'}}]});emit({choices:[{index:0,delta:{},finish_reason:'stop'}]});
    }
  }, async({bridge})=>{
    assert.equal((await bridge.request('approval/set-mode',{mode:'yolo'})).ok,true);
    await bridge.request('plan/set-mode',{active:true});
    assert.equal((await bridge.request('approval/get-mode')).mode,'plan','进入压到只读');
    await bridge.request('session/submit',{eventType:'user/message',data:'出个计划'});
    await bridge.request('task/start');
    let answered=false;
    await waitForPendingPlan(bridge, async({card})=>{
      if(answered)return;
      assert.equal((await bridge.request('plan/review-answer',{sessionId:'current',planId:card.id,decision:'approve',feedback:'',cancelled:false})).accepted,true);
      answered=true;
    });
    assert.equal((await bridge.request('approval/get-mode')).mode,'yolo','退出恢复进入前的 yolo');
  });
});

test('计划：继续规划带反馈，留在计划模式（仍只读）',{timeout:90000},async()=>{
  const {state}=await withHost(async({payload,requests,emit,state})=>{
    if(requests===1){
      emit({choices:[{index:0,delta:{tool_calls:[{index:0,id:'plan-1',function:{name:'exit_plan_mode',arguments:JSON.stringify({plan:PLAN_MD})}}]}}]});
      emit({choices:[{index:0,delta:{},finish_reason:'tool_calls'}]});
    }else{
      const tool=payload.messages.find(m=>m.role==='tool'&&m.tool_call_id==='plan-1');assert.ok(tool);
      state.toolContent=tool.content;
      emit({choices:[{index:0,delta:{content:'收到反馈，继续完善计划。'}}]});emit({choices:[{index:0,delta:{},finish_reason:'stop'}]});
    }
  }, async({bridge})=>{
    await bridge.request('plan/set-mode',{active:true});
    await bridge.request('session/submit',{eventType:'user/message',data:'出个计划'});
    await bridge.request('task/start');
    let answered=false;
    const last=await waitForPendingPlan(bridge, async({card})=>{
      if(answered)return;
      assert.equal((await bridge.request('plan/review-answer',{sessionId:'current',planId:card.id,decision:'keep-planning',feedback:'再补充回滚',cancelled:false})).accepted,true);
      answered=true;
    });
    assert.equal(last.result.settled,true);
    assert.ok(String(state.toolContent).includes('plan-keep-planning'),'继续规划以失败工具结果返回模型');
    assert.ok(String(state.toolContent).includes('再补充回滚'),'反馈须随工具结果回到模型');
    const view=await bridge.request('session/projection');
    assert.equal(view.planActive,true,'继续规划后仍在计划模式');
    assert.equal((await bridge.request('approval/get-mode')).mode,'plan','计划模式期间仍只读');
    assert.equal(view.planCards[0].status,'kept-planning');
  });
});

test('计划：关闭（dismiss）取消本轮，仍留在计划模式',{timeout:90000},async()=>{
  await withHost(async({payload,requests,emit})=>{
    if(requests===1){
      emit({choices:[{index:0,delta:{tool_calls:[{index:0,id:'plan-1',function:{name:'exit_plan_mode',arguments:JSON.stringify({plan:PLAN_MD})}}]}}]});
      emit({choices:[{index:0,delta:{},finish_reason:'tool_calls'}]});
    }
    // 关闭后 Host 会取消本轮，模型不再被请求。
  }, async({bridge})=>{
    await bridge.request('plan/set-mode',{active:true});
    await bridge.request('session/submit',{eventType:'user/message',data:'出个计划'});
    await bridge.request('task/start');
    let answered=false;
    const last=await waitForPendingPlan(bridge, async({card})=>{
      if(answered)return;
      assert.equal((await bridge.request('plan/review-answer',{sessionId:'current',planId:card.id,decision:'dismiss',feedback:'',cancelled:true})).accepted,true);
      answered=true;
    });
    assert.equal(last.result.settled,true);
    assert.equal(last.result.cancelled,true,'关闭计划审阅取消本轮');
    const view=await bridge.request('session/projection');
    assert.equal(view.planActive,true,'关闭后仍在计划模式');
    assert.equal(view.planCards[0].status,'dismissed');
  });
});

test('计划：turn/cancel 取消在途审阅，仍留在计划模式',{timeout:90000},async()=>{
  await withHost(async({payload,requests,emit})=>{
    if(requests===1){
      emit({choices:[{index:0,delta:{tool_calls:[{index:0,id:'plan-1',function:{name:'exit_plan_mode',arguments:JSON.stringify({plan:PLAN_MD})}}]}}]});
      emit({choices:[{index:0,delta:{},finish_reason:'tool_calls'}]});
    }
  }, async({bridge})=>{
    await bridge.request('plan/set-mode',{active:true});
    await bridge.request('session/submit',{eventType:'user/message',data:'出个计划'});
    await bridge.request('task/start');
    let cancelled=false;
    const last=await waitForPendingPlan(bridge, async()=>{
      if(cancelled)return;
      await bridge.request('turn/cancel');cancelled=true;
    });
    assert.equal(last.result.settled,true);
    const view=await bridge.request('session/projection');
    assert.equal(view.planActive,true,'取消后仍在计划模式');
    assert.equal(view.planCards[0].status,'dismissed');
    // 待审身份已清：迟到答复被拒（无运行态承接，不能显示成可操作）。
    await assert.rejects(bridge.request('plan/review-answer',{sessionId:'current',planId:view.planCards[0].id,decision:'approve',feedback:'',cancelled:false}));
  });
});

test('计划：非法计划参数被拒，留计划模式',{timeout:90000},async()=>{
  const {state}=await withHost(async({payload,requests,emit,state})=>{
    if(requests===1){
      emit({choices:[{index:0,delta:{tool_calls:[{index:0,id:'plan-1',function:{name:'exit_plan_mode',arguments:JSON.stringify({plan:'没有 # 标题'})}}]}}]});
      emit({choices:[{index:0,delta:{},finish_reason:'tool_calls'}]});
    }else{
      const tool=payload.messages.find(m=>m.role==='tool'&&m.tool_call_id==='plan-1');assert.ok(tool);
      state.toolContent=tool.content;
      emit({choices:[{index:0,delta:{content:'计划格式无效，未呈交。'}}]});emit({choices:[{index:0,delta:{},finish_reason:'stop'}]});
    }
  }, async({bridge})=>{
    await bridge.request('plan/set-mode',{active:true});
    await bridge.request('session/submit',{eventType:'user/message',data:'出个计划'});
    await bridge.request('task/start');
    const last=await waitForPendingPlan(bridge, async()=>{});
    assert.equal(last.result.settled,true);
    assert.ok(String(state.toolContent).includes('plan-requires-heading'),'缺标题的计划必须被拒');
    const view=await bridge.request('session/projection');
    assert.equal((view.planCards||[]).length,0,'非法计划不产生可审阅卡片');
    assert.equal(view.planActive,true);
  });
});

test('计划：非计划模式调用 exit_plan_mode 被拒',{timeout:90000},async()=>{
  const {state}=await withHost(async({payload,requests,emit,state})=>{
    if(requests===1){
      emit({choices:[{index:0,delta:{tool_calls:[{index:0,id:'plan-1',function:{name:'exit_plan_mode',arguments:JSON.stringify({plan:PLAN_MD})}}]}}]});
      emit({choices:[{index:0,delta:{},finish_reason:'tool_calls'}]});
    }else{
      const tool=payload.messages.find(m=>m.role==='tool'&&m.tool_call_id==='plan-1');assert.ok(tool);
      state.toolContent=tool.content;
      emit({choices:[{index:0,delta:{content:'不在计划模式，未呈交。'}}]});emit({choices:[{index:0,delta:{},finish_reason:'stop'}]});
    }
  }, async({bridge})=>{
    // 未进入计划模式。
    await bridge.request('session/submit',{eventType:'user/message',data:'直接尝试出计划'});
    await bridge.request('task/start');
    const last=await waitForPendingPlan(bridge, async()=>{});
    assert.equal(last.result.settled,true);
    assert.ok(String(state.toolContent).includes('exit-plan-mode-inactive'),'非计划模式调用必须被拒');
    const view=await bridge.request('session/projection');
    assert.equal((view.planCards||[]).length,0);
    assert.equal(view.planActive,false);
  });
});

test('计划：批准必须先持久化，随后继续（原档 build），写按恢复后权限正常执行',{timeout:90000},async()=>{
  // 批准分支现在走 exitDurable：若持久检查点失败，approve 会抛 plan-approve-persistence-failed，
  // 本用例能通过即隐含「批准记录与权限恢复已落盘」；跨进程重开回放由 core 用例
  // planApproveDurablePersistsReviewAndRestoreAcrossReload 权威覆盖。
  const {state}=await withHost(async({payload,requests,emit,state})=>{
    if(requests===1){
      emit({choices:[{index:0,delta:{tool_calls:[{index:0,id:'plan-1',function:{name:'exit_plan_mode',arguments:JSON.stringify({plan:PLAN_MD})}}]}}]});
      emit({choices:[{index:0,delta:{},finish_reason:'tool_calls'}]});
    }else if(requests===2){
      const tool=payload.messages.find(m=>m.role==='tool'&&m.tool_call_id==='plan-1');assert.ok(tool);
      assert.deepEqual(JSON.parse(tool.content),{approved:true},'批准须成功返回（未经持久化不得返回）');
      // 原档 build：批准后写属恢复后的 build 语义正常放行，而非"批准新授予写权限"。
      emit({choices:[{index:0,delta:{tool_calls:[{index:0,id:'w-1',function:{name:'write',arguments:JSON.stringify({path:'a.txt',content:'from-plan'})}}]}}]});
      emit({choices:[{index:0,delta:{},finish_reason:'tool_calls'}]});
    }else{
      const tool=payload.messages.find(m=>m.role==='tool'&&m.tool_call_id==='w-1');assert.ok(tool);
      state.writeResult=tool.content;
      emit({choices:[{index:0,delta:{content:'已按计划实施。'}}]});emit({choices:[{index:0,delta:{},finish_reason:'stop'}]});
    }
  }, async({bridge})=>{
    assert.equal((await bridge.request('approval/set-mode',{mode:'build'})).ok,true);
    await bridge.request('plan/set-mode',{active:true});
    await bridge.request('session/submit',{eventType:'user/message',data:'出计划并实施'});
    await bridge.request('task/start');
    let answered=false;
    const last=await waitForPendingPlan(bridge, async({card})=>{
      if(answered)return;
      assert.equal((await bridge.request('plan/review-answer',{sessionId:'current',planId:card.id,decision:'approve',feedback:'',cancelled:false})).accepted,true);
      answered=true;
    });
    assert.equal(last.result.settled,true);
    const view=await bridge.request('session/projection');
    assert.equal(view.planActive,false,'批准后退出计划模式');
    assert.equal((await bridge.request('approval/get-mode')).mode,'build','恢复进入前档，不隐式升级');
    assert.equal(view.planCards[0].status,'approved');
    assert.ok(String(state.writeResult).includes('a.txt'),'build 语义下写正常执行');
  });
});
