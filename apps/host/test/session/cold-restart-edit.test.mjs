// 同一候选、同一会话目录，两个真实Host进程：获批编辑后正常关闭，再只读冷启动回放。
// 本地合成模型仅给出工具调用；read/edit、审批、日志持久化与回放由实际Host执行。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join,dirname,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {setTimeout as pause} from 'node:timers/promises';

const require=createRequire(import.meta.url);
const {HostBridge}=require('../../../desktop/host-bridge.cjs');
const approval=require('../../../desktop/renderer/model-approval.js');
const repo=fileURLToPath(new URL('../../../../',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const host=process.env.SACODE_HOST;

test('候选Host真实编辑→正常退出→新进程同目录只读回放，消息/权限/文件持久且不重放',{
  timeout:60000,
  skip:!host&&'必须显式提供候选包内SACODE_HOST，不默认使用工作区dist',
},async()=>{
  assert.ok(isAbsolute(host),'Host路径须为绝对路径');
  const prefix=process.env.COLD_EVIDENCE_PREFIX||join(repo,'target/tmp/cold-restart-edit/run-');
  mkdirSync(dirname(prefix),{recursive:true});
  const evidence=mkdtempSync(prefix),session=join(evidence,'session'),project=join(evidence,'project');
  mkdirSync(session);mkdirSync(project);
  const settings=join(evidence,'settings');
  const original='module.exports = (a, b) => a - b;\n';
  const edited=original.replace('a - b','a + b');
  const testSource="const assert = require('node:assert/strict');\nconst sum = require('./sum.cjs');\nassert.equal(sum(2, 3), 5);\nassert.equal(sum(-1, 1), 0);\n";
  writeFileSync(join(project,'sum.cjs'),original);writeFileSync(join(project,'sum.test.cjs'),testSource);
  const testProject=()=>{
    const result=spawnSync(process.execPath,['sum.test.cjs'],{cwd:project,encoding:'utf8',timeout:5000});
    assert.ifError(result.error);assert.equal(result.signal,null);
    return {exitCode:result.status,executor:'external-managed-node',testSha256:sha(readFileSync(join(project,'sum.test.cjs')))};
  };
  const summary={version:1,host:resolve(host),hostSha256:sha(readFileSync(host)),managedNode:process.execPath,
    modelSource:'local-synthetic-http',coldRestartVerified:false,readOnlyReplayVerified:false,
    first:null,second:null,beforeTest:testProject(),failure:null};
  writeFileSync(join(evidence,'result.json'),JSON.stringify(summary,null,2));
  console.log('COLD_RESTART_EVIDENCE='+evidence);
  assert.equal(summary.beforeTest.exitCode,1,'修改前测试应失败');
  let requests=0,serverFailure=false,bridge;
  const server=createServer(async(req,res)=>{
    try{
      let body='';for await(const bytes of req)body+=bytes;JSON.parse(body);
      const step=++requests;assert.ok(step<=3,'重开不得再次请求模型');
      res.writeHead(200,{'Content-Type':'text/event-stream'});
      const tool=step===1?'read':'edit';
      const args=step===1?{path:'sum.cjs'}:{path:'sum.cjs',old_string:'a - b',new_string:'a + b'};
      const delta=step<3?{tool_calls:[{index:0,id:'cold-'+step,type:'function',function:{name:tool,arguments:JSON.stringify(args)}}]}:{content:'已读取文件，经一次审批将减法改为加法。'};
      res.end('data: '+JSON.stringify({choices:[{index:0,delta}]})+'\n\ndata: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:step<3?'tool_calls':'stop'}],usage:{total_tokens:3}})+'\n\ndata: [DONE]\n\n');
    }catch{serverFailure=true;if(!res.headersSent)res.writeHead(500);res.end('{"error":"synthetic-fixture-failed"}');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  // 不继承真实供应商密钥；宿主依赖必须来自该候选相邻DLL，不借SDK PATH。
  const environment={};
  for(const [key,value]of Object.entries(process.env))if(['systemroot','windir','localappdata','userprofile','home'].includes(key.toLowerCase()))environment[key]=value;
  Object.assign(environment,{PATH:join(process.env.SystemRoot||process.env.SYSTEMROOT,'System32'),TEMP:evidence,TMP:evidence,
    SACODE_USER_SETTINGS_DIR:settings,SACODE_PROVIDER_KEY:'invalid-local-cold-restart-fixture',
    SACODE_PROVIDER_MODEL:'cold-restart-synthetic',SACODE_PROVIDER_BASE_URL:`http://127.0.0.1:${server.address().port}/v1/chat/completions`});
  const secondRequests=[];
  const readonly=new Set(['initialize','session/projection','session/subscribe','session/request-trace','workspace/get','approval/get-mode']);
  const capture=async(request)=>{
    const projection=await request('session/projection');
    const mode=await request('approval/get-mode');
    const workspace=await request('workspace/get');
    const trace=await request('session/request-trace',{sessionId:'current',beforeSeq:-1,limit:50});
    const events=[];let cursor=0;
    for(let page=0;page<100;page++){
      const result=await request('session/subscribe',{sessionId:'current',cursor,limit:7});
      assert.equal(result.sessionId,'current');events.push(...result.events);
      if(!result.more)break;
      assert.ok(result.nextCursor>cursor,'分页游标必须前进');cursor=result.nextCursor;
      assert.ok(page<99,'分页不得无限循环');
    }
    return {projection,mode,workspace,trace,events};
  };
  try{
    bridge=new HostBridge(host,environment);await bridge.start(session);
    const firstProc=bridge.proc,firstPid=firstProc.pid;
    await bridge.request('initialize');
    await bridge.request('workspace/set-directory',{sessionId:'current',directory:project});
    // 先实际切到非默认保守模式，运行时回build接受逐次审批，最终再保存plan。
    assert.equal((await bridge.request('approval/set-mode',{mode:'plan'})).ok,true);
    assert.equal((await bridge.request('approval/get-mode')).mode,'plan');
    assert.equal((await bridge.request('approval/set-mode',{mode:'build'})).ok,true);
    const task='冷启动持久性验收：先read读取sum.cjs，再edit一次，将a - b改为a + b；不要修改测试文件，不运行命令。审批后简短总结。';
    const marker='持久化核对：中文、"引号"、反斜杠\\与换行\n第二行';
    await bridge.request('session/append',{eventType:'user/message',data:task});
    const turnRequestId=String(bridge.nextId);
    const started=await bridge.request('task/start');assert.equal(started.started,true);
    let answered=false,settled;
    const deadline=Date.now()+20000;
    while(Date.now()<deadline){
      const poll=await bridge.request('turn/poll');
      const proposal=approval.selectProposal(approval.takeRequests(bridge,turnRequestId),'current',poll.running,turnRequestId);
      if(proposal){
        assert.equal(answered,false,'只允许一次编辑审批');assert.equal(proposal.name,'edit');
        assert.deepEqual(JSON.parse(proposal.argumentsJson),{path:'sum.cjs',old_string:'a - b',new_string:'a + b'});
        const answer=await bridge.request('approval/answer',{approvalId:proposal.approvalId,decision:'allowed-once'});
        assert.equal(answer.accepted,true);answered=true;
      }
      if(poll.settled){settled=poll;break;}await pause(20);
    }
    assert.ok(settled,'真实任务未按期结算');assert.equal(answered,true);
    assert.equal(settled.cancelled,false);assert.equal(settled.interrupted,false);assert.equal(settled.finishReason,'stop');assert.equal(settled.pendingToolCalls,0);
    assert.equal(readFileSync(join(project,'sum.cjs'),'utf8'),edited);
    summary.afterEditTest=testProject();assert.equal(summary.afterEditTest.exitCode,0);
    assert.equal(readFileSync(join(project,'sum.test.cjs'),'utf8'),testSource);
    assert.equal((await bridge.request('approval/set-mode',{mode:'plan'})).ok,true);
    await bridge.request('session/append',{eventType:'user/message',data:marker});
    const before=await capture((method,args={})=>bridge.request(method,args));
    assert.equal(before.mode.mode,'plan');assert.equal(before.projection.pending,0);
    assert.equal(before.projection.durable,before.projection.events);
    assert.ok(before.projection.messages.some(text=>text==='user/message: '+marker));
    assert.ok(before.projection.messages.some(text=>text.includes('已读取文件，经一次审批将减法改为加法。')));
    assert.ok(before.trace.requests?.length>=3,'必须有真实请求追踪回放');
    const logPath=join(session,'session.log');assert.ok(existsSync(logPath));
    const beforeLog=readFileSync(logPath);
    assert.match(beforeLog.toString(),/\ttool\/runtime\/result\tok-read:/);
    assert.match(beforeLog.toString(),/\ttool\/runtime\/result\tok-edit:/);
    writeFileSync(join(evidence,'rpc-before-close.json'),JSON.stringify(before,null,2));
    const exit1=await bridge.stop();assert.deepEqual(exit1,{code:0,signal:null,forced:false});
    assert.equal(firstProc.exitCode,0,'旧进程必须实际退出');assert.equal(bridge.pending.size,0);
    const afterCloseLog=readFileSync(logPath);
    assert.equal(afterCloseLog.equals(beforeLog),true,'正常关闭不应改变已结算日志');
    summary.first={pid:firstPid,exit:exit1,eventCount:before.projection.events,messageCount:before.projection.messages.length,
      durableCount:before.projection.durable,mode:before.mode.mode,logSha256:sha(afterCloseLog),logBytes:afterCloseLog.length,requests};
    const requestsBeforeRestart=requests;
    // 新桥、新进程，同一会话目录；不发送append/load/select/mode写入或task/start。
    const fresh=new HostBridge(host,environment);bridge=fresh;await fresh.start(session);
    const secondPid=fresh.proc.pid;assert.notEqual(fresh.proc,firstProc);assert.notEqual(secondPid,firstPid,'须确实启动另一Host进程');
    const read=async(method,args={})=>{assert.ok(readonly.has(method),'冷启动阶段仅允许只读RPC');secondRequests.push(method);return fresh.request(method,args);};
    await read('initialize');
    const after=await capture(read);
    writeFileSync(join(evidence,'rpc-after-restart.json'),JSON.stringify(after,null,2));
    assert.deepEqual(after.projection,before.projection,'新进程回放消息正文、计数和投影须逐项相同');
    assert.deepEqual(after.events,before.events,'分页回放事件序号与类型须相同');
    assert.equal(after.events.length,after.projection.events,'核对全部事件而不是截尾64条');
    assert.deepEqual(after.mode,before.mode,'非默认plan模式须持久恢复');
    assert.deepEqual(after.workspace,before.workspace,'工作区绑定须持久恢复');
    assert.deepEqual(after.trace,before.trace,'请求追踪内容须由新进程回放一致');
    assert.equal(readFileSync(join(project,'sum.cjs'),'utf8'),edited);
    summary.afterRestartTest=testProject();assert.equal(summary.afterRestartTest.exitCode,0);
    assert.equal(readFileSync(join(project,'sum.test.cjs'),'utf8'),testSource);
    await pause(150);assert.equal(requests,requestsBeforeRestart,'只读重开不得重新请求模型或执行编辑');
    assert.equal(readFileSync(logPath).equals(afterCloseLog),true,'只读回放不得追加/篡改会话事实');
    assert.equal(serverFailure,false);
    const exit2=await fresh.stop();assert.deepEqual(exit2,{code:0,signal:null,forced:false});
    assert.equal(readFileSync(logPath).equals(afterCloseLog),true,'只读Host关闭后日志字节仍须相同');
    summary.second={pid:secondPid,exit:exit2,eventCount:after.projection.events,messageCount:after.projection.messages.length,
      mode:after.mode.mode,logSha256:sha(readFileSync(logPath)),readOnlyMethods:secondRequests,requests};
    summary.coldRestartVerified=true;summary.readOnlyReplayVerified=true;
    summary.scope='packaged-R2-host; local-synthetic-model; actual-edit; external-node-tests; actual-process-restart; no-GUI';
    writeFileSync(join(evidence,'result.json'),JSON.stringify(summary,null,2));
    console.log('COLD_RESTART_PASS '+JSON.stringify(summary));
  }catch(error){
    summary.failure={name:error.name,code:error.code||null,category:'cold-restart-assertion-or-protocol-failed'};
    writeFileSync(join(evidence,'result.json'),JSON.stringify(summary,null,2));
    throw error;
  }finally{
    try{if(bridge)await bridge.stop();}
    finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  }
});
