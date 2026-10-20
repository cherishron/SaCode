// 真实 Host + 本地合成供应商：调用身份、运行态、拒绝/取消和重启回放。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const {HostBridge}=createRequire(import.meta.url)('../../../desktop/host-bridge.cjs');
const nap=ms=>new Promise(r=>setTimeout(r,ms));
const root=process.env.SACODE_TEST_ROOT||fileURLToPath(new URL('../../../../target/tmp/tool-projection-host',import.meta.url));
for(const mode of ['allowed','denied','cancelled','failed'])test('真实工具投影 '+mode,{timeout:60000},async()=>{
  const host=process.env.SACODE_HOST;assert.ok(host&&existsSync(host),'必须提供本轮构建的 SACODE_HOST');
  mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,mode+'-'));
  const project=join(dir,'project');mkdirSync(project);const target=join(project,'a.txt');writeFileSync(target,'old');
  const failures=[];let requests=0;
  const server=createServer(async(req,res)=>{
    try {
      let raw='';for await(const b of req)raw+=b;const body=JSON.parse(raw);requests++;
      res.writeHead(200,{'Content-Type':'text/event-stream'});
      const event=value=>res.write('data: '+JSON.stringify(value)+'\n\n');
      if(requests===1){
        const tool=(index,id,name,args)=>({index,id,function:{name,arguments:JSON.stringify(args)}});
        const calls=mode==='failed'?[tool(0,'read-1','read',{path:'missing.txt'})]:[tool(0,'read-1','read',{path:'a.txt'}),tool(1,'edit-1','edit',{path:'a.txt',old_string:'old',new_string:'new'})];
        event({choices:[{index:0,delta:{tool_calls:calls}}]});event({choices:[{index:0,delta:{},finish_reason:'tool_calls'}]});
      }else{
        assert.equal(requests,2,'请求必须有界');assert.ok(body.messages.some(m=>m.role==='tool'&&m.tool_call_id==='read-1'));
        event({choices:[{index:0,delta:{content:'任务结果已记录。'}}]});event({choices:[{index:0,delta:{},finish_reason:'stop'}]});
      }
      res.end('data: [DONE]\n\n');
    }catch(e){failures.push(String(e));res.destroy();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const env={...process.env,SACODE_USER_SETTINGS_DIR:join(dir,'settings'),SACODE_PROVIDER_BASE_URL:'http://127.0.0.1:'+server.address().port,SACODE_PROVIDER_MODEL:'projection-fixture',SACODE_PROVIDER_KEY:'fixture-only'};
  let bridge=new HostBridge(host,env);let stopped=false;
  try{
    await bridge.start(dir);await bridge.request('workspace/set-directory',{directory:project});
    await bridge.request('session/submit',{eventType:'user/message',data:'读取a.txt并把old精确替换成new'});
    await bridge.request('task/start');let result,answered=false,sawRunning=false;
    for(let i=0;i<600;i++){
      result=await bridge.request('turn/poll');
      const question=bridge.notifications.find(n=>n.method==='approval/asked'&&n.params?.source==='model');
      if(question&&!answered){
        const projection=await bridge.request('session/projection');
        const edit=projection.toolCalls.find(c=>c.callId==='edit-1');
        assert.equal(edit?.status,'running');assert.equal(edit.name,'edit');assert.equal(JSON.parse(edit.arguments).path,'a.txt');sawRunning=true;
        if(mode==='cancelled')await bridge.request('turn/cancel');
        else await bridge.request('approval/answer',{approvalId:question.params.approvalId,decision:mode==='denied'?'denied':'allowed-once'});
        answered=true;
      }
      if(result.settled)break;await nap(10);
    }
    assert.deepEqual(failures,[]);assert.equal(result.settled,true);
    const projection=await bridge.request('session/projection');
    const call=projection.toolCalls.find(c=>c.callId===(mode==='failed'?'read-1':'edit-1'));
    assert.equal(call.status,{allowed:'completed',denied:'denied',cancelled:'cancelled',failed:'failed'}[mode]);
    assert.ok(projection.messageRows.some(row=>row.id===call.resultMessageId));
    if(mode!=='failed')assert.equal(sawRunning,true);
    assert.equal(readFileSync(target,'utf8'),mode==='allowed'?'new':'old');
    const created=await bridge.request('session/create',{title:'隔离会话'});await bridge.request('session/select',{sessionId:created.id});
    assert.equal((await bridge.request('session/projection')).toolCalls.length,0);
    await bridge.request('session/select',{sessionId:'current'});
    const stop=await bridge.stop();stopped=true;assert.equal(stop.code,0);assert.equal(stop.forced,false);
    bridge=new HostBridge(host,env);await bridge.start(dir);stopped=false;
    assert.deepEqual((await bridge.request('session/projection')).toolCalls,projection.toolCalls);
    writeFileSync(join(dir,'result.json'),JSON.stringify({mode,sawRunning,requests,status:call.status,normalRestart:true},null,2));
  }finally{
    if(!stopped){const stop=await bridge.stop();assert.equal(stop.code,0);assert.equal(stop.forced,false);}
    server.closeAllConnections();await new Promise(r=>server.close(r));
  }
});
