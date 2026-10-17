import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
const {HostBridge}=createRequire(import.meta.url)('../host-bridge.cjs');
const host=process.env.SACODE_HOST||resolve('dist/host/bin/sacode-host.exe');
test('繁忙发送偏好跨 Host 重启恢复，外观写入不覆盖偏好',{timeout:15000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'sacode-busy-pref-')),env={...process.env,SACODE_USER_SETTINGS_DIR:join(dir,'settings'),SACODE_PROVIDER_BASE_URL:''};
  let a=new HostBridge(host,env),b=new HostBridge(host,env);await a.start(dir);await b.start(dir);
  try{
    assert.equal((await a.request('global/appearance/get')).busySend,'queue');
    assert.equal((await a.request('global/appearance/set-busy-send',{busySend:'steer'})).saved,true);
    await b.request('global/appearance/set-font-size',{fontSize:18});
    await b.request('global/appearance/set-theme',{theme:'dark'});
    await a.stop();a=new HostBridge(host,env);await a.start(dir);
    assert.deepEqual(await a.request('global/appearance/get'),{theme:'dark',fontSize:18,busySend:'steer',scope:'user'});
    const before=readFileSync(join(dir,'settings/user-settings.log'),'utf8');
    for(const busySend of ['invalid',null,1,true])await assert.rejects(()=>a.request('global/appearance/set-busy-send',{busySend}),/bad-global-appearance-params/);
    assert.equal(readFileSync(join(dir,'settings/user-settings.log'),'utf8'),before);
    // 即使偏好插话，空闲时仍排入下一轮。
    await a.request('queue/enqueue',{text:'空闲提交',rpcId:'idle',accelerated:true});
    const view=await a.request('queue/describe');assert.equal(view.nextTurn.length,1);assert.equal(view.nextStep.length,0);
  }finally{await a.stop();await b.stop();}
});

for(const preferred of ['queue','steer'])test('真实运行边界送达与互补按键：'+preferred,{timeout:20000},async t=>{
  let firstReady,release;const ready=new Promise(r=>firstReady=r),requests=[],failures=[];
  const server=createServer(async(req,res)=>{
    try{
      let raw='';for await(const bytes of req)raw+=bytes;
      const body=JSON.parse(raw);requests.push(body);res.writeHead(200,{'Content-Type':'text/event-stream'});
      const event=value=>res.write('data: '+JSON.stringify(value)+'\n\n');
      if(requests.length===1){
        release=()=>{if(res.writableEnded)return;event({choices:[{index:0,delta:{tool_calls:[{index:0,id:'busy-todo',function:{name:'todo_write',arguments:JSON.stringify({todos:[{content:'边界任务',status:'in_progress'}]})}}]}}]});event({choices:[{index:0,delta:{},finish_reason:'tool_calls'}]});res.end('data: [DONE]\n\n');};firstReady();
      }else{event({choices:[{index:0,delta:{content:'已收到插话'}}]});event({choices:[{index:0,delta:{},finish_reason:'stop'}]});res.end('data: [DONE]\n\n');}
    }catch(e){failures.push(e.message);res.destroy();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
  const dir=mkdtempSync(join(tmpdir(),'sacode-busy-delivery-'));
  const bridge=new HostBridge(host,{...process.env,SACODE_USER_SETTINGS_DIR:join(dir,'settings'),SACODE_PROVIDER_BASE_URL:`http://127.0.0.1:${server.address().port}`,SACODE_PROVIDER_MODEL:'busy-fixture',SACODE_PROVIDER_KEY:'fixture-only'});
  await bridge.start(dir);
  try{
    await bridge.request('global/appearance/set-busy-send',{busySend:preferred});
    const uploaded=await bridge.request('attachment/upload',{kind:'file',name:'busy.txt',mediaType:'text/plain',data:Buffer.from('保留这份约束').toString('base64')});
    await bridge.request('session/submit',{eventType:'user/message',data:'请建立计划'});await bridge.request('turn/start');
    await Promise.race([ready,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('首请求未开始')),8000);timer.unref();})]);
    await assert.rejects(()=>bridge.request('queue/enqueue',{text:'非法按键值',rpcId:'bad',accelerated:'true'}),/bad-send-policy/);
    await bridge.request('queue/enqueue',{text:'普通发送',rpcId:'normal'});
    await bridge.request('queue/enqueue',{text:'修饰键发送',rpcId:'accelerated',accelerated:true});
    await bridge.request('queue/enqueue',{text:'带文件的插话',rpcId:'attached-step',receiptIds:[uploaded.receiptId],accelerated:preferred==='queue'});
    const view=await bridge.request('queue/describe');assert.equal(view.nextTurn.length,1);assert.equal(view.nextStep.length,2);
    const stepText=preferred==='steer'?'普通发送':'修饰键发送',queueText=preferred==='queue'?'普通发送':'修饰键发送';
    assert.equal(view.nextStep[0].text,stepText);assert.equal(view.nextTurn[0].text,queueText);
    release();let state;
    for(let i=0;i<300;i++){state=await bridge.request('turn/poll');if(state.settled)break;await new Promise(r=>setTimeout(r,10));}
    assert.equal(state.settled,true);assert.deepEqual(failures,[]);assert.equal(requests.length,2);
    assert.ok(requests[1].messages.some(m=>m.role==='user'&&m.content===stepText));
    assert.ok(!requests[1].messages.some(m=>m.role==='user'&&m.content===queueText));
    const after=await bridge.request('queue/describe');assert.equal(after.nextStep.length,0);assert.equal(after.nextTurn.length,1);
    const projection=await bridge.request('session/projection');
    assert.ok(projection.messageRows.some(row=>row.attachments.some(ref=>ref.name==='busy.txt')),'插话送达后附件必须进入消息投影');
  }finally{release?.();await bridge.stop();}
});
