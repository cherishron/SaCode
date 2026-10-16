import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {Buffer} from 'node:buffer';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const entry=fileURLToPath(new URL('../renderer/pages/execution-artifacts-state.ts',import.meta.url));
const bundle=await build({entryPoints:[entry],bundle:true,write:false,format:'cjs'});
const context={module:{exports:{}},TextDecoder,atob:value=>Buffer.from(value,'base64').toString('binary')};
vm.runInNewContext(bundle.outputFiles[0].text,context);
const {createExecutionArtifacts}=context.module.exports;

const facts=(overrides={})=>JSON.stringify({exitObserved:true,exitCode:0,timedOut:false,cancelObserved:false,outputComplete:true,processSucceeded:true,stdoutTruncated:false,stderrTruncated:false,...overrides});
const proposal=JSON.stringify({cwd:'D:/workspace',workspaceRevision:4,executable:'cjpm',argv:['test'],timeoutMs:30000,outputLimit:4096});
const snapshot=(overrides={})=>({sessionId:'s1',executionId:'execution-1',taskId:'task-1',requestId:'request-1',proposal,proposalDigest:'a'.repeat(64),revision:5,phase:'exited',result:facts(),providerAvailable:true,...overrides});
const row=()=>({sessionId:'s1',executionId:'execution-1',taskId:'task-1',requestId:'request-1',revision:5,phase:'exited'});
const listPage=(records=[row()],nextCursor=records.length-1,hasMore=false)=>({version:1,sessionId:'s1',source:'durable-history',records,nextCursor,hasMore});
function outputRecord(channel,cursor,sequence,text='',end=false,eof=false,truncated=false){
 const data=Buffer.from(text,'utf8');
 return{version:1,sessionId:'s1',executionId:'execution-1',channel,cursor,streamSequence:sequence,data:data.toString('base64'),byteCount:data.length,endOfCapture:end,eof,truncated};
}
const reportOutput=(text='TOTAL: 2 / PASSED: 2 / SKIPPED: 0 / ERROR: 0 / FAILED: 0\n',eof=true)=>({
 sessionId:'s1',executionId:'execution-1',revision:5,phase:'exited',records:[
  outputRecord('stdout',0,1,text),outputRecord('stdout',1,2,'',true,eof),outputRecord('stderr',2,1,'',true,eof),
 ],nextCursor:2,hasMore:false,
});
function fixture(extra={}){
 const calls=[];let record=snapshot();
 const api={
  executionList:async(...args)=>{calls.push(['list',...args]);return listPage();},
  executionDescribe:async(...args)=>{calls.push(['describe',...args]);return record;},
  executionOutput:async(...args)=>{calls.push(['output',...args]);return reportOutput();},
  executionPropose:async()=>{calls.push(['propose']);throw Error('must not propose');},
  executionAuthorize:async()=>{calls.push(['authorize']);throw Error('must not authorize');},
  executionStart:async()=>{calls.push(['start']);throw Error('must not start');},
  executionStop:async()=>{calls.push(['stop']);throw Error('must not stop');},
  approvalAsk:async()=>{calls.push(['approvalAsk']);throw Error('must not ask approval');},
  approvalAnswer:async()=>{calls.push(['approvalAnswer']);throw Error('must not answer approval');},
  workspaceGet:async()=>{throw Error('must not read workspace');},
  ...extra,
 };
 const view=createExecutionArtifacts(api,()=> 's1',()=>{});
 return{view,calls,setRecord:value=>{record=value;}};
}

test('从持久执行记录重建构建测试报告，并显示源输出与退出身份',async()=>{
 const f=fixture();await f.view.load();assert.equal(f.view.state.rows.length,1);await f.view.open('execution-1');
 assert.equal(f.view.state.report.status,'passed');assert.equal(f.view.state.report.kind,'test');
 assert.equal(f.view.state.report.summary.total,2);assert.match(f.view.state.stdout,/TOTAL: 2/);
 assert.equal(f.view.state.capture.stdout.eof,true);assert.equal(f.view.state.capture.stderr.eof,true);
 assert.deepEqual(f.calls.map(call=>call[0]),['list','describe','output','describe']);
 assert.equal(f.calls.some(call=>['propose','authorize','start','stop','approvalAsk','approvalAnswer'].includes(call[0])),false);
});

test('输出尾帧没有 EOF 时不把零退出码误判为通过',async()=>{
 const f=fixture({executionOutput:async()=>reportOutput(undefined,false)});await f.view.load();await f.view.open('execution-1');
 assert.equal(f.view.state.report.status,'incomplete');assert.equal(f.view.state.report.reason,'output-not-complete');
});

test('读取期间执行修订变化时拒绝生成旧摘要',async()=>{
 const f=fixture({executionOutput:async()=>({...reportOutput(),revision:6})});await f.view.load();await f.view.open('execution-1');
 assert.match(f.view.state.error,/发生变化/);assert.equal(f.view.state.report,null);assert.equal(f.view.state.detail,null);
});

test('切换会话后迟到的列表响应不覆盖新会话',async()=>{
 let session='s1',resolve;const view=createExecutionArtifacts({executionList:()=>new Promise(done=>resolve=done)},()=>session,()=>{});
 const pending=view.load();session='s2';view.reset();resolve(listPage());await pending;
 assert.equal(view.state.rows.length,0);assert.equal(view.state.loaded,false);view.dispose();
});

test('产物标签只在真实页面和工作台注册表都接好后开放',()=>{
 const tabs=readFileSync(new URL('../renderer/pages/workbench-tabs.ts',import.meta.url),'utf8');
 const slots=readFileSync(new URL('../renderer/pages/client-slots.ts',import.meta.url),'utf8');
 const app=readFileSync(new URL('../renderer/app.js',import.meta.url),'utf8');
 assert.match(tabs,/id:'artifacts',label:'产物'.*available:true/);
 assert.match(slots,/export \{ArtifactsPage\} from '\.\/artifacts-page'/);
 assert.match(app,/SaCodeSlots\.ArtifactsPage/);assert.match(app,/id:'side-page-artifacts'/);
});
