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
  const props={api:{acpSettingsDescribe:async()=>({enabled:true,revision:1,source:'project',scope:'project-session'}),acpProviderProbe:async()=>({peerId:'opencode',environment:'installed-usable',protocolReady:true,verdict:'measured',protocolVersion:1,evidence:'controlled-fixture:no-real-provider',modelTaskTested:false}),...api},sessionId:'s1',active:true};const render=m.exports.AcpHistoryPanel.setup(props);
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
  f.find('button','检查 OpenCode 提供方').props.onClick();await f.flush();
  f.find('textarea').props.onInput({target:{value:'检查项目'}});f.find('form').props.onSubmit({preventDefault(){}});await f.flush();
  assert.deepEqual(calls[0],['create','s1','2','1','opencode','检查项目']);
  f.find('button','仅允许这一次').props.onClick();await f.flush();assert.deepEqual(calls[1],['answer','s1','d1',7,'allowed-once','once']);
  f.find('button','请求取消').props.onClick();await f.flush();assert.deepEqual(calls[2],['cancel','s1','d1',4]);
});
test('提交失败保留同一请求身份重试，不把错误当成功',async()=>{
  const calls=[];const f=panel({acpDelegationList:async()=>({version:1,sessionId:'s1',delegations:[]}),acpDelegationCreate:async(...args)=>{calls.push(args);throw Error('provider-not-ready');}});
  await f.flush();f.find('button','检查 OpenCode 提供方').props.onClick();await f.flush();f.find('textarea').props.onInput({target:{value:'检查项目'}});f.find('form').props.onSubmit({preventDefault(){}});await f.flush();
  assert.ok(f.nodes().some(n=>n.props.role==='alert'&&n.children==='provider-not-ready'));
  assert.equal(f.find('textarea').props.value,'检查项目');f.find('form').props.onSubmit({preventDefault(){}});await f.flush();assert.deepEqual(calls[0],calls[1]);
});

test('面板默认关闭，不以提交任务隐式开启，提供方检查不发任务',async()=>{
  let starts=0,enables=0;const f=panel({acpSettingsDescribe:async()=>({enabled:false,revision:0,source:'default',scope:'project-session'}),acpSettingsSetEnabled:async(...args)=>{assert.deepEqual(args,['s1',true,0]);enables++;return{enabled:true,revision:1,source:'project',scope:'project-session'};},acpDelegationCreate:async()=>{starts++;throw Error('not invoked in readiness check');}});
  await f.flush();f.find('textarea').props.onInput({target:{value:'检查项目'}});f.find('form').props.onSubmit({preventDefault(){}});await f.flush();assert.equal(starts,0);assert.equal(enables,0);
  f.find('button','检查 OpenCode 提供方').props.onClick();await f.flush();assert.equal(starts,0);
  f.find('button','开启 ACP').props.onClick();await f.flush();assert.equal(enables,1);assert.equal(starts,0);
});

test('日志权限拒绝显示真实阻塞，不伪装成未配置凭据或允许提交',async()=>{
  let starts=0;const f=panel({acpProviderProbe:async()=>({peerId:'opencode',environment:'probe-failed-unknown',protocolReady:false,verdict:'pending-verification',protocolVersion:0,evidence:'opencode-local-auth-exit-1-log-file-permission-denied-unconfirmed:no-task',modelTaskTested:false}),acpDelegationCreate:async()=>{starts++;}});
  await f.flush();f.find('button','检查 OpenCode 提供方').props.onClick();await f.flush();
  f.find('textarea').props.onInput({target:{value:'不得执行'}});f.find('form').props.onSubmit({preventDefault(){}});await f.flush();
  const text=JSON.stringify(f.nodes());assert.ok(text.includes('日志文件访问被拒绝'));assert.equal(text.includes('本地凭据列表为空'),false);
  assert.equal(f.find('button','提交给 OpenCode').props.disabled,true);assert.equal(starts,0);
});

test('ACP关闭时连手工探测也不调用提供方，失败不回写开关',async()=>{
 let probes=0,sets=0;const f=panel({acpSettingsDescribe:async()=>({enabled:false,revision:0,source:'default',scope:'project-session'}),acpProviderProbe:async()=>{probes++;throw Error('must-not-run');},acpSettingsSetEnabled:async()=>{sets++;}});
 await f.flush();const button=f.find('button','检查 OpenCode 提供方');assert.equal(button.props.disabled,true);button.props.onClick();await f.flush();assert.equal(probes,0);assert.equal(sets,0);
});

test('只有协议明确要求认证才提示OpenCode处理，探测失败保留已开启选择',async()=>{
 let sets=0;const f=panel({acpProviderProbe:async()=>({peerId:'opencode',environment:'installed-auth-missing',protocolReady:false,verdict:'blocked',protocolVersion:1,evidence:'acp-auth-required:no-task',modelTaskTested:false}),acpSettingsSetEnabled:async()=>{sets++;}});
 await f.flush();f.find('button','检查 OpenCode 提供方').props.onClick();await f.flush();
 assert.ok(JSON.stringify(f.nodes()).includes('OpenCode 实际返回认证要求'));assert.ok(f.find('button','关闭 ACP'));assert.equal(sets,0);
});

