// 真实默认入口，不借用预先制造的执行日志；所有文件均为本轮独占合成项目。
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import vm from 'node:vm';
import {fixtureHostEnv} from './fixture-env.mjs';
const require=createRequire(import.meta.url),{HostBridge}=require('../host-bridge.cjs'),{registerExecutionIpc}=require('../execution-ipc.cjs');
const [host,cli]=process.argv.slice(2).map(v=>resolve(v));assert.ok(host&&cli);
const root=mkdtempSync(fileURLToPath(new URL('../../../target/tmp/capsule-entries-',import.meta.url))),source=join(root,'project'),data=join(root,'appdata');mkdirSync(source);mkdirSync(data);writeFileSync(join(source,'input.txt'),'ORIGINAL');
const colocated=process.argv.includes('--colocated'),sessionRoot=colocated?source:root;
const env=fixtureHostEnv(root,{LOCALAPPDATA:data,TMP:root,TEMP:root,SACODE_WINDOWS_ENFORCING:'',SACODE_WINDOWS_PROCESS_DLL:''});
const mkBridge=()=>{const b=new HostBridge(host,env),request=b.request.bind(b);b.request=async(method,...args)=>{try{return await request(method,...args);}catch(e){e.message=method+': '+e.message;throw e;}};return b;},proposal=(cwd,revision,text)=>JSON.stringify({cwd,workspaceRevision:revision,executable:join(process.env.SystemRoot,'System32/cmd.exe'),argv:['/d','/s','/c',`echo ${text}>input.txt`],timeoutMs:5000,outputLimit:256});
async function load(path){const b=await build({entryPoints:[fileURLToPath(new URL(path,import.meta.url))],bundle:true,write:false,format:'cjs'});const c={module:{exports:{}},atob,TextDecoder,globalThis:{crypto:{randomUUID}}};vm.runInNewContext(b.outputFiles[0].text,c);return c.module.exports;}
const {createExecutionTask}=await load('../renderer/pages/execution-task-state.ts'),{createReviewWriteback}=await load('../renderer/pages/review-writeback-state.ts');
let checks=0,task,pendingId,pendingDirectory;
let bridge=mkBridge();
try{
 await bridge.start(sessionRoot);await bridge.request('workspace/set-directory',{directory:source});const workspace=await bridge.request('workspace/get',{});
 const handlers=new Map();registerExecutionIpc({handle:(n,h)=>handlers.set(n,h)},(method,args)=>bridge.request(method,args,15000));
 const fields={executionPropose:['sessionId','taskId','requestId','proposal'],executionAuthorize:['sessionId','executionId','revision','proposalDigest','approvalId'],executionStart:['sessionId','executionId','revision'],executionDescribe:['sessionId','executionId'],executionOutput:['sessionId','executionId','cursor','limit'],executionStop:['sessionId','executionId','revision']};
 const api=Object.fromEntries(Object.entries(fields).map(([name,keys])=>[name,(...args)=>handlers.get('sacode:'+name)({},Object.fromEntries(keys.map((k,i)=>[k,args[i]])))]));api.workspaceGet=()=>bridge.request('workspace/get',{});api.approvalAsk=(name,args)=>bridge.request('approval/ask',{name,args});api.approvalAnswer=(approvalId,decision)=>bridge.request('approval/answer',{approvalId,decision});
 const view=createExecutionTask(api,()=>workspace.sessionId,()=>{});await view.propose('entry-host','host-run',proposal(workspace.directory,workspace.revision,'HOST_REAL'));assert.equal(view.state.error,'');assert.equal(view.state.task.providerAvailable,true);checks++;
 const snapshot=JSON.parse(view.state.task.workspaceSnapshot);assert.notEqual(snapshot.executionDirectory,snapshot.sourceDirectory);assert.equal(readFileSync(join(source,'input.txt'),'utf8'),'ORIGINAL');checks++;
 await view.approve();assert.equal(view.state.error,'');await view.start();assert.equal(view.state.error,'');
 for(let i=0;i<200;i++){await view.describe(view.state.task.executionId);if(view.state.task.phase==='exited'&&view.state.task.review&&!existsSync(snapshot.executionDirectory))break;await new Promise(r=>setTimeout(r,20));}
 assert.equal(view.state.error,'');task=view.state.task;assert.equal(task.phase,'exited');assert.equal(JSON.parse(task.result).exitObserved,true);assert.ok(task.review);assert.equal(existsSync(snapshot.executionDirectory),false);assert.equal(readFileSync(join(source,'input.txt'),'utf8'),'ORIGINAL');checks++;
 let pending;for(let i=0;i<100;i++){try{pending=await api.executionPropose(workspace.sessionId,'entry-pending','host-pending',proposal(workspace.directory,workspace.revision,'MUST_NOT_RUN'));break;}catch(e){if(!e.message.includes('execution-in-flight-or-unsettled'))throw e;await new Promise(r=>setTimeout(r,20));}}assert.ok(pending,'等待上一执行收束未完成');pendingId=pending.executionId;pendingDirectory=JSON.parse(pending.workspaceSnapshot).executionDirectory;assert.equal(existsSync(pendingDirectory),true);checks++;
}finally{const stopped=await bridge.stop();assert.equal(stopped.forced,false);}
assert.equal(existsSync(pendingDirectory),false);assert.equal(bridge.notifications.find(n=>n.method==='host/settled')?.params.executionSettled,true);checks++;
bridge=mkBridge();let workspace,cancelledId,cancelledDirectory;
try{await bridge.start(sessionRoot);workspace=await bridge.request('workspace/get',{});const pending=await bridge.request('execution/describe',{sessionId:workspace.sessionId,executionId:pendingId});assert.equal(pending.phase,'cancelled-before-start');await assert.rejects(bridge.request('execution/start',{sessionId:workspace.sessionId,executionId:task.executionId,revision:task.revision}),/execution-workspace-unavailable/);checks++;
 const longProposal=JSON.parse(proposal(workspace.directory,workspace.revision,'IGNORED'));
 longProposal.executable=join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
 longProposal.argv=['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from('Start-Sleep -Seconds 4; [IO.File]::WriteAllText("input.txt","MUST_NOT_RUN")','utf16le').toString('base64')];
 const prepared=await bridge.request('execution/propose',{sessionId:workspace.sessionId,taskId:'entry-cancel',requestId:'host-active-eof',proposal:JSON.stringify(longProposal)},15000);cancelledId=prepared.executionId;cancelledDirectory=JSON.parse(prepared.workspaceSnapshot).executionDirectory;
 const ticket=await bridge.request('approval/ask',{name:'execution/start',args:prepared.approvalArguments});await bridge.request('approval/answer',{approvalId:ticket.approvalId,decision:'allowed-once'});
 const admitted=await bridge.request('execution/authorize',{sessionId:workspace.sessionId,executionId:prepared.executionId,revision:prepared.revision,proposalDigest:prepared.proposalDigest,approvalId:ticket.approvalId});
 await bridge.request('execution/start',{sessionId:workspace.sessionId,executionId:prepared.executionId,revision:admitted.revision});
 let running;for(let i=0;i<200;i++){running=await bridge.request('execution/describe',{sessionId:workspace.sessionId,executionId:prepared.executionId});if(running.phase==='running')break;await new Promise(r=>setTimeout(r,10));}assert.equal(running.phase,'running');
}finally{const stopped=await bridge.stop();assert.equal(stopped.forced,false);}
assert.equal(existsSync(cancelledDirectory),false);assert.equal(bridge.notifications.find(n=>n.method==='host/settled')?.params.executionSettled,true);checks++;
bridge=mkBridge();try{await bridge.start(sessionRoot);const cancelled=await bridge.request('execution/describe',{sessionId:workspace.sessionId,executionId:cancelledId});assert.equal(cancelled.phase,'exited');assert.equal(JSON.parse(cancelled.result).cancelObserved,true);assert.equal(readFileSync(join(source,'input.txt'),'utf8'),'ORIGINAL');checks++;}finally{await bridge.stop();}
const cliRun=(request,input)=>spawnSync(cli,['job','run',JSON.stringify({sessionId:workspace.sessionId,taskId:'entry-cli',requestId:request,proposal:proposal(workspace.directory,workspace.revision,'CLI_REAL')})],{cwd:sessionRoot,env,input,encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:1048576});
const refused=cliRun('cli-refuse','n\n');assert.equal(refused.status,1,refused.stderr);assert.match(refused.stderr,/not-authorized/);assert.equal(readFileSync(join(source,'input.txt'),'utf8'),'ORIGINAL');checks++;
const failureProposal=JSON.parse(proposal(workspace.directory,workspace.revision,'IGNORED'));failureProposal.argv=['/d','/s','/c','exit /b 7'];
const failed=spawnSync(cli,['job','run',JSON.stringify({sessionId:workspace.sessionId,taskId:'entry-cli',requestId:'cli-fail',proposal:JSON.stringify(failureProposal)})],{cwd:sessionRoot,env,input:'y\n',encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:1048576});
assert.equal(failed.status,7,failed.stderr);assert.equal(JSON.parse(JSON.parse(failed.stdout).result).exitCode,7);assert.equal(readFileSync(join(source,'input.txt'),'utf8'),'ORIGINAL');checks++;
const accepted=cliRun('cli-run','y\n');assert.equal(accepted.status,0,accepted.stderr);const cliTask=JSON.parse(accepted.stdout);assert.equal(cliTask.phase,'exited');assert.ok(cliTask.review);assert.equal(existsSync(JSON.parse(cliTask.workspaceSnapshot).executionDirectory),false);assert.equal(readFileSync(join(source,'input.txt'),'utf8'),'ORIGINAL');checks++;
bridge=mkBridge();
try{
 await bridge.start(sessionRoot);const review=JSON.parse(task.review);
 const api={executionReviewPrepare:(sessionId,executionId,revision,requestId,paths)=>bridge.request('execution/review-prepare',{sessionId,executionId,revision,requestId,paths}),executionReviewApply:(sessionId,applyId,approvalId)=>bridge.request('execution/review-apply',{sessionId,applyId,approvalId}),executionReviewApplyDescribe:(sessionId,applyId)=>bridge.request('execution/review-apply-describe',{sessionId,applyId}),executionReviewApplyStop:(sessionId,applyId)=>bridge.request('execution/review-apply-stop',{sessionId,applyId}),approvalAsk:(name,args)=>bridge.request('approval/ask',{name,args}),approvalAnswer:(approvalId,decision)=>bridge.request('approval/answer',{approvalId,decision})};
 const write=createReviewWriteback(api,()=>workspace.sessionId,()=>{});await write.prepare(task,review,['input.txt']);assert.equal(write.state.error,'');assert.equal(readFileSync(join(source,'input.txt'),'utf8'),'ORIGINAL');await write.approve();assert.equal(write.state.error,'');
 for(let i=0;i<100&&write.state.status?.phase==='applying';i++){await new Promise(r=>setTimeout(r,20));await write.refresh();}
 assert.equal(write.state.status.phase,'completed');assert.match(readFileSync(join(source,'input.txt'),'utf8'),/^HOST_REAL/);checks++;
}finally{await bridge.stop();}
const depot=join(data,'SaCode/execution-workspaces/v1');assert.equal(readdirSync(depot).filter(n=>n.startsWith('sacode-workspace-job-')).length,0);checks++;
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');const report={passed:true,checks,colocated,hostSha256:sha(host),cliSha256:sha(cli),executionId:task.executionId,cliExecutionId:cliTask.executionId,source,scope:'真实页面状态层→有限IPC→默认Host准备/审批/执行/审查/写回；CLI job run独立确认；非完整Electron或安装态'};writeFileSync(join(root,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,evidence:root}));
