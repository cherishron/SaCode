import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fixtureHostEnv} from '../test-support/fixture-env.mjs';

const entry=fileURLToPath(new URL('../renderer/pages/git-workbench.ts',import.meta.url));
const bundled=await build({entryPoints:[entry],bundle:true,write:false,format:'cjs',platform:'node',external:['vue']});
const module={exports:{}};
let generatedId=0;
const require=createRequire(import.meta.url),vue=require('vue');
const componentVue={...vue,onBeforeUnmount:()=>{}};
vm.runInNewContext(bundled.outputFiles[0].text,{module,exports:module.exports,require:id=>id==='vue'?componentVue:require(id),crypto:{randomUUID:()=>`git-action-live-${++generatedId}`}});
const {GitWorkbench}=module.exports;
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
 for(let i=0;i<200;i++){
  if(check())return;
  await new Promise(resolve=>setTimeout(resolve,5));
 }
 throw Error('等待超时：'+label);
}

test('真实 Git 工作台为暂存、提交、推送分别申请一次性审批；执行门禁关闭时不改 Git',
 {skip:!process.env.SACODE_HOST,timeout:60000},async t=>{
 const target=fileURLToPath(new URL('../../../target/tmp/',import.meta.url));mkdirSync(target,{recursive:true});
 const root=mkdtempSync(join(target,'git-action-live-host-')),project=join(root,'project'),remote=join(root,'remote.git');
 mkdirSync(project);writeFileSync(join(root,'session.log'),'');
 const git=(...args)=>execFileSync('git',['-C',project,...args],{encoding:'utf8',windowsHide:true});
 const remoteGit=(...args)=>execFileSync('git',['--git-dir',remote,...args],{encoding:'utf8',windowsHide:true});
 git('init','-q','-b','main');git('config','user.name','SaCode Test');git('config','user.email','test@example.invalid');
 writeFileSync(join(project,'base.txt'),'base\n');git('add','--','base.txt');git('commit','-q','-m','fixture base');
 execFileSync('git',['init','--bare','-q',remote],{encoding:'utf8',windowsHide:true});
 git('remote','add','origin',remote);git('push','-q','-u','origin','main');
 const baseCommit=git('rev-parse','HEAD').trim();writeFileSync(join(project,'stage-me.txt'),'stage proposal only\n');

 const bridge=new HostBridge(process.env.SACODE_HOST,fixtureHostEnv(root,{TEMP:root,TMP:root}));
 let scope=null,bridgeStopped=false;const childScopes=new Set();
 t.after(async()=>{for(const child of childScopes)child.stop();scope?.stop();if(!bridgeStopped)await bridge.stop(10000);});
 await bridge.start(root);
 const init=await bridge.request('initialize',{});
 for(const verb of ['workspace/git-status','workspace/git-diff','workspace/git-push-target','execution/propose','execution/describe','execution/stop'])assert.ok(init.capabilities.includes(verb),verb);
 await bridge.request('workspace/set-directory',{directory:project});
 const workspace=await bridge.request('workspace/get',{}),sessionId='current',directory=workspace.directory;
 const proposals=[],calls={authorize:0,start:0};
 const approvalIds=new Set();
 const executionApi={
  workspaceGet:()=>bridge.request('workspace/get',{}),
  executionPropose:async(sessionId,taskId,requestId,proposal)=>{
   const reply=await bridge.request('execution/propose',{sessionId,taskId,requestId,proposal});
   proposals.push({sessionId,taskId,requestId,proposal:JSON.parse(proposal),reply});return reply;
  },
  executionDescribe:(sessionId,executionId)=>bridge.request('execution/describe',{sessionId,executionId}),
  executionAuthorize:async(...args)=>{calls.authorize++;return bridge.request('execution/authorize',{sessionId:args[0],executionId:args[1],revision:args[2],proposalDigest:args[3],approvalId:args[4]});},
  executionStart:async(...args)=>{calls.start++;return bridge.request('execution/start',{sessionId:args[0],executionId:args[1],revision:args[2]});},
  executionStop:(sessionId,executionId,revision)=>bridge.request('execution/stop',{sessionId,executionId,revision}),
  executionOutput:(sessionId,executionId,cursor,limit)=>bridge.request('execution/output',{sessionId,executionId,cursor,limit}),
  approvalAsk:(name,args)=>bridge.request('approval/ask',{name,args}),
  approvalAnswer:(approvalId,decision)=>bridge.request('approval/answer',{approvalId,decision}),
 };
 const props=vue.reactive({
  sessionId,directory,configured:true,active:true,refreshSignal:0,executionApi,
  status:()=>bridge.request('workspace/git-status',{sessionId,directory}),
  diff:(path,kind)=>bridge.request('workspace/git-diff',{sessionId,directory,path,scope:kind}),
  pushTarget:()=>bridge.request('workspace/git-push-target',{sessionId,directory}),
 });
 const emitted=[];scope=vue.effectScope();const render=scope.run(()=>GitWorkbench.setup(props,{emit:(...args)=>emitted.push(args)}));
 await until(()=>nodes(render()).some(node=>node.type==='button'&&text(node)==='暂存所选文件')&&text(render()).includes('stage-me.txt'),'读取真实 Git 状态');

 async function proposeFromPage(actionLabel,expectedArgv,beforeStop=async()=>null){
  const before=proposals.length;
  const callsBefore={...calls};
  const action=button(render(),actionLabel);assert.ok(action,'missing Git action '+actionLabel);assert.equal(action.props.disabled,false,actionLabel+' should be enabled');action.props.onClick();
  const taskNode=()=>nodes(render()).find(node=>node.type?.name==='SaCodeExecutionTask');
  await until(()=>taskNode()||nodes(render()).some(node=>node.props?.role==='alert'),'render action result for '+actionLabel);
  const task=taskNode();if(!task)throw Error('Git action did not create a Host task: '+text(render()));
  const child=vue.effectScope();childScopes.add(child);
  child.run(()=>task.type.setup(task.props,{emit:()=>{}}));
  await until(()=>proposals.length===before+1,'persist Host proposal for '+actionLabel);
  const recorded=proposals.at(-1);assert.equal(recorded.reply.phase,'awaiting-approval');assert.equal(recorded.proposal.executable,'git');assert.deepEqual(recorded.proposal.argv,expectedArgv);
  assert.deepEqual(calls,callsBefore,'the page must not authorize or start a Git action by itself');
  const settled=await beforeStop(recorded);
  const stopped=await bridge.request('execution/stop',{sessionId,executionId:recorded.reply.executionId,revision:settled?.revision??recorded.reply.revision});
  assert.equal(stopped.phase,'cancelled-before-start');
  child.stop();childScopes.delete(child);
  button(render(),'关闭操作')?.props.onClick();
  await new Promise(resolve=>setImmediate(resolve));
  return {...recorded,settled,stopped};
 }
 async function authorizeAndRefuseStart(recorded){
  const ticket=await executionApi.approvalAsk('execution/start',recorded.reply.approvalArguments);
  assert.ok(Number.isSafeInteger(ticket.approvalId));assert.ok(!approvalIds.has(ticket.approvalId),'each Git operation needs its own approval ticket');approvalIds.add(ticket.approvalId);
  assert.equal((await executionApi.approvalAnswer(ticket.approvalId,'allowed-once')).accepted,true);
  const admitted=await executionApi.executionAuthorize(sessionId,recorded.reply.executionId,recorded.reply.revision,recorded.reply.proposalDigest,ticket.approvalId);
  assert.equal(admitted.phase,'admitted','a one-time ticket must authorize only this exact proposal');
  await assert.rejects(()=>executionApi.executionStart(sessionId,recorded.reply.executionId,admitted.revision),/execution-provider-unverified/);
  const current=await executionApi.executionDescribe(sessionId,recorded.reply.executionId);
  assert.equal(current.phase,'admitted','the fail-closed start refusal must not claim the Git action ran');
  return current;
 }

 const initialIndex=readFileSync(join(project,'.git','index'));
 const choice=nodes(render()).find(node=>node.type==='input'&&node.props?.type==='checkbox');assert.ok(choice,'untracked file should be selectable');
 choice.props.onChange({target:{checked:true}});
 const stage=await proposeFromPage('暂存所选文件',['add','--all','--',' :(literal)stage-me.txt'.trimStart()],authorizeAndRefuseStart);
 assert.equal(stage.settled.phase,'admitted');
 assert.deepEqual(readFileSync(join(project,'.git','index')),initialIndex,'stage proposal must not write the Git index');
 assert.equal(git('status','--porcelain','--','stage-me.txt').trim(),'?? stage-me.txt');

 git('add','--','stage-me.txt');const stagedIndex=readFileSync(join(project,'.git','index'));
 const refresh=button(render(),'刷新');assert.ok(refresh);refresh.props.onClick();
 await until(()=>text(render()).includes('stage-me.txt'),'refresh staged file status');
 const message=nodes(render()).find(node=>node.type==='textarea'&&node.props?.onInput);assert.ok(message,'commit message input missing');
 message.props.onInput({target:{value:'fixture commit proposal'}});
 const commit=await proposeFromPage('提交已暂存内容',['commit','-m','fixture commit proposal'],authorizeAndRefuseStart);
 assert.equal(commit.settled.phase,'admitted');
 assert.deepEqual(readFileSync(join(project,'.git','index')),stagedIndex,'commit proposal must not change the Git index');
 assert.equal(git('rev-parse','HEAD').trim(),baseCommit,'commit proposal must not create a commit');

 git('commit','-q','-m','fixture local commit');const localCommit=git('rev-parse','HEAD').trim();
 const pushRefresh=button(render(),'刷新');assert.ok(pushRefresh);pushRefresh.props.onClick();
 await until(()=>text(render()).includes('origin/main'),'refresh ahead upstream status');
 const push=await proposeFromPage('推送当前分支',['push','--porcelain','--no-follow-tags','--recurse-submodules=no','--','origin',`${localCommit}:refs/heads/main`],authorizeAndRefuseStart);
 assert.equal(push.stopped.phase,'cancelled-before-start');
 assert.equal(push.settled.phase,'admitted');assert.equal(approvalIds.size,3);
 assert.equal(calls.authorize,3);assert.equal(calls.start,3);
 assert.equal(remoteGit('rev-parse','refs/heads/main').trim(),baseCommit,'push proposal must not contact or update the remote');
 assert.ok(!readFileSync(join(root,'session.log'),'utf8').includes('owned-subprocess:'),'proposals must not spawn Git');
 assert.deepEqual(emitted,[]);
 assert.equal((await bridge.stop(10000)).forced,false);bridgeStopped=true;
 console.log('GIT_ACTION_LIVE_HOST_PASS：stage/commit/push 均获得各自的一次性审批；执行器未验证时启动均被拒绝；索引、HEAD、远端均未被 UI 改变。');
 console.log('GIT_ACTION_LIVE_HOST_EVIDENCE='+root);
});
