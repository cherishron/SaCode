// 显式消费真实执行夹具留下的日志与对象，不构造 execution/state 或伪造审查结果。
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,mkdirSync,mkdtempSync,copyFileSync,existsSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import vm from 'node:vm';
import {fixtureHostEnv} from './fixture-env.mjs';
const require=createRequire(import.meta.url),{HostBridge}=require('../host-bridge.cjs');
const {registerExecutionIpc}=require('../execution-ipc.cjs');
const [runtimeDirectory,hostPath]=process.argv.slice(2).map(value=>resolve(value));
assert.ok(runtimeDirectory&&hostPath,'需要真实任务 runtime-temp 与本轮 Host 路径');
const source=readdirSync(runtimeDirectory).filter(n=>/^private-task-.*\.log$/.test(n)).map(n=>join(runtimeDirectory,n)).find(p=>{const text=readFileSync(p,'utf8');return text.includes('\texecution/review\t')&&!text.includes('\texecution/review-apply-');});
assert.ok(source,'缺少真实任务审查事件，不能使用空夹具');
const unescape=s=>s.replace(/\\([\\nrt])/g,(_,c)=>({'\\':'\\',n:'\n',r:'\r',t:'\t'}[c]));
const rows=readFileSync(source,'utf8').trimEnd().split('\n').map(l=>l.replace(/\r$/,'').split('\t'));
const persisted=rows.filter(r=>r[1]==='execution/review');assert.equal(persisted.length,1);
const expected=JSON.parse(unescape(persisted[0][2]));assert.equal(expected.sessionId,'current');assert.equal(expected.files.length,3);
const sha=b=>createHash('sha256').update(b).digest('hex');
for(const row of expected.files){
 for(const side of ['before','after'])if(row[side+'Object'])assert.equal(sha(readFileSync(join(source+'.objects',row[side+'Digest']))),row[side+'Digest']);
 const original=join(expected.sourceDirectory,row.path);
 if(row.kind==='added')assert.equal(existsSync(original),false);else assert.equal(sha(readFileSync(original)),row.beforeDigest);
}
const base=fileURLToPath(new URL('../../../target/tmp/',import.meta.url));mkdirSync(base,{recursive:true});
const root=mkdtempSync(join(base,'task-review-host-'));copyFileSync(source,join(root,'session.log'));
mkdirSync(join(root,'attachments/v1'),{recursive:true});
for(const name of readdirSync(source+'.objects'))copyFileSync(join(source+'.objects',name),join(root,'attachments/v1',name));
const bridge=new HostBridge(hostPath,fixtureHostEnv(root,{TEMP:root,TMP:root}));
let outcome;
try{
 await bridge.start(root);
 const actual=await bridge.request('execution/describe',{sessionId:'current',executionId:expected.executionId});
 assert.deepEqual(JSON.parse(actual.review),expected);assert.equal(actual.phase,'exited');assert.equal(actual.approvalArguments,undefined);
 await assert.rejects(bridge.request('execution/describe',{sessionId:'other',executionId:expected.executionId}));
 for(const row of expected.files)for(const side of ['before','after']){
  const reply=await bridge.request('execution/review-file',{sessionId:'current',executionId:expected.executionId,revision:actual.revision,path:row.path,side});
  assert.equal(reply.sha256,row[side+'Digest']);assert.equal(reply.exists,!!row[side+'Object']);
  const raw=Buffer.from(reply.data,'base64');assert.equal(raw.length,reply.returnedBytes);
  if(row[side+'Object']){const full=readFileSync(join(source+'.objects',row[side+'Digest']));assert.deepEqual(raw,full.subarray(0,65536));assert.equal(reply.totalBytes,full.length);assert.equal(reply.truncated,full.length>65536);}
 }
 for(const extra of [{path:'../secret',side:'before',revision:actual.revision},{path:expected.files[0].path,side:'after',revision:actual.revision+1},{path:expected.files[0].path,side:'other',revision:actual.revision}])await assert.rejects(bridge.request('execution/review-file',{sessionId:'current',executionId:expected.executionId,...extra}));
 const target=expected.files.find(r=>r.afterObject);
 const objectPath=join(root,'attachments/v1',target.afterDigest),original=readFileSync(objectPath);
 writeFileSync(objectPath,Buffer.from('CORRUPT_PRIVATE_FIXTURE'));
 try{await assert.rejects(bridge.request('execution/review-file',{sessionId:'current',executionId:expected.executionId,revision:actual.revision,path:target.path,side:'after'}));}finally{writeFileSync(objectPath,original);}
 const vue={defineComponent:v=>v,h:(type,props,children)=>({type,props:props||{},children}),ref:value=>({value}),watch:()=>{},onBeforeUnmount:()=>{}};
 const plugin={name:'vue-fixture',setup(b){b.onResolve({filter:/^vue$/},()=>({path:'vue',namespace:'fixture'}));b.onLoad({filter:/^vue$/,namespace:'fixture'},()=>({contents:'module.exports=globalThis.__vue;',loader:'js'}));}};
 const bundle=await build({entryPoints:[fileURLToPath(new URL('../renderer/pages/task-review.ts',import.meta.url))],bundle:true,write:false,format:'cjs',plugins:[plugin]});
 const context={module:{exports:{}},globalThis:{__vue:vue},atob,TextDecoder};vm.runInNewContext(bundle.outputFiles[0].text,context);
 const find=(n,p)=>Array.isArray(n)?n.map(x=>find(x,p)).find(Boolean):n&&typeof n==='object'?(p(n)?n:find(n.children,p)):null;
 const text=n=>Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'?text(n.children):String(n??'');
 const handlers=new Map();registerExecutionIpc({handle:(name,handler)=>handlers.set(name,handler)},(method,args)=>bridge.request(method,args));
 const render=context.module.exports.TaskReview.setup({sessionId:'current',active:true,describe:(sessionId,executionId)=>bridge.request('execution/describe',{sessionId,executionId}),readFile:(sessionId,executionId,revision,path,side)=>handlers.get('sacode:executionReviewFile')({},{sessionId,executionId,revision,path,side})});
 find(render(),n=>n.type==='input').props.onInput({target:{value:expected.executionId}});
 await find(render(),n=>n.type==='button').props.onClick();
 const collect=(n,p)=>Array.isArray(n)?n.flatMap(x=>collect(x,p)):n&&typeof n==='object'?[...(p(n)?[n]:[]),...collect(n.children,p)]:[];
 for(let i=0;i<expected.files.length;i++)await collect(render(),n=>n.type==='button'&&text(n)==='预览正文')[i].props.onClick();
 const visible=text(render());for(const row of expected.files)assert.ok(visible.includes(row.path),row.path);assert.ok(visible.includes(expected.sourceDirectory));
 outcome={passed:true,executionId:expected.executionId,files:expected.files.length,sourceLogSha256:sha(readFileSync(source)),hostSha256:sha(readFileSync(hostPath)),reviewSha256:sha(Buffer.from(actual.review)),rendered:true,previewed:true};
 writeFileSync(join(root,'verification.json'),JSON.stringify(outcome,null,2));
}finally{await bridge.stop();}
console.log(JSON.stringify({...outcome,evidence:root}));
