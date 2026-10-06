import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const {HostBridge}=createRequire(import.meta.url)('../host-bridge.cjs');
const host=process.env.SACODE_HOST||fileURLToPath(new URL('../dist/host/bin/sacode-host.exe',import.meta.url));

test('真实目标控制持久化且拒绝跨会话和陈旧修订，网页没有完成动作',async()=>{
 const root=mkdtempSync(join(tmpdir(),'sacode-goal-controls-'));
 const env={...process.env,SACODE_USER_SETTINGS_DIR:join(root,'settings'),SACODE_PROVIDER_BASE_URL:'',SACODE_PROVIDER_KEY:'',STEPFUN_API_KEY:''};
 let bridge=new HostBridge(host,env);await bridge.start(root);
 try{
  const sessionId='current';
  const capabilities=(await bridge.request('initialize')).capabilities;
  for(const action of ['describe','create','edit','pause','resume','clear'])assert.ok(capabilities.includes('goal/'+action));
  assert.equal(capabilities.includes('goal/complete'),false);
  const empty=await bridge.request('goal/describe',{sessionId});assert.equal(empty.phase,'none');assert.equal(empty.roundsDone,0);
  await assert.rejects(bridge.request('goal/create',{sessionId,objective:' \n '}),/bad-goal-objective/);
  const created=await bridge.request('goal/create',{sessionId,objective:'持续完成验证'});assert.equal(created.revision,1);
  await assert.rejects(bridge.request('goal/edit',{sessionId,revision:0,objective:'陈旧改写'}),/stale-goal-revision/);
  await assert.rejects(bridge.request('goal/pause',{sessionId:'other',revision:1}),/goal-session-changed/);
  const edit=await bridge.request('goal/edit',{sessionId,revision:1,objective:'编辑后的目标'});assert.equal(edit.revision,2);
  await bridge.request('turn/start',{limit:1});
  assert.equal((await bridge.request('turn/poll')).running,true);
  const paused=await bridge.request('goal/pause',{sessionId,revision:2});assert.equal(paused.phase,'paused');
  assert.equal((await bridge.request('turn/poll')).running,true,'暂停目标不得取消在途轮次');
  const resumed=await bridge.request('goal/resume',{sessionId,revision:3});assert.equal(resumed.phase,'active');
  await bridge.request('turn/cancel');
  for(let i=0;i<100;i++){const turn=await bridge.request('turn/poll');if(!turn.running)break;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal((await bridge.stop()).code,0);
  bridge=new HostBridge(host,env);await bridge.start(root);
  const replay=await bridge.request('goal/describe',{sessionId});assert.equal(replay.objective,'编辑后的目标');assert.equal(replay.revision,4);
  const other=await bridge.request('session/create',{title:'另一个会话'});await bridge.request('session/select',{sessionId:other.id});
  assert.equal((await bridge.request('goal/describe',{sessionId:other.id})).phase,'none');
  await assert.rejects(bridge.request('goal/clear',{sessionId,revision:4}),/goal-session-changed/);
  await bridge.request('session/select',{sessionId});
  const cleared=await bridge.request('goal/clear',{sessionId,revision:4});assert.equal(cleared.phase,'none');assert.equal(cleared.revision,5);
 }finally{assert.equal((await bridge.stop()).code,0);}
});
