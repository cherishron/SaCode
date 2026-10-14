import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const {HostBridge}=createRequire(import.meta.url)('../host-bridge.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFile(path){for(let i=0;i<500;i++){if(existsSync(path))return;await pause(20);}throw Error('fixture-not-started');}
function alive(pid){try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}}
async function fixture(t){
 assert.ok(process.env.SACODE_HOST,'需要本批Host');
 const root=mkdtempSync(join(tmpdir(),'sacode-acp-async-'));
 // Node 将固定 acp 参数作为脚本名；夹具只记录协议，不连接模型、不访问用户配置。
 writeFileSync(join(root,'acp'),"const fs=require('node:fs');setTimeout(()=>process.exit(0),15000);require('node:readline').createInterface({input:process.stdin}).on('line',s=>{const q=JSON.parse(s);fs.writeFileSync('probe-pid',String(process.pid));fs.appendFileSync('probe-methods',q.method+'\\n');});");
 const bridge=new HostBridge(process.env.SACODE_HOST,{...process.env,SACODE_ACP_OPENCODE_EXECUTABLE:process.execPath,SACODE_USER_SETTINGS_DIR:join(root,'settings')});
 await bridge.start(root);t.after(()=>bridge.stop(12000));
 await bridge.request('workspace/set-directory',{sessionId:'current',directory:root});
 await bridge.request('acp/settings/set-enabled',{sessionId:'current',enabled:true,revision:0});
 const pending=bridge.request('acp/provider/probe',{sessionId:'current'},30000);pending.catch(()=>{});
 await waitFile(join(root,'probe-pid'));
 return {root,bridge,pending,pid:Number(readFileSync(join(root,'probe-pid'),'utf8'))};
}

test('挂起的ACP探测不阻塞Host，单飞去重且关闭开关取消并回收进程',{timeout:40000},async t=>{
 const {root,bridge,pending,pid}=await fixture(t);
 assert.equal(alive(pid),true);
 const hello=await bridge.request('initialize',{},2000);assert.ok(hello.capabilities.includes('acp/provider/probe'));
 await assert.rejects(bridge.request('acp/provider/probe',{sessionId:'current'},2000),/acp-probe-in-flight/);
 const disabled=await bridge.request('acp/settings/set-enabled',{sessionId:'current',enabled:false,revision:1},2000);
 assert.equal(disabled.enabled,false);
 const report=await pending;assert.equal(report.protocolReady,false);assert.match(report.evidence,/probe-cancelled/);
 assert.equal(alive(pid),false);assert.equal(readFileSync(join(root,'probe-methods'),'utf8'),'initialize\n');
 await assert.rejects(bridge.request('acp/provider/probe',{sessionId:'current'},2000),/acp-disabled/);
 assert.equal((await bridge.stop(10000)).forced,false);
});

test('Host EOF取消挂起诊断并等待子进程退出，不以父进程退出冒充收束',{timeout:30000},async t=>{
 const {bridge,pending,pid}=await fixture(t);
 const stopped=await bridge.stop(10000);assert.equal(stopped.forced,false);
 const report=await pending;assert.match(report.evidence,/probe-cancelled/);assert.equal(alive(pid),false);
 assert.equal(report.diagnosticSaved,false);
});

test('切工作区取消旧诊断，迟到回包不改变新工作区',{timeout:30000},async t=>{
 const {root,bridge,pending,pid}=await fixture(t);
 const next=mkdtempSync(join(tmpdir(),'sacode-acp-next-'));
 await bridge.request('workspace/set-directory',{sessionId:'current',directory:next},2000);
 const report=await pending;assert.match(report.evidence,/probe-cancelled/);assert.equal(alive(pid),false);
 assert.equal(report.diagnosticSaved,false);
 const workspace=await bridge.request('workspace/get',{sessionId:'current'},2000);
 assert.equal(workspace.directory,next);assert.equal(readFileSync(join(root,'probe-methods'),'utf8'),'initialize\n');
});

test('取消后重新开启可再次诊断，不复用旧取消令牌或发送模型任务',{timeout:30000},async t=>{
 const {root,bridge,pending,pid}=await fixture(t);
 await bridge.request('acp/settings/set-enabled',{sessionId:'current',enabled:false,revision:1});
 await pending;assert.equal(alive(pid),false);
 writeFileSync(join(root,'acp'),"require('node:readline').createInterface({input:process.stdin}).on('line',s=>{const q=JSON.parse(s);let result;if(q.method==='initialize')result={protocolVersion:1,agentCapabilities:{},agentInfo:{name:'OpenCode fixture',version:'2.fixture'}};else if(q.method==='session/new')result={sessionId:'reopened-probe',configOptions:[{id:'model',name:'Model',category:'model',type:'select',currentValue:'fixture-free-name',options:[]}]};else throw Error('no-task-allowed');console.log(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));});");
 await bridge.request('acp/settings/set-enabled',{sessionId:'current',enabled:true,revision:2});
 const report=await bridge.request('acp/provider/probe',{sessionId:'current'},30000);
 assert.equal(report.protocolReady,true);assert.equal(report.modelTaskTested,false);assert.equal(report.verdict,'measured');
 assert.equal(report.diagnostics.agentVersion,'2.fixture');assert.equal(report.diagnostics.sessionModel,'fixture-free-name');assert.equal(report.diagnostics.price,'unknown');assert.equal(report.diagnostics.workspace,root);assert.ok(['low','medium','high','system','untrusted'].includes(report.diagnostics.processIntegrity));
 const history=await bridge.request('acp/diagnostics/describe',{sessionId:'current'});
 assert.equal(history.source,'durable-history');assert.equal(history.scopeCurrent,true);assert.equal(history.record.diagnosticId,report.diagnostics.diagnosticId);
 const params={sessionId:'current',diagnosticId:history.record.diagnosticId,revision:history.record.revision};
 const kept=await bridge.request('acp/diagnostics/keep',params);assert.equal(kept.record.decision,'kept');
 assert.deepEqual(await bridge.request('acp/diagnostics/keep',params),kept);
 await bridge.request('acp/settings/set-enabled',{sessionId:'current',enabled:false,revision:3});
 assert.equal((await bridge.request('acp/diagnostics/describe',{sessionId:'current'})).scopeCurrent,false);
 await assert.rejects(bridge.request('acp/diagnostics/keep',params),/revision-conflict/);
 assert.equal((await bridge.stop(10000)).forced,false);
 const restored=new HostBridge(process.env.SACODE_HOST,{...process.env,SACODE_USER_SETTINGS_DIR:join(root,'settings')});
 await restored.start(root);t.after(()=>restored.stop());
 assert.equal((await restored.request('acp/diagnostics/describe',{sessionId:'current'})).record.decision,'kept');
 assert.equal((await restored.stop(10000)).forced,false);
});
