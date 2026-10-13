import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
const output=await build({entryPoints:[fileURLToPath(new URL('../renderer/pages/acp-live.ts',import.meta.url))],bundle:true,write:false,format:'cjs',logLevel:'silent'});
const module={exports:{}};vm.runInNewContext(output.outputFiles[0].text,{module,exports:module.exports});
const {AcpSessionController,checkedAcpLive}=module.exports;
const view=()=>({version:1,source:'owned-live-process',delegation:{sessionId:'s1',delegationId:'d1',taskId:'t1',requestId:'r1',peerId:'opencode',phase:'running',revision:4,result:''},permissions:[{approvalId:7,toolCallId:'write',argumentsJson:'{"path":"a"}',allowOnceOption:'once',denyOnceOption:'deny',policyAllowsGrant:true,state:'pending',approvalState:'pending',reason:''}],updates:[],workerFinished:false,serverAlive:true,serverExitObserved:false,workerError:''});
test('绑定和恢复不启动任务，迟到创建不更新另一会话',async()=>{
  let resolve;const calls=[],published=[];
  const controller=new AcpSessionController({acpDelegationCreate:(...args)=>{calls.push(args);return new Promise(done=>resolve=done);}},v=>published.push(v));
  controller.bind('s1',true);assert.equal(calls.length,0);
  const task=controller.create('t1','r1','read');controller.bind('s2',true);resolve(view());await task;
  assert.equal(published.length,0);assert.deepEqual(calls,[['s1','t1','r1','opencode','read']]);
  controller.bind('s1',false);await assert.rejects(controller.create('t1','r1','read'),/未激活/);
});
test('控制使用精确委派与修订，审批只能选本提案一次性选项',async()=>{
  const calls=[],published=[];
  const controller=new AcpSessionController({
    acpDelegationCancel:async(...args)=>{calls.push(['cancel',...args]);return view();},
    acpDelegationClose:async(...args)=>{calls.push(['close',...args]);return view();},
    acpDelegationAnswer:async(...args)=>{calls.push(['answer',...args]);return{state:'sent',reason:'pipe-write-confirmed'};},
    acpDelegationPoll:async(...args)=>{calls.push(['poll',...args]);return view();},
  },v=>published.push(v));controller.bind('s1',true);
  await controller.control(view(),'cancel');await controller.control(view(),'close');await controller.answer(view(),7,true);await controller.answer(view(),7,false);
  assert.deepEqual(calls,[['cancel','s1','d1',4],['close','s1','d1',4],['answer','s1','d1',7,'allowed-once','once'],['poll','s1','d1'],['answer','s1','d1',7,'denied','deny'],['poll','s1','d1']]);
  const blocked=view();blocked.permissions[0].policyAllowsGrant=false;
  await assert.rejects(controller.answer(blocked,7,true),/不可回复/);
  const foreign=view();foreign.delegation.sessionId='s2';await assert.rejects(controller.control(foreign,'cancel'),/无效/);
  assert.equal(calls.length,6);assert.equal(published.length,4);
});
test('缺Host入口、伪造回执及未确认审批都不能显示成功',async()=>{
  const published=[];let response=view();
  const controller=new AcpSessionController({acpDelegationCreate:async()=>response,acpDelegationAnswer:async()=>({state:'outcome-unknown',reason:'disconnected'})},v=>published.push(v));controller.bind('s1',true);
  response.delegation.requestId='other';await assert.rejects(controller.create('t1','r1','read'),/绑定不符/);
  await assert.rejects(controller.answer(view(),7,true),/未确认发送/);
  await assert.rejects(controller.refresh('d1'),/未接通/);assert.equal(published.length,0);
  for(const patch of [{source:'durable-history'},{permissions:[{approvalId:7}]},{updates:[1]},{serverAlive:'true'}])assert.throws(()=>checkedAcpLive({...view(),...patch},'s1'),/无效/);
});

const panelOutput=await build({entryPoints:[fileURLToPath(new URL('../renderer/pages/acp-history.ts',import.meta.url))],bundle:true,write:false,format:'cjs',external:['vue'],logLevel:'silent'});
function panel(api){
  const m={exports:{}},hooks=[];
  const vue={defineComponent:v=>v,ref:value=>({value}),watch:(_get,callback,options)=>{hooks.push(callback);if(options?.immediate)callback();},onBeforeUnmount:()=>{},h:(type,props,children)=>({type,props:props||{},children})};
  let seq=0;vm.runInNewContext(panelOutput.outputFiles[0].text,{module:m,exports:m.exports,require:()=>vue,crypto:{randomUUID:()=>String(++seq)}});
  const props={api,sessionId:'s1',active:true};const render=m.exports.AcpHistoryPanel.setup(props);
  const nodes=()=>{const all=[];const walk=v=>{if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object'){all.push(v);walk(v.children);}};walk(render());return all;};
  return{props,hooks,nodes,find:(type,label)=>nodes().find(n=>n.type===type&&(label===undefined||n.children===label)),flush:async()=>{for(let i=0;i<24;i++)await Promise.resolve();}};
}
test('真实面板创建、审批和取消控件消费运行接口，历史读取不启动',async()=>{
  const calls=[];const current=view();current.delegation.taskId='2';current.delegation.requestId='1';
  const f=panel({acpDelegationList:async()=>({version:1,sessionId:'s1',delegations:[]}),
    acpDelegationCreate:async(...args)=>{calls.push(['create',...args]);return current;},
    acpDelegationCancel:async(...args)=>{calls.push(['cancel',...args]);return current;},
    acpDelegationAnswer:async(...args)=>{calls.push(['answer',...args]);return{state:'sent',reason:'confirmed'};},
    acpDelegationPoll:async()=>current});
  await f.flush();assert.equal(calls.length,0);
  f.find('textarea').props.onInput({target:{value:'检查项目'}});f.find('form').props.onSubmit({preventDefault(){}});await f.flush();
  assert.deepEqual(calls[0],['create','s1','2','1','opencode','检查项目']);
  f.find('button','仅允许这一次').props.onClick();await f.flush();assert.deepEqual(calls[1],['answer','s1','d1',7,'allowed-once','once']);
  f.find('button','请求取消').props.onClick();await f.flush();assert.deepEqual(calls[2],['cancel','s1','d1',4]);
});
test('提交失败保留同一请求身份重试，不把错误当成功',async()=>{
  const calls=[];const f=panel({acpDelegationList:async()=>({version:1,sessionId:'s1',delegations:[]}),acpDelegationCreate:async(...args)=>{calls.push(args);throw Error('provider-not-ready');}});
  await f.flush();f.find('textarea').props.onInput({target:{value:'检查项目'}});f.find('form').props.onSubmit({preventDefault(){}});await f.flush();
  assert.ok(f.nodes().some(n=>n.props.role==='alert'&&n.children==='provider-not-ready'));
  assert.equal(f.find('textarea').props.value,'检查项目');f.find('form').props.onSubmit({preventDefault(){}});await f.flush();assert.deepEqual(calls[0],calls[1]);
});
