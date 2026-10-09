import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,mkdirSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {HostBridge} from '../host-bridge.cjs';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(read,accept){
  const deadline=Date.now()+10000;
  while(Date.now()<deadline){const value=await read();if(accept(value))return value;await pause(20);}
  assert.fail('团队真实执行未在截止时间内收束');
}
async function withProvider(run,{tool=false}={}){
  const root=mkdtempSync(resolve(fileURLToPath(new URL('../../../target/',import.meta.url)),'sacode-team-provider-'));
  const settings=join(root,'settings');mkdirSync(settings);
  const requests=[];
  // 测试 HTTP 端点只验证真实 SSE 传输；生产服务不得引用这个夹具。
  const server=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw);requests.push(body);
    const prior=body.messages.filter(m=>m.role==='tool').length;
    const call=tool&&prior<2;
    const name=prior===0?'team_task_claim':'team_task_complete';
    const args=prior===0?{taskId:'task-1'}:{taskId:'task-1',result:'显式工具完成'};
    const delta=call?{tool_calls:[{index:0,id:`call-${prior}`,type:'function',function:{name,arguments:JSON.stringify(args)}}]}:{content:'只是正文，不是完成证据'};
    res.writeHead(200,{'content-type':'text/event-stream'});
    res.end('data: '+JSON.stringify({choices:[{index:0,delta,finish_reason:call?'tool_calls':'stop'}]})+'\n\n'+'data: [DONE]\n\n');
  });
  const bridge=new HostBridge(resolve(process.env.SACODE_HOST||fileURLToPath(new URL('../dist/host/bin/sacode-host.exe',import.meta.url))),{
    ...process.env,SACODE_USER_SETTINGS_DIR:settings,SACODE_PROVIDER_MODEL:'team-fixture',SACODE_PROVIDER_KEY:'test-only-key',
  });
  try{
    server.listen(0,'127.0.0.1');await once(server,'listening');
    bridge.env.SACODE_PROVIDER_BASE_URL=`http://127.0.0.1:${server.address().port}`;
    await bridge.start(root);await run({bridge,root,requests});
  }finally{await bridge.stop();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));rmSync(root,{recursive:true,force:true});}
}

test('成员消息进入真实Provider与独立持久日志，正文结束不能自动完成任务',{timeout:20000},async()=>{
  await withProvider(async({bridge,root,requests})=>{
    const teamSessionId='current';
    const member=await bridge.request('team/member/create',{teamSessionId,name:'真实成员',role:'worker'});
    const task=await bridge.request('team/task/create',{teamSessionId,title:'不得凭正文完成',dependencies:[]});
    await bridge.request('team/task/assign',{teamSessionId,taskId:task.taskId,memberId:member.memberId});
    await until(()=>bridge.request('team/describe',{teamSessionId}),view=>requests.length>0&&view.members.some(m=>m.id===member.memberId&&m.status==='idle'));
    let view=await bridge.request('team/describe',{teamSessionId});
    assert.notEqual(view.tasks.find(t=>t.id===task.taskId).status,'completed');
    const before=requests.length;
    const sent=await bridge.request('team/message/send',{teamSessionId,target:member.memberId,text:'唯一团队消息-42'});
    await until(()=>bridge.request('team/describe',{teamSessionId}),view=>view.messages.some(m=>m.id===sent.messageId&&m.delivered)&&view.members.some(m=>m.id===member.memberId&&m.status==='idle'));
    assert.ok(requests.length>before,'空闲成员必须重新发起真实请求');
    assert.ok(requests.at(-1).messages.some(m=>m.role==='user'&&m.content.includes('唯一团队消息-42')));
    assert.ok(requests.at(-1).messages.some(m=>m.role==='system'&&m.content.includes('team_task_claim')));
    assert.ok(requests.at(-1).tools.some(t=>t.function.name==='team_task_complete'));
    await assert.rejects(bridge.request('team/describe',{teamSessionId:'../逃逸'}));
    await assert.rejects(bridge.request('team/task/complete',{teamSessionId,taskId:task.taskId,result:'领导不能代交'}));
    const persisted=readFileSync(join(root,member.sessionId,'session.log'),'utf8');
    assert.ok(persisted.includes('唯一团队消息-42'));assert.ok(persisted.includes('assistant/message'));
    const leaderPath=join(root,'session.log');
    const leaderLog=existsSync(leaderPath)?readFileSync(leaderPath,'utf8'):'';
    assert.ok(!leaderLog.includes('只是正文，不是完成证据'),'成员不能混写leader日志');
    await assert.rejects(bridge.request('team/task/complete',{teamSessionId,taskId:task.taskId,result:'伪造成员',actorSessionId:member.sessionId}),/team-bad-args/);
  });
});

test('成员认领和完成工具必须等精确人工审批，不默认allowed',{timeout:25000},async()=>{
  await withProvider(async({bridge})=>{
    const teamSessionId='current';
    const member=await bridge.request('team/member/create',{teamSessionId,name:'需审批成员',role:'worker'});
    const task=await bridge.request('team/task/create',{teamSessionId,title:'工具完成',dependencies:[]});
    assert.equal(task.taskId,'task-1');
    await bridge.request('team/task/assign',{teamSessionId,taskId:task.taskId,memberId:member.memberId});
    for(const tool of ['team_task_claim','team_task_complete']){
      const notice=await until(async()=>{await bridge.request('team/describe',{teamSessionId});return bridge.notifications.find(n=>n.method==='approval/asked'&&n.params.tool===tool);},Boolean);
      assert.equal(notice.params.memberId,member.memberId);
      const pending=await bridge.request('team/describe',{teamSessionId});
      assert.notEqual(pending.tasks[0].status,'completed');
      await bridge.request('team/approval/answer',{teamSessionId,memberId:member.memberId,approvalId:notice.params.approvalId,decision:'allowed-once'});
    }
    const done=await until(()=>bridge.request('team/describe',{teamSessionId}),v=>v.tasks[0].status==='completed');
    assert.equal(done.tasks[0].result,'显式工具完成');
  },{tool:true});
});

 test('真实宿主团队创建、成员会话、任务持久恢复，不用本地模拟状态',async()=>{
  const root=mkdtempSync(resolve(fileURLToPath(new URL('../../../target/',import.meta.url)),'sacode-team-host-'));
  const host=resolve(process.env.SACODE_HOST||fileURLToPath(new URL('../dist/host/bin/sacode-host.exe',import.meta.url)));
  const bridge=new HostBridge(host);
  try {
    await bridge.start(root);
    const initial=await bridge.request('team/describe',{teamSessionId:'current'});
    assert.ok(Array.isArray(initial.members));
    const added=await bridge.request('team/member/create',{teamSessionId:'current',name:'成员甲',role:'worker'});
    assert.ok(added.memberId);assert.match(added.sessionId,/^sessions\/session-/);
    const task=await bridge.request('team/task/create',{teamSessionId:'current',title:'验证任务',dependencies:[]});
    assert.ok(task.taskId);
    const view=await bridge.request('team/describe',{teamSessionId:'current'});
    assert.ok(view.members.some(member=>member.id===added.memberId&&member.sessionId===added.sessionId));
    assert.ok(view.tasks.some(item=>item.id===task.taskId&&item.status==='pending'));
    await bridge.stop();await bridge.start(root);
    const restored=await bridge.request('team/describe',{teamSessionId:'current'});
    assert.ok(restored.tasks.some(item=>item.id===task.taskId&&item.title==='验证任务'));
  }finally{await bridge.stop();rmSync(root,{recursive:true,force:true});}
});
