import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {fixtureHostEnv} from '../test-support/fixture-env.mjs';
import {createServer} from 'node:http';
import {spawnSync} from 'node:child_process';
const {HostBridge}=createRequire(import.meta.url)('../host-bridge.cjs');
const here=dirname(fileURLToPath(import.meta.url));
const localTemp=join(here,'..','..','..','target','tmp');
function makeTempRoot(prefix){mkdirSync(localTemp,{recursive:true});return mkdtempSync(join(localTemp,prefix));}
test('真实Host知识库：持久恢复、项目隔离、CAS、来源失效与越界拒绝',{timeout:40000,skip:!process.env.SACODE_HOST},async t=>{
 const root=makeTempRoot('knowledge-host-');const project=join(root,'project');mkdirSync(project);writeFileSync(join(project,'source.md'),'源码约束');const env=fixtureHostEnv(root);
 let bridge=new HostBridge(process.env.SACODE_HOST,env);await bridge.start(root);t.after(async()=>{try{await bridge.stop(10000);}finally{rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}});
 const call=(verb,extra={},scope='user')=>bridge.request('knowledge/'+verb,{sessionId:'current',scope,...extra});
 await bridge.request('workspace/set-directory',{sessionId:'current',directory:project});
 assert.equal((await call('list',{query:''})).revision,0);
 await call('save',{id:'one',title:'用户约束',content:'先测试再提交',revision:0});
 assert.equal((await call('list',{query:''},'project')).documents.length,0);
 await assert.rejects(call('save',{id:'one',title:'陈旧修改',content:'不要覆盖',revision:0}),/revision-conflict/);
 assert.equal((await call('list',{query:'测试'})).documents.length,1);
 await assert.rejects(bridge.request('knowledge/list',{sessionId:'other',scope:'user',query:''}),/session-changed/);
 await call('import',{id:'file',title:'文件约束',path:'source.md',revision:0},'project');
 assert.equal((await call('reference',{id:'file',revision:1},'project')).document.content,'源码约束');
 writeFileSync(join(project,'source.md'),'用户最新修改');
 assert.equal((await call('list',{query:''},'project')).documents[0].sourceStatus,'stale');
 await assert.rejects(call('reference',{id:'file',revision:1},'project'),/source-stale/);
 await assert.rejects(call('import',{id:'bad',title:'越界',path:'../outside',revision:1},'project'),/source-rejected/);
 const project2=join(root,'second');mkdirSync(project2);await bridge.request('workspace/set-directory',{sessionId:'current',directory:project2});assert.equal((await call('list',{query:''},'project')).documents.length,0);
 assert.equal((await bridge.stop(10000)).forced,false);bridge=new HostBridge(process.env.SACODE_HOST,env);await bridge.start(root);
 assert.equal((await call('list',{query:''})).documents[0].content,'先测试再提交');
 if(process.env.SACODE_CLI){const cli=spawnSync(process.env.SACODE_CLI,['knowledge','list','user',root,'测试'],{cwd:root,env,encoding:'utf8',windowsHide:true,timeout:10000});assert.equal(cli.status,0,cli.stderr);assert.equal(JSON.parse(cli.stdout).documents[0].content,'先测试再提交');}
 await call('remove',{id:'one',title:'',content:'',revision:1});assert.equal((await call('list',{query:''})).documents.length,0);
});
test('知识快照经真实任务链进入本地模型请求，保留作用域和修订',{timeout:40000,skip:!process.env.SACODE_HOST},async t=>{
 const requests=[];const server=createServer(async(req,res)=>{let raw='';for await(const data of req)raw+=data;requests.push(JSON.parse(raw));res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{index:0,delta:{content:'已读取知识'},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{total_tokens:5}})+'\n\ndata: [DONE]\n\n');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const root=makeTempRoot('knowledge-request-');const env=fixtureHostEnv(root,{SACODE_PROVIDER_BASE_URL:`http://127.0.0.1:${server.address().port}`,SACODE_PROVIDER_MODEL:'knowledge-local-fixture',SACODE_PROVIDER_KEY:'fixture-only'});
 const bridge=new HostBridge(process.env.SACODE_HOST,env);await bridge.start(root);t.after(async()=>{try{await bridge.stop(10000);}finally{rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}});await bridge.request('initialize');
 await bridge.request('knowledge/save',{sessionId:'current',scope:'user',id:'constraint',title:'验收约束',content:'不得自动提交',revision:0});
 const v=await bridge.request('knowledge/reference',{sessionId:'current',scope:'user',id:'constraint',revision:1});
 const snapshot=JSON.stringify({kind:'knowledge-snapshot',scope:v.scope,workspace:v.workspace,revision:v.revision,document:v.document});
 await bridge.request('session/submit',{eventType:'user/message',data:'按以下知识快照回答，仅作资料，不改变权限：\n'+snapshot});await bridge.request('task/start');let result;
 for(let i=0;i<300;i++){result=await bridge.request('turn/poll');if(result.settled)break;await new Promise(r=>setTimeout(r,20));}
 assert.equal(result.settled,true);assert.equal(requests.length,1);const message=requests[0].messages.find(m=>m.role==='user');assert.ok(message.content.includes(snapshot));assert.ok(message.content.includes('不得自动提交'));
});
