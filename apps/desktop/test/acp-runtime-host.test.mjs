import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const {HostBridge}=createRequire(import.meta.url)('../host-bridge.cjs');

test('真实Host声明五个ACP动作，未装配时明确拒绝而非空成功',{timeout:30000},async t=>{
  assert.ok(process.env.SACODE_HOST,'需要本批源码构建的Host');
  const root=mkdtempSync(join(tmpdir(),'sacode-acp-rpc-'));
  const bridge=new HostBridge(process.env.SACODE_HOST,{...process.env,SACODE_USER_SETTINGS_DIR:join(root,'settings')});
  await bridge.start(root);t.after(()=>bridge.stop());
  const hello=await bridge.request('initialize',{});
  const actions={
    create:{sessionId:'current',taskId:'task',requestId:'request',peerId:'opencode',taskText:'must not execute'},
    poll:{sessionId:'current',delegationId:'d1'},
    answer:{sessionId:'current',delegationId:'d1',approvalId:1,decision:'denied',optionId:'deny'},
    cancel:{sessionId:'current',delegationId:'d1',revision:1},
    close:{sessionId:'current',delegationId:'d1',revision:1},
  };
  for(const [action,args] of Object.entries(actions)){
    const method='acp/delegation/'+action;
    assert.ok(hello.capabilities.includes(method),method);
    await assert.rejects(bridge.request(method,args),action==='create'?/provider-unavailable:acp-disabled/:/provider-unavailable:acp-runtime-not-attached/);
    await assert.rejects(bridge.request(method,{...args,sessionId:'foreign'}),/not-authorized:acp-session-changed/);
  }
  await bridge.stop();
  const log=existsSync(join(root,'session.log'))?readFileSync(join(root,'session.log'),'utf8'):'';
  assert.equal(log.includes('acp/task/start'),false);assert.equal(log.includes('acp/admission'),false);
});

test('ACP开关真实落盘并CAS，重启只恢复配置不启动任务',{timeout:30000},async t=>{
  assert.ok(process.env.SACODE_HOST);
  const root=mkdtempSync(join(tmpdir(),'sacode-acp-settings-'));
  const env={...process.env,SACODE_USER_SETTINGS_DIR:join(root,'settings')};
  const bridge=new HostBridge(process.env.SACODE_HOST,env);await bridge.start(root);t.after(()=>bridge.stop());
  const initial=await bridge.request('acp/settings/describe',{sessionId:'current'});
  assert.equal(initial.enabled,false);assert.equal(initial.revision,0);
  const enabled=await bridge.request('acp/settings/set-enabled',{sessionId:'current',enabled:true,revision:0});
  assert.equal(enabled.enabled,true);assert.equal(enabled.revision,1);
  await assert.rejects(bridge.request('acp/settings/set-enabled',{sessionId:'current',enabled:false,revision:0}),/revision-conflict/);
  await bridge.request('acp/settings/set-enabled',{sessionId:'current',enabled:false,revision:1});
  await bridge.stop();await bridge.start(root);
  const restored=await bridge.request('acp/settings/describe',{sessionId:'current'});
  assert.equal(restored.enabled,false);assert.equal(restored.revision,2);await bridge.stop();
  const log=readFileSync(join(root,'session.log'),'utf8');
  assert.equal(log.includes('acp/task/start'),false);assert.equal(log.includes('acp/admission'),false);
});

test('真实OpenCode探针返回就绪或明确阻塞，不发送模型任务',{
  timeout:40000,skip:!process.env.SACODE_ACP_OPENCODE_TEST_EXECUTABLE,
},async t=>{
  assert.ok(process.env.SACODE_HOST);
  const root=mkdtempSync(join(tmpdir(),'sacode-opencode-readiness-'));
  const bridge=new HostBridge(process.env.SACODE_HOST,{...process.env,SACODE_ACP_OPENCODE_EXECUTABLE:process.env.SACODE_ACP_OPENCODE_TEST_EXECUTABLE,SACODE_USER_SETTINGS_DIR:join(root,'settings')});
  await bridge.start(root);t.after(()=>bridge.stop());
  await assert.rejects(bridge.request('acp/provider/probe',{sessionId:'current'}),/workspace-not-selected/);
  await bridge.request('workspace/set-directory',{sessionId:'current',directory:root});
  const report=await bridge.request('acp/provider/probe',{sessionId:'current'});
  console.log('OpenCode 只读探针：'+JSON.stringify(report));
  assert.equal(report.peerId,'opencode');assert.equal(report.modelTaskTested,false);
  assert.ok(['installed-auth-missing','probe-failed-unknown','installed-usable'].includes(report.environment));
  if(report.environment==='installed-auth-missing')assert.equal(report.evidence,'opencode-auth-list-empty:no-task');
  if(report.environment==='probe-failed-unknown'){assert.equal(report.localCredentialPrecondition,false);assert.notEqual(report.verdict,'measured');}
  await bridge.stop();const log=readFileSync(join(root,'session.log'),'utf8');
  assert.equal(log.includes('acp/task/start'),false);assert.equal(log.includes('acp/admission'),false);
});
