import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const {registerCustomsIpc}=require('../../customs-ipc.cjs');
const guard=require('../../customs-guard.cjs');
const compiled=await build({entryPoints:[fileURLToPath(new URL('../../renderer/pages/model-pull-state.ts',import.meta.url))],bundle:true,write:false,format:'cjs'});
const context={module:{exports:{}},Set,Error};
vm.runInNewContext(compiled.outputFiles[0].text,context);
const {createModelPullState,pullBlocks,pullStateText,pullVerificationText}=context.module.exports;
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const view=(id,status='running',settled=false)=>({operationId:id,providerId:'fixture',status,settled,error:''});
function handlers(request){const handlers={};registerCustomsIpc({handle:(name,fn)=>{handlers[name]=fn;}},request,guard,x=>typeof x==='string');return handlers;}

test('发送前保存ID并通知订阅，未知状态拒绝重复拉取，查询只查原ID',async()=>{
  const pending=deferred(),calls=[];let captured;
  const state=createModelPullState({modelPull:async(...args)=>{calls.push(args);captured=state.snapshot();return pending.promise;},
    modelPullDescribe:async id=>view(id,'succeeded',true),modelPullCancel:async id=>view(id,'cancelled',false)},()=> 'stable-id');
  let changes=0;const off=state.subscribe(()=>changes++);
  const first=state.start('fixture',5);
  assert.equal(captured.operationId,'pull-stable-id');assert.equal(changes,1);
  await assert.rejects(state.start('fixture',6),/model-pull-in-flight/);
  pending.resolve({pullOperation:view('pull-stable-id','unknown',false)});await first;
  assert.equal(pullBlocks(state.snapshot()),true);
  await state.refresh();
  assert.equal(state.snapshot().status,'succeeded');assert.equal(pullBlocks(state.snapshot()),false);
  assert.equal(calls.length,1);assert.equal(calls[0][2],'pull-stable-id');
  off();const before=changes;await state.refresh();assert.equal(changes,before);
});

test('取消请求与资源收束分别显示；提交中不能凭取消回执改成取消',async()=>{
  let id;let cancellation=view('pull-cancel','cancelled',false);
  const pending=deferred();
  const state=createModelPullState({modelPull:async(_p,_r,value)=>{id=value;return pending.promise;},
    modelPullDescribe:async()=>view(id,'cancelled',true),modelPullCancel:async()=>({...cancellation,cancelRequested:true})},()=> 'cancel');
  const first=state.start('fixture',0);await state.cancel();
  assert.equal(state.snapshot().settled,false);assert.match(pullStateText(state.snapshot()),/已请求取消/);
  assert.equal(pullBlocks(state.snapshot()),true);
  await state.refresh();assert.equal(pullBlocks(state.snapshot()),false);
  pending.resolve({pullOperation:view(id,'running',false)});await first;
  assert.equal(state.snapshot().status,'cancelled','迟到运行中回执不覆盖终态');
  const committing=createModelPullState({modelPull:async()=>({pullOperation:view('pull-commit','committing',false)}),
    modelPullDescribe:async()=>view('pull-commit','succeeded',true),
    modelPullCancel:async()=>({...view('pull-commit','committing',false),cancelRequested:false})},()=> 'commit');
  await committing.start('fixture',0);await committing.cancel();
  assert.equal(committing.snapshot().status,'committing');assert.equal(committing.snapshot().cancelRequested,false);
});

test('失联、重启未知和错ID回执保持未知，不按全局配置或旧回执解锁',async()=>{
  const state=createModelPullState({modelPull:async()=>{throw Error('host-gone');},
    modelPullDescribe:async id=>({operationId:id,status:'unknown',settled:false,error:'model-pull-operation-unknown'}),
    modelPullCancel:async()=>view('wrong','succeeded',true)},()=> 'lost');
  await state.start('fixture',0);assert.equal(state.snapshot().status,'unknown');
  await state.refresh();assert.equal(pullBlocks(state.snapshot()),true);
  await state.cancel();assert.equal(state.snapshot().status,'unknown');assert.equal(state.snapshot().settled,false);
});

test('主进程关联调用超时只查原操作，并将精确结果以可克隆结构返回',async()=>{
  const calls=[];
  const ipc=handlers(async(method,args)=>{calls.push([method,args]);
    if(method==='model/pull')throw Error('timeout: model/pull');
    return view(args.operationId,'succeeded',true);});
  const result=await ipc['sacode:modelPull']({}, {providerId:'fixture',expectedRevision:5,operationId:'pull-id'});
  assert.equal(result.pullOperation.status,'succeeded');
  assert.deepEqual(calls.map(call=>call[0]),['model/pull','model/pull/describe']);
  assert.equal(calls[0][1].operationId,calls[1][1].operationId);
});

test('主进程保留Host取消/未收束数据，未知操作不冒充已取消',async()=>{
  const failure=Error('-32020 model-pull-cancelled');failure.data=view('owned','cancelled',false);
  const ipc=handlers(async(method)=>{if(method==='model/pull')throw failure;throw Error('-32020 model-pull-operation-unknown');});
  const result=await ipc['sacode:modelPull']({}, {providerId:'fixture',expectedRevision:5,operationId:'owned'});
  assert.equal(result.pullOperation.status,'cancelled');assert.equal(result.pullOperation.settled,false);
  const unknown=await ipc['sacode:modelPullCancel']({}, {operationId:'old'});
  assert.equal(unknown.status,'unknown');assert.equal(unknown.cancelRequested,false);
});

