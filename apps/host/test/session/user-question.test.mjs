import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const {HostBridge}=createRequire(import.meta.url)('../../../desktop/host-bridge.cjs');
const nap=ms=>new Promise(r=>setTimeout(r,ms));
for(const kind of ['single','multi','confirm','input','custom','cancelled','invalid'])test('真实Host结构化提问 '+kind,{timeout:30000},async()=>{
  assert.ok(process.env.SACODE_HOST&&existsSync(process.env.SACODE_HOST),'需要本轮Host');
  const root=process.env.SACODE_TEST_ROOT||fileURLToPath(new URL('../../../../target/tmp/user-question-host',import.meta.url));
  mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,kind+'-')),project=join(dir,'project');mkdirSync(project);writeFileSync(join(project,'a.txt'),'original-task-payload');
  const type=kind==='custom'||kind==='cancelled'?'single':kind;
  const question={id:'q',question:'请选择后继续读取原任务文件',type,allowCustom:kind==='custom',options:[{id:'a',label:'甲'},{id:'b',label:'乙'}]};
  const answers=[{id:'q',selectedIds:kind==='multi'?['a','b']:kind==='confirm'?['no']:kind==='input'||kind==='custom'?[]:['a'],text:kind==='input'||kind==='custom'?'用户自定义::正文\n下一行':''}];
  const failures=[];let requests=0,continued=false;
  const server=createServer(async(req,res)=>{
    try{
      let raw='';for await(const b of req)raw+=b;const body=JSON.parse(raw);requests++;
      const emit=value=>res.write('data: '+JSON.stringify(value)+'\n\n');
      res.writeHead(200,{'Content-Type':'text/event-stream'});
      if(requests===1){
        assert.ok(body.tools.some(t=>t.function.name==='ask_user_question'));
        emit({choices:[{index:0,delta:{tool_calls:[{index:0,id:'ask-1',function:{name:'ask_user_question',arguments:JSON.stringify({questions:[question]})}}]}}]});
        emit({choices:[{index:0,delta:{},finish_reason:'tool_calls'}]});
      }else if(requests===2){
        const tool=body.messages.find(m=>m.role==='tool'&&m.tool_call_id==='ask-1');assert.ok(tool);
        if(kind==='invalid'){
          assert.ok(JSON.parse(tool.content).error);emit({choices:[{index:0,delta:{content:'提问格式无效，任务未伪报成功。'},finish_reason:'stop'}]});
        }else{
          assert.deepEqual(JSON.parse(tool.content).answers,answers);continued=true;
          emit({choices:[{index:0,delta:{tool_calls:[{index:0,id:'read-1',function:{name:'read',arguments:'{"path":"a.txt"}'}}]}}]});
          emit({choices:[{index:0,delta:{},finish_reason:'tool_calls'}]});
        }
      }else{
        assert.equal(requests,3,'任务继续不得无限重试');
        assert.ok(body.messages.some(m=>m.role==='tool'&&m.tool_call_id==='read-1'&&m.content.includes('original-task-payload')));
        emit({choices:[{index:0,delta:{content:'已按回答继续原任务并读取文件。'}}]});emit({choices:[{index:0,delta:{},finish_reason:'stop'}]});
      }
      res.end('data: [DONE]\n\n');
    }catch(e){failures.push(String(e));res.destroy();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const env={...process.env,SACODE_USER_SETTINGS_DIR:join(dir,'settings'),SACODE_PROVIDER_BASE_URL:'http://127.0.0.1:'+server.address().port,SACODE_PROVIDER_MODEL:'question-fixture',SACODE_PROVIDER_KEY:'fixture-only'};
  let bridge=new HostBridge(process.env.SACODE_HOST,env),stopped=false;
  try{
    await bridge.start(dir);await bridge.request('workspace/set-directory',{directory:project});
    await bridge.request('session/submit',{eventType:'user/message',data:'先让我选择，再读取a.txt继续当前任务'});await bridge.request('task/start');
    let result,answered=false,card;
    for(let i=0;i<600;i++){
      result=await bridge.request('turn/poll');const view=await bridge.request('session/projection');
      card=view.questionCards.find(c=>c.status==='pending');
      if(card&&!answered){
        // 两个 RPC 各有快照边界；卡片可能在上次 poll 后、projection 前刚刚发布。
        if(result.questionId!==card.id)result=await bridge.request('turn/poll');
        assert.equal(result.questionId,card.id);assert.equal(card.sessionId,'current');
        await assert.rejects(bridge.request('user-question/answer',{sessionId:'other',questionId:card.id,answers,cancelled:false}),/question-session-changed/);
        await assert.rejects(bridge.request('user-question/answer',{sessionId:'current',questionId:card.id,answers:[{id:'forged',selectedIds:['a'],text:''}],cancelled:false}));
        const reply={sessionId:'current',questionId:card.id,answers:kind==='cancelled'?[]:answers,cancelled:kind==='cancelled'};
        assert.equal((await bridge.request('user-question/answer',reply)).accepted,true);
        await assert.rejects(bridge.request('user-question/answer',reply),/question-already-settled/);answered=true;
      }
      if(result.settled)break;await nap(10);
    }
    assert.deepEqual(failures,[]);assert.equal(result.settled,true);
    const view=await bridge.request('session/projection');
    if(kind==='invalid'){assert.equal(view.questionCards.length,0);assert.equal(view.toolCalls.find(c=>c.callId==='ask-1').status,'failed');}
    else {assert.equal(answered,true);assert.equal(view.questionCards[0].status,kind==='cancelled'?'cancelled':'answered');}
    if(kind==='cancelled'){assert.equal(result.cancelled,true);assert.equal(requests,1);}else if(kind!=='invalid'){assert.equal(continued,true);assert.equal(requests,3);}
    assert.equal(readFileSync(join(dir,'session.log'),'utf8').split('\tturn/start\t').length-1,1,'回答继续原轮，不能另起会话或任务');
    const before=view.questionCards;let stop=await bridge.stop();stopped=true;assert.equal(stop.code,0);assert.equal(stop.forced,false);
    bridge=new HostBridge(process.env.SACODE_HOST,env);await bridge.start(dir);stopped=false;
    assert.deepEqual((await bridge.request('session/projection')).questionCards,before);
    writeFileSync(join(dir,'question-result.json'),JSON.stringify({kind,answered,continued,requests,normalRestart:true},null,2));
  }finally{
    if(!stopped){const stop=await bridge.stop();assert.equal(stop.code,0);assert.equal(stop.forced,false);}
    server.closeAllConnections();await new Promise(r=>server.close(r));
  }
});
