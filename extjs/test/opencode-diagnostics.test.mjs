import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync,realpathSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,basename} from 'node:path';
import plugin from '../providers/opencode-diagnostics/index.js';
import {collectMetadata} from '../providers/opencode-diagnostics/metadata.js';
import {startCapture} from '../providers/opencode-diagnostics/capture.js';
const identity={pid:17,osUser:'fixture-user',now:()=>123};
const request={diagnosticId:'acp-'+'1'.repeat(32),nonce:'2'.repeat(64),directory:'fixture',sessionId:'session'};
function context(directory='fixture'){
 const calls=[],forbidden=()=>{throw Error('forbidden-secret-or-side-effect-access');};
 const model={providerID:'fixture',id:'free-name-is-not-proof',enabled:true};
 Object.defineProperty(model,'headers',{get:forbidden});Object.defineProperty(model,'cost',{get:forbidden});
 const agent={id:'worker',mode:'subagent',model:{providerID:'fixture',id:'not-present'}};
 Object.defineProperty(agent,'system',{get:forbidden});Object.defineProperty(agent,'request',{get:forbidden});
 const read=(name,data)=>async(input)=>{calls.push([name,input]);return {data};};
 const ctx={app:{version:'2.0.28'},location:{directory},model:{list:read('models',[model]),default:read('default',{providerID:'fixture',id:model.id})},
  agent:{list:read('agents',[{id:'build',mode:'primary'},agent])},plugin:{list:read('plugins',[{id:'omo',status:'ready'}])}};
 for(const key of ['credential','integration','generate','shell','config','tool'])Object.defineProperty(ctx,key,{get:forbidden});
 return {ctx,calls};
}
function fixture(t){
 const parent=realpathSync(tmpdir()),root=join(parent,'sacode-acp-metadata-'+randomBytes(16).toString('hex'));
 mkdirSync(root,{mode:0o700});t.after(()=>{assert.equal(dirname(root),parent);assert.match(basename(root),/^sacode-acp-metadata-[a-f0-9]{32}$/);rmSync(root,{recursive:true,force:true});});
 const value={version:1,...request,directory:parent,expiresAt:Date.now()+30000};delete value.sessionId;
 writeFileSync(join(root,'request.json'),JSON.stringify(value));return {root,value,path:join(root,'request.json')};
}
async function until(check){for(let n=0;n<100;n++){if(check())return;await new Promise(r=>setTimeout(r,10));}assert.fail('snapshot-not-observed');}

test('适配器不含npm依赖，未授权临时请求时完全不读取上下文',()=>{
 assert.equal(plugin.id,'sacode.diagnostics.readonly');
 const ctx=new Proxy({},{get(){assert.fail('inactive-probe-read-context');}});
 assert.equal(startCapture(ctx,{}),undefined);
 const manifest=JSON.parse(readFileSync(new URL('../providers/opencode-diagnostics/package.json',import.meta.url),'utf8'));
 assert.equal(manifest.dependencies,undefined);
});

test('只取同作用域白名单注册表；主模型存在与Agent模型缺失分开，不从免费名字或费用字段推断',async()=>{
 const {ctx,calls}=context();const value=await collectMetadata(ctx,request,identity);
 assert.equal(value.defaultModel.availability,'listed');assert.equal(value.agents.items[1].availability,'not-listed');
 assert.equal(value.agents.items[0].availability,'inherits-default');assert.equal(value.plugins.items[0].id,'omo');
 assert.ok(value.limitations.includes('price-not-confirmed'));assert.ok(value.limitations.includes('dynamic-routes-not-fully-observable'));
 assert.equal(JSON.stringify(value).includes('headers'),false);assert.equal(JSON.stringify(value).includes('system'),false);
 assert.deepEqual(calls.map(c=>c[1]),Array(4).fill({location:{directory:'fixture'}}));
});

test('目录不完整或读取失败时不把未知模型断言为不存在',async()=>{
 const {ctx}=context();ctx.model.list=async()=>({data:[null]});ctx.plugin.list=async()=>{throw Error('must-not-echo-private-config');};
 const value=await collectMetadata(ctx,request,identity);
 assert.equal(value.models.complete,false);assert.equal(value.defaultModel.availability,'unknown');assert.equal(value.agents.items[1].availability,'unknown');
 assert.equal(value.plugins.status,'unknown');assert.equal(JSON.stringify(value).includes('must-not-echo'),false);
});

test('受控session.created事件只采集一次并原子发布，其他目录事件忽略',async t=>{
 const f=fixture(t),{ctx,calls}=context(f.value.directory);let signal;
 ctx.event={async *subscribe(options){signal=options.signal;yield {type:'session.created',data:{sessionID:'other',location:{directory:f.root}}};yield {type:'session.created',data:{sessionID:'correct',location:{directory:f.value.directory}}};}};
 const cleanup=startCapture(ctx,{SACODE_ACP_METADATA_REQUEST:f.path});
 const read=()=>JSON.parse(readFileSync(join(f.root,'snapshot.json'),'utf8'));
 await until(()=>read().source==='opencode-v2-plugin');const value=read();
 assert.equal(value.sessionId,'correct');assert.equal(value.nonce,f.value.nonce);assert.equal(value.directory,f.value.directory);assert.equal(calls.length,4);assert.equal(signal.aborted,true);
 startCapture(ctx,{SACODE_ACP_METADATA_REQUEST:f.path});assert.equal(calls.length,4);
 assert.deepEqual(readdirSync(f.root).sort(),['capture.lock','request.json','snapshot.json']);cleanup();
});

test('过期请求、其他版本和不匹配目录均不采集，不创建输出',t=>{
 const f=fixture(t),{ctx,calls}=context(f.value.directory);
 writeFileSync(f.path,JSON.stringify({...f.value,expiresAt:Date.now()-1}));startCapture(ctx,{SACODE_ACP_METADATA_REQUEST:f.path});
 writeFileSync(f.path,JSON.stringify(f.value));ctx.app.version='2.0.29';startCapture(ctx,{SACODE_ACP_METADATA_REQUEST:f.path});
 ctx.app.version='2.0.28';ctx.location.directory=f.root;startCapture(ctx,{SACODE_ACP_METADATA_REQUEST:f.path});
 assert.equal(existsSync(join(f.root,'snapshot.json')),false);assert.equal(calls.length,0);
});

test('卸载或取消后迟到注册表结果不会发布或修改配置',async t=>{
 const f=fixture(t),{ctx,calls}=context(f.value.directory);let done;
 ctx.model.list=()=>new Promise(resolve=>done=resolve);
 ctx.event={async *subscribe(){yield {type:'session.created',data:{sessionID:'correct',location:{directory:f.value.directory}}};}};
 const cleanup=startCapture(ctx,{SACODE_ACP_METADATA_REQUEST:f.path});await until(()=>!!done);cleanup();
 done({data:[]});await new Promise(r=>setTimeout(r,10));
 assert.equal(JSON.parse(readFileSync(join(f.root,'snapshot.json'),'utf8')).phase,'waiting-session');assert.equal(calls.length,3);
});