test('所有新控制动作先校验ID，不能传任意方法或越界字段替代ID',async()=>{
  let requests=0;const ipc=handlers(async()=>{requests++;});
  for(const channel of ['sacode:modelPullDescribe','sacode:modelPullCancel']){
    for(const args of [undefined,{}, {operationId:''},{operationId:'../bad'},{operationId:'a'.repeat(97)},{operationId:1}])await assert.rejects(ipc[channel]({},args),/bad-model-pull-operation/);
  }
  await assert.rejects(ipc['sacode:modelPull']({}, {providerId:'fixture',expectedRevision:0,operationId:'bad/id'}),/bad-model-pull-operation/);
  assert.equal(requests,0);
});

test('新操作开始后旧调用失败与旧查询回执都不能覆盖新身份',async()=>{
  const first=deferred(),second=deferred(),oldQuery=deferred();let count=0;
  const state=createModelPullState({modelPull:async()=>++count===1?first.promise:second.promise,
    modelPullDescribe:async()=>oldQuery.promise,
    modelPullCancel:async id=>({...view(id,'cancelled',true),cancelRequested:true})},()=>String(count+1));
  const a=state.start('fixture',0);await state.cancel();
  const query=state.refresh();
  const b=state.start('fixture',1);const id=state.snapshot().operationId;
  first.reject(Error('old-host-gone'));oldQuery.resolve(view('pull-1','running',false));
  await a;await query;
  assert.equal(state.snapshot().operationId,id);assert.equal(state.snapshot().status,'running');
  second.resolve({pullOperation:view(id,'succeeded',true)});await b;
  assert.equal(state.snapshot().status,'succeeded');
});

test('重复查询取消合并为单次控制请求，取消未收束不被旧running或unknown推翻',async()=>{
  const pending=deferred(),cancel=deferred();let cancels=0;
  const state=createModelPullState({modelPull:async()=>pending.promise,
    modelPullDescribe:async id=>view(id,'unknown',false),
    modelPullCancel:async()=>{cancels++;return cancel.promise;}},()=> 'ordered');
  const start=state.start('fixture',0);
  const a=state.cancel(),b=state.cancel();assert.equal(cancels,1);
  cancel.resolve({...view('pull-ordered','cancelled',false),cancelRequested:true});await a;await b;
  pending.resolve({pullOperation:view('pull-ordered','running',false)});await start;
  await state.refresh();assert.equal(state.snapshot().status,'cancelled');
  assert.equal(state.snapshot().settled,false);assert.equal(pullBlocks(state.snapshot()),true);
});

test('提交未知即使线程收束也不能解锁重复；缺控制能力先拒绝不发网络',async()=>{
  const state=createModelPullState({modelPull:async()=>({pullOperation:view('pull-unknown','outcome-unknown',true)}),
    modelPullDescribe:async()=>view('pull-unknown','outcome-unknown',true),modelPullCancel:async()=>{}},()=> 'unknown');
  await state.start('fixture',0);assert.equal(pullBlocks(state.snapshot()),true);
  let pulls=0;const missing=createModelPullState({modelPull:async()=>{pulls++;}},()=> 'missing');
  await assert.rejects(missing.start('fixture',0),/接口尚未就绪/);assert.equal(pulls,0);
});

test('提交未知的已收束事实不因查询失败丢失，核对失败另行展示',async()=>{
  const state=createModelPullState({modelPull:async()=>({pullOperation:view('pull-settled-unknown','outcome-unknown',true)}),
    modelPullDescribe:async()=>{throw Error('transport-failed');},modelPullCancel:async()=>{}},()=> 'settled-unknown');
  await state.start('fixture',0);await state.refresh();
  assert.equal(state.snapshot().status,'outcome-unknown');assert.equal(state.snapshot().settled,true);
  assert.equal(pullBlocks(state.snapshot()),true);
  assert.match(pullStateText(state.snapshot()),/提交结果未知.*后台已收束/);
  assert.match(pullVerificationText(state.snapshot()),/本次核对未取得有效回执/);
});

test('确认取消的原始原因与收束事实保留，取消查询失败不冒充成功',async()=>{
  const state=createModelPullState({modelPull:async()=>({pullOperation:{...view('pull-known-cancel','cancelled',false),error:'model-pull-cancelled'}}),
    modelPullDescribe:async()=>{throw Error('query-failed');},modelPullCancel:async()=>{throw Error('cancel-failed');}},()=> 'known-cancel');
  await state.start('fixture',0);await state.refresh();await state.cancel();
  assert.equal(state.snapshot().error,'model-pull-cancelled');
  assert.equal(state.snapshot().status,'cancelled');assert.equal(state.snapshot().cancelRequested,false);
  assert.match(pullVerificationText(state.snapshot()),/取消请求是否送达未确认/);
  assert.equal(pullBlocks(state.snapshot()),true);
});

test('错供应商和伪造收束unknown回执不得解锁或冒充精确核对成功',async()=>{
  let result;
  const state=createModelPullState({modelPull:async()=>({pullOperation:view('pull-verify','unknown',false)}),
    modelPullDescribe:async()=>result,modelPullCancel:async()=>{}},()=> 'verify');
  await state.start('fixture',0);
  for(const value of [{...view('pull-verify','succeeded',true),providerId:'other'},view('pull-verify','unknown',true)]){
    result=value;await state.refresh();assert.equal(pullBlocks(state.snapshot()),true);
    assert.equal(state.snapshot().status,'unknown');assert.equal(state.snapshot().settled,false);
    assert.match(pullVerificationText(state.snapshot()),/未取得有效回执/);
  }
  result=view('pull-verify','succeeded',true);await state.refresh();
  assert.equal(pullBlocks(state.snapshot()),false);assert.equal(pullVerificationText(state.snapshot()),'');
});