test('关闭开关不杀在途任务，用户另行选择取消且使用绑定修订',async()=>{
 const calls=[];const current=view();current.delegation.taskId='2';current.delegation.requestId='1';
 const f=panel({acpDelegationList:async()=>({version:1,sessionId:'s1',delegations:[]}),acpDelegationCreate:async()=>current,
 acpSettingsSetEnabled:async()=>({enabled:false,revision:2,source:'project',scope:'project-session'}),acpDelegationCancel:async(...args)=>{calls.push(args);return current;}});
 await f.flush();f.find('button','检查 OpenCode 提供方').props.onClick();await f.flush();f.find('textarea').props.onInput({target:{value:'test'}});f.find('form').props.onSubmit({preventDefault(){}});await f.flush();
 f.find('button','关闭 ACP').props.onClick();await f.flush();assert.equal(calls.length,0);assert.ok(f.find('button','等待收尾／刷新状态'));
 f.find('button','取消在途委派').props.onClick();await f.flush();assert.deepEqual(calls,[['s1','d1',4]]);
});

test('未核价与插件覆盖未知仅作诊断提示，不拦截已接通协议的显式委派',async()=>{
 let starts=0;const current=view();current.delegation.taskId='2';current.delegation.requestId='1';
 const diagnostics={version:1,diagnosticId:'acp-'+'a'.repeat(32),workspace:'workspace',executable:'trusted-executable',agentName:'OpenCode',agentVersion:'2.fixture',sessionModel:null,sessionMode:null,source:'acp-observation',processIntegrity:'low',configSources:'unknown',processIdentity:'unknown',primaryAgent:'unknown',price:'unknown',pluginModels:'unknown',network:'not-tested',modelTask:'not-tested'};
 const f=panel({acpProviderProbe:async()=>({peerId:'opencode',environment:'installed-usable',protocolReady:true,verdict:'measured',protocolVersion:1,evidence:'controlled-fixture:no-model-task',modelTaskTested:false,diagnostics}),acpDelegationCreate:async()=>{starts++;return current;}});
 await f.flush();f.find('button','检查 OpenCode 提供方').props.onClick();await f.flush();
 assert.ok(JSON.stringify(f.nodes()).includes('未确认动态插件覆盖'));
 f.find('textarea').props.onInput({target:{value:'显式任务'}});assert.equal(f.find('button','提交给 OpenCode').props.disabled,false);
 f.find('form').props.onSubmit({preventDefault(){}});await f.flush();assert.equal(starts,1);
});

test('恢复历史诊断只供回看，保留决定不启动任务且切会话后不串回执',async()=>{
 let starts=0,keeps=0,reply;
 const diagnostics={version:1,diagnosticId:'acp-'+'b'.repeat(32),workspace:'workspace',executable:'trusted',agentName:null,agentVersion:null,sessionModel:null,sessionMode:null,source:'acp-observation',configSources:'unknown',processIdentity:'unknown',primaryAgent:'unknown',price:'unknown',pluginModels:'unknown',network:'not-tested',modelTask:'not-tested'};
 const history={version:1,sessionId:'s1',source:'durable-history',scopeCurrent:true,record:{version:1,sessionId:'s1',revision:1,scopeRevision:0,decision:'pending',diagnosticId:diagnostics.diagnosticId,report:{peerId:'opencode',protocolReady:true,modelTaskTested:false,diagnostics}}};
 const f=panel({acpDiagnosticsDescribe:async()=>history,acpDiagnosticsKeep:(...args)=>{keeps++;assert.deepEqual(args,['s1',diagnostics.diagnosticId,1]);return new Promise(done=>reply=done);},acpDelegationCreate:async()=>{starts++;}});
 await f.flush();assert.ok(f.find('strong','诊断结果已记录'));
 f.find('textarea').props.onInput({target:{value:'read'}});assert.equal(f.find('button','提交给 OpenCode').props.disabled,true);
 f.find('button','暂不修复／保留现状').props.onClick();await f.flush();assert.equal(keeps,1);assert.equal(starts,0);
 f.props.sessionId='s2';f.hooks[0]();await f.flush();reply({...history,record:{...history.record,decision:'kept',revision:2}});await f.flush();
 assert.equal(f.find('strong','已保留现状'),undefined);assert.equal(starts,0);
});

test('程序发现失败显示安装或实例问题，不要求登录也不关闭开关',async()=>{
 let settings=0;
 const f=panel({acpProviderProbe:async()=>({peerId:'opencode',environment:'probe-failed-unknown',protocolReady:false,verdict:'blocked',protocolVersion:0,evidence:'opencode-executable-not-found:no-task',modelTaskTested:false}),acpSettingsSetEnabled:async()=>{settings++;}});
 await f.flush();f.find('button','检查 OpenCode 提供方').props.onClick();await f.flush();
 assert.ok(JSON.stringify(f.nodes()).includes('未找到可启动的 OpenCode'));
 assert.ok(f.find('button','关闭 ACP'));assert.equal(settings,0);
});
