import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fixtureHostEnv} from './fixture-env.mjs';
const require=createRequire(import.meta.url);
const {HostBridge}=require('../host-bridge.cjs');
const exe=resolve(process.env.SACODE_HOST||'apps/desktop/.tmp-test/lsp-l1-packed/bin/sacode-host.exe');
if(!existsSync(exe))throw Error('必须指定本轮重新构建的 Host');
const base=resolve('apps/desktop/.tmp-test');mkdirSync(base,{recursive:true});
const root=mkdtempSync(join(base,'execution-host-'));
writeFileSync(join(root,'session.log'),`0\tworkspace/directory\t${root.replaceAll('\\','\\\\')}\n`);
const env=fixtureHostEnv(root,{PATH:join(process.env.SystemRoot,'System32'),TEMP:root,TMP:root});
const results=[];let b;
async function boot(){b=new HostBridge(exe,env);await b.start(root);}
async function call(method,params){
 try{const result=await b.request(method,params);results.push({method,params,result});return result;}
 catch(e){results.push({method,params,error:e.message});throw e;}
}
try{
 await boot();
 const init=await call('initialize',{});
 for(const verb of ['propose','authorize','start','describe','output','stop'])assert.ok(init.capabilities.includes('execution/'+verb));
 const proposal=JSON.stringify({cwd:root.replaceAll('\\','/'),workspaceRevision:1,executable:'cmd',argv:['/c','echo forbidden > must-not-exist.txt'],timeoutMs:1000,outputLimit:64});
 const params={sessionId:'current',taskId:'task-1',requestId:'request-1',proposal};
 const state=await call('execution/propose',params);assert.equal(state.phase,'awaiting-approval');assert.equal(state.proposal,proposal);
 assert.equal((await call('execution/propose',params)).executionId,state.executionId);
 await assert.rejects(call('execution/propose',{...params,proposal:proposal+' '}),/request-conflict/);
 const identity={sessionId:'current',executionId:state.executionId};
 await assert.rejects(call('execution/describe',{...identity,sessionId:'other'}),/execution-session-changed/);
 await assert.rejects(call('execution/describe',{...identity,extra:true}),/bad-execution-arguments/);
 const ticket=await call('approval/ask',{name:'execution/start',args:state.approvalArguments});
 assert.equal((await call('approval/answer',{approvalId:ticket.approvalId,decision:'allowed-once'})).accepted,true);
 const authorization={...identity,revision:state.revision,proposalDigest:state.proposalDigest,approvalId:ticket.approvalId};
 await assert.rejects(call('execution/authorize',{...authorization,proposalDigest:'0'.repeat(64)}),/approval-mismatch/);
 const admitted=await call('execution/authorize',authorization);assert.equal(admitted.phase,'admitted');
 await assert.rejects(call('execution/authorize',authorization),/not-authorized/);
 await assert.rejects(call('execution/start',{...identity,revision:admitted.revision}),/execution-provider-unverified/);
 assert.equal((await call('execution/describe',identity)).phase,'admitted');
 assert.deepEqual((await call('execution/output',{...identity,cursor:-1,limit:16})).records,[]);
 assert.equal((await b.stop()).code,0);
 await boot();
 // 读面不恢复授权；首次写动作必须恢复准入状态，不能继承进程内许可。
 const restored=await call('execution/propose',params);assert.equal(restored.phase,'awaiting-approval');assert.ok(restored.revision>admitted.revision);
 await assert.rejects(call('execution/authorize',{...authorization,revision:restored.revision}),/not-authorized/);
 await assert.rejects(call('execution/stop',{...identity,revision:admitted.revision}),/revision-conflict/);
 const stopped=await call('execution/stop',{...identity,revision:restored.revision});assert.equal(stopped.phase,'cancelled-before-start');
 assert.equal((await call('execution/describe',identity)).phase,'cancelled-before-start');
 assert.ok(!existsSync(join(root,'must-not-exist.txt')));
 assert.ok(!readFileSync(join(root,'session.log'),'utf8').includes('owned-subprocess:'));
 console.log('EXECUTION_HOST_PASS：六动作、精确审批、去重、恢复、旧修订拒绝；无 SDK PATH；未执行命令');
}finally{
 if(b)await b.stop();
 writeFileSync(join(root,'results.json'),JSON.stringify(results,null,2));
 console.log('EXECUTION_HOST_EVIDENCE='+root);
}
