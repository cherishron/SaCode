import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {fixtureHostEnv} from '../test-support/fixture-env.mjs';

const entry=fileURLToPath(new URL('../renderer/pages/build-test-page.ts',import.meta.url));
const bundled=await build({entryPoints:[entry],bundle:true,write:false,format:'cjs',platform:'node',external:['vue']});
const module={exports:{}};
let generatedId=0;
const require=createRequire(import.meta.url),vue=require('vue');
const componentVue={...vue,onBeforeUnmount:()=>{}};
vm.runInNewContext(bundled.outputFiles[0].text,{
 module,exports:module.exports,
 require:id=>id==='vue'?componentVue:require(id),
 globalThis:{crypto:{randomUUID:()=>`build-test-live-${++generatedId}`}},
});
const {BuildTestPage}=module.exports;
const {HostBridge}=require('../host-bridge.cjs');

function nodes(value,result=[]){
 if(Array.isArray(value)){for(const item of value)nodes(item,result);return result;}
 if(!value||typeof value!=='object')return result;
 result.push(value);nodes(value.children,result);return result;
}
function text(value){
 if(Array.isArray(value))return value.map(text).join('');
 if(value===null||value===undefined)return '';
 if(typeof value!=='object')return String(value);
 return text(value.children);
}
function button(tree,label){return nodes(tree).find(node=>node.type==='button'&&text(node)===label);}
async function until(check,label){
 for(let i=0;i<400;i++){
  if(check())return;
  await new Promise(resolve=>setTimeout(resolve,5));
 }
 throw Error('等待超时：'+label);
}

