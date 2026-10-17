// 真实Node测试→有限IPC→当前Host；没有输出摘要或执行日志夹具。
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {randomUUID,createHash} from 'node:crypto';
import {build} from 'esbuild';
import vm from 'node:vm';
import {fixtureHostEnv} from './fixture-env.mjs';
import {buildTestReport} from '../renderer/pages/build-test-report.mjs';
const require=createRequire(import.meta.url),{HostBridge}=require('../host-bridge.cjs'),{registerExecutionIpc}=require('../execution-ipc.cjs');
const host=resolve(process.argv[2]),tool=process.argv[3]||'node';
const root=mkdtempSync(fileURLToPath(new URL('../../../target/tmp/build-test-host-',import.meta.url))),project=join(root,'project'),data=join(root,'appdata');mkdirSync(project);mkdirSync(data);
writeFileSync(join(project,'task.test.mjs'),"import test from 'node:test';import assert from 'node:assert/strict';test('真实用例',()=>assert.equal(2+2,4));\n");
const bridge=new HostBridge(host,fixtureHostEnv(root,{LOCALAPPDATA:data,TMP:root,TEMP:root,SACODE_WINDOWS_ENFORCING:'',SACODE_WINDOWS_PROCESS_DLL:''}));
const bundled=await build({entryPoints:[fileURLToPath(new URL('../renderer/pages/execution-task-state.ts',import.meta.url))],bundle:true,write:false,format:'cjs'}),context={module:{exports:{}},atob,TextDecoder,globalThis:{crypto:{randomUUID}}};vm.runInNewContext(bundled.outputFiles[0].text,context);
let view,report,error='',stopped;
try{
 await bridge.start(project);await bridge.request('workspace/set-directory',{directory:project});const workspace=await bridge.request('workspace/get',{});const handlers=new Map();registerExecutionIpc({handle:(name,action)=>handlers.set(name,action)},(method,args)=>bridge.request(method,args,15000));
 const fields={executionPropose:['sessionId','taskId','requestId','proposal'],executionAuthorize:['sessionId','executionId','revision','proposalDigest','approvalId'],executionStart:['sessionId','executionId','revision'],executionDescribe:['sessionId','executionId'],executionOutput:['sessionId','executionId','cursor','limit'],executionStop:['sessionId','executionId','revision']};
 const api=Object.fromEntries(Object.entries(fields).map(([name,keys])=>[name,(...args)=>handlers.get('sacode:'+name)({},Object.fromEntries(keys.map((k,i)=>[k,args[i]])))]));api.workspaceGet=()=>bridge.request('workspace/get',{});api.approvalAsk=(name,args)=>bridge.request('approval/ask',{name,args});api.approvalAnswer=(approvalId,decision)=>bridge.request('approval/answer',{approvalId,decision});
 view=context.module.exports.createExecutionTask(api,()=>workspace.sessionId,()=>{});
 await view.propose('real-tests',randomUUID(),JSON.stringify({cwd:workspace.directory,workspaceRevision:workspace.revision,executable:tool,argv:['--test','task.test.mjs'],timeoutMs:10000,outputLimit:16384}));assert.equal(view.state.error,'');await view.approve();assert.equal(view.state.error,'');await view.start();assert.equal(view.state.error,'');
 for(let i=0;i<250;i++){await view.describe(view.state.task.executionId);assert.equal(view.state.error,'');if(['exited','unknown'].includes(view.state.task.phase))break;await new Promise(r=>setTimeout(r,20));}
 for(let i=0;i<100;i++){await view.output();assert.equal(view.state.error,'');if(!view.state.more)break;}
 report=buildTestReport(view.state.task,view.state);assert.equal(report.status,'passed',JSON.stringify(report));assert.equal(report.summary.total,1);assert.equal(report.summary.passed,1);
}catch(e){error=e.message;}finally{stopped=await bridge.stop();}
const evidence={passed:!error&&!stopped.forced,tool,report,error,task:view?.state.task,stdout:view?.state.stdout,stderr:view?.state.stderr,capture:view?.state.capture,stopped,hostSha256:createHash('sha256').update(readFileSync(host)).digest('hex'),scope:'真实测试进程与页面状态层→有限IPC→Host；非完整Electron'};
writeFileSync(join(root,'verification.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({...evidence,evidence:root}));if(!evidence.passed)process.exitCode=1;