test('构建测试页面连接真实 Host；审批和报告绑定真实任务，沙箱未验证时不执行且不报通过',
 {skip:!process.env.SACODE_HOST,timeout:60000},async t=>{
 const target=fileURLToPath(new URL('../../../target/tmp/',import.meta.url));mkdirSync(target,{recursive:true});
 const day=new Date().toISOString().slice(0,10).replaceAll('-','');
 const root=mkdtempSync(join(target,`build-test-live-host-${day}-`)),project=join(root,'project');
 mkdirSync(project);writeFileSync(join(root,'session.log'),'');
 const bridge=new HostBridge(process.env.SACODE_HOST,fixtureHostEnv(root,{TEMP:root,TMP:root}));
 const childScopes=new Set();let pageScope=null,bridgeStopped=false;
 t.after(async()=>{for(const child of childScopes)child.stop();pageScope?.stop();if(!bridgeStopped)await bridge.stop(10000);});
 await bridge.start(root);
 const init=await bridge.request('initialize',{});
 for(const verb of ['workspace/get','workspace/set-directory','execution/propose','execution/authorize','execution/start','execution/describe','execution/output','execution/stop'])assert.ok(init.capabilities.includes(verb),verb);
 await bridge.request('workspace/set-directory',{directory:project});
 const workspace=await bridge.request('workspace/get',{}),sessionId='current';
 const proposals=[],approvalTickets=[],calls={authorize:0,start:0};
 const api={
  workspaceGet:()=>bridge.request('workspace/get',{}),
  executionPropose:async(sessionId,taskId,requestId,proposal)=>{
   const reply=await bridge.request('execution/propose',{sessionId,taskId,requestId,proposal});
   proposals.push({sessionId,taskId,requestId,proposal:JSON.parse(proposal),reply});return reply;
  },
  executionDescribe:(sessionId,executionId)=>bridge.request('execution/describe',{sessionId,executionId}),
  executionAuthorize:async(sessionId,executionId,revision,proposalDigest,approvalId)=>{
   calls.authorize++;
   return bridge.request('execution/authorize',{sessionId,executionId,revision,proposalDigest,approvalId});
  },
  executionStart:async(sessionId,executionId,revision)=>{
   calls.start++;
   return bridge.request('execution/start',{sessionId,executionId,revision});
  },
  executionStop:(sessionId,executionId,revision)=>bridge.request('execution/stop',{sessionId,executionId,revision}),
  executionOutput:(sessionId,executionId,cursor,limit)=>bridge.request('execution/output',{sessionId,executionId,cursor,limit}),
  approvalAsk:async(name,args)=>{const ticket=await bridge.request('approval/ask',{name,args});approvalTickets.push(ticket);return ticket;},
  approvalAnswer:(approvalId,decision)=>bridge.request('approval/answer',{approvalId,decision}),
 };
 const props=vue.reactive({active:true,sessionId,api});
 const emitted=[];pageScope=vue.effectScope();
 const render=pageScope.run(()=>BuildTestPage.setup(props,{emit:(...args)=>emitted.push(args)}));
 const card=()=>nodes(render()).find(node=>node.type==='article'&&text(node).includes('运行仓颉测试'));
 assert.ok(card(),'Cangjie test preset should be listed');
 const choose=button(card(),'选择任务');assert.ok(choose);choose.props.onClick();
 const preview=nodes(render()).find(node=>node.type==='pre');assert.ok(preview);
 assert.deepEqual(JSON.parse(text(preview)).argv,['test','--no-color','--no-progress']);
 const create=button(render(),'创建持久执行提案');assert.ok(create);create.props.onClick();
 const taskNode=()=>nodes(render()).find(node=>node.type?.name==='SaCodeExecutionTask');
 await until(()=>taskNode(),'mount execution task');
 const child=vue.effectScope();childScopes.add(child);
 const taskRender=child.run(()=>taskNode().type.setup(taskNode().props,{emit:()=>{}}));
 await until(()=>proposals.length===1&&nodes(taskRender()).some(node=>node.props?.['aria-label']==='构建测试报告'),'persist real Host proposal and report');

 const recorded=proposals[0],state=recorded.reply;
 assert.equal(state.phase,'awaiting-approval');
 assert.equal(recorded.sessionId,sessionId);
 assert.equal(recorded.proposal.executable,'cjpm');
 assert.deepEqual(recorded.proposal.argv,['test','--no-color','--no-progress']);
 assert.equal(recorded.proposal.cwd,workspace.directory);
 assert.equal(recorded.proposal.workspaceRevision,workspace.revision);
 assert.equal(calls.authorize,0);assert.equal(calls.start,0);
 assert.equal(state.providerAvailable,false);
 assert.equal(state.providerReason,'platform-sandbox-unavailable');
 let tree=taskRender();
 const start=button(tree,'启动');assert.ok(start);assert.equal(start.props.disabled,true);
 assert.match(text(tree),/执行隔离后端/);
 let report=nodes(tree).find(node=>node.props?.['aria-label']==='构建测试报告');
 assert.equal(report.props['data-execution-id'],state.executionId);
 assert.notEqual(report.props['data-report-status'],'passed');
 assert.notEqual(report.props['data-report-status'],'passed-with-skips');

 const approve=button(tree,'批准此提案一次');assert.ok(approve);await approve.props.onClick();
 assert.equal(calls.authorize,1);assert.equal(approvalTickets.length,1);
 const admitted=await api.executionDescribe(sessionId,state.executionId);
 assert.equal(admitted.phase,'admitted');
 assert.equal(calls.start,0,'approval must not start a command');
 tree=taskRender();
 assert.equal(button(tree,'启动').props.disabled,true,'unverified sandbox keeps UI start disabled after approval');
 report=nodes(tree).find(node=>node.props?.['aria-label']==='构建测试报告');
 assert.equal(report.props['data-execution-id'],state.executionId);
 assert.notEqual(report.props['data-report-status'],'passed');
 await assert.rejects(()=>api.executionStart(sessionId,state.executionId,admitted.revision),/execution-provider-unverified/);
 assert.equal(calls.start,1);
 assert.equal((await api.executionDescribe(sessionId,state.executionId)).phase,'admitted');
 const cancelled=await api.executionStop(sessionId,state.executionId,admitted.revision);
 assert.equal(cancelled.phase,'cancelled-before-start');
 assert.ok(!existsSync(join(project,'must-not-exist.txt')));
 assert.ok(!readFileSync(join(root,'session.log'),'utf8').includes('owned-subprocess:'));
 assert.deepEqual(emitted,[]);
 assert.equal((await bridge.stop(10000)).forced,false);bridgeStopped=true;
 console.log('BUILD_TEST_LIVE_HOST_PASS：真实 Cangjie 测试提案、一次性审批、执行门禁拒绝、报告不报通过、启动前取消均由真实 Host 核对。');
 console.log('BUILD_TEST_LIVE_HOST_EVIDENCE='+root);
});
