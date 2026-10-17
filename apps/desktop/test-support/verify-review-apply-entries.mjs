// 使用真实私有进程留下的审查日志与对象；只写本测试拥有的合成项目。
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,mkdirSync,mkdtempSync,copyFileSync,existsSync,writeFileSync} from 'node:fs';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';
import vm from 'node:vm';
import {fixtureHostEnv} from './fixture-env.mjs';
const require=createRequire(import.meta.url),{HostBridge}=require('../host-bridge.cjs'),{registerExecutionIpc}=require('../execution-ipc.cjs');
const [runtime,host,cli]=process.argv.slice(2).map(v=>resolve(v));
assert.ok(runtime&&host&&cli,'需要真实任务runtime-temp、本轮Host和CLI');
const sha=b=>createHash('sha256').update(b).digest('hex');
const unescape=s=>s.replace(/\\([\\nrt])/g,(_,c)=>({'\\':'\\',n:'\n',r:'\r',t:'\t'}[c]));
let source,review;
for(const n of readdirSync(runtime).filter(n=>/^private-task-.*\.log$/.test(n))){
 const p=join(runtime,n),text=readFileSync(p,'utf8');if(text.includes('\texecution/review-apply-'))continue;
 for(const line of text.trimEnd().split('\n'))if(line.includes('\texecution/review\t')){
  const v=JSON.parse(unescape(line.replace(/\r$/,'').split('\t')[2]));
  if(v.sourceIdentity&&v.files.length===3&&v.files.every(r=>r.kind==='added'?!existsSync(join(v.sourceDirectory,r.path)):existsSync(join(v.sourceDirectory,r.path))&&sha(readFileSync(join(v.sourceDirectory,r.path)))===r.beforeDigest)){source=p;review=v;break;}
 }
 if(source)break;
}
assert.ok(source,'没有未使用且字节匹配的真实审查夹具，禁止重置源文件凑通过');
const temp=fileURLToPath(new URL('../../../target/tmp/',import.meta.url)),rel=relative(temp,review.sourceDirectory);
assert.ok(rel&&!rel.startsWith('..')&&!isAbsolute(rel),'源目录必须是本仓临时合成项目');
const root=mkdtempSync(join(temp,'review-apply-entry-'));copyFileSync(source,join(root,'session.log'));mkdirSync(join(root,'attachments/v1'),{recursive:true});
for(const n of readdirSync(source+'.objects'))copyFileSync(join(source+'.objects',n),join(root,'attachments/v1',n));
const bridge=new HostBridge(host,fixtureHostEnv(root,{TMP:root,TEMP:root}));let checks=0;
const handlers=new Map();registerExecutionIpc({handle:(n,h)=>handlers.set(n,h)},(method,args)=>bridge.request(method,args));
const ipc=(name,args)=>handlers.get('sacode:'+name)({},args);
let execution,hostApplyId;
try{
 await bridge.start(root);const initialized=await bridge.request('initialize',{});for(const m of ['execution/review-prepare','execution/review-apply','execution/review-apply-describe','execution/review-apply-stop'])assert.ok(initialized.capabilities.includes(m));checks++;
 execution=await bridge.request('execution/describe',{sessionId:'current',executionId:review.executionId});
 const params={sessionId:'current',executionId:execution.executionId,revision:execution.revision,requestId:'host-real-write',paths:['src/main.txt']};
 await assert.rejects(ipc('executionReviewPrepare',{...params,sourceDirectory:'C:/other'}));
 await assert.rejects(ipc('executionReviewPrepare',{...params,revision:execution.revision+1}));checks+=2;
 const plan=await ipc('executionReviewPrepare',params);hostApplyId=plan.applyId;assert.equal(plan.phase,'awaiting-approval');
 assert.deepEqual(await ipc('executionReviewPrepare',params),plan);checks++;
 await assert.rejects(ipc('executionReviewApply',{sessionId:'current',applyId:plan.applyId,approvalId:123}));checks++;
 const wrong=await bridge.request('approval/ask',{name:'execution/start',args:plan.approvalArguments});await bridge.request('approval/answer',{approvalId:wrong.approvalId,decision:'allowed-once'});
 await assert.rejects(ipc('executionReviewApply',{sessionId:'current',applyId:plan.applyId,approvalId:wrong.approvalId}));checks++;
 const vue={defineComponent:v=>v,h:(type,props,children)=>({type,props:props||{},children}),ref:value=>({value}),watch:()=>{},onBeforeUnmount:()=>{}};
 const plugin={name:'vue-review-fixture',setup(b){b.onResolve({filter:/^vue$/},()=>({path:'vue',namespace:'fixture'}));b.onLoad({filter:/^vue$/,namespace:'fixture'},()=>({contents:'module.exports=globalThis.__vue;',loader:'js'}));}};
 const bundle=await build({entryPoints:[fileURLToPath(new URL('../renderer/pages/review-writeback.ts',import.meta.url))],bundle:true,write:false,format:'cjs',plugins:[plugin]});
 const context={module:{exports:{}},globalThis:{__vue:vue,crypto:{randomUUID:()=>params.requestId}}};vm.runInNewContext(bundle.outputFiles[0].text,context);
 const find=(n,p)=>Array.isArray(n)?n.map(x=>find(x,p)).find(Boolean):n&&typeof n==='object'?(p(n)?n:find(n.children,p)):null;
 const text=n=>Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'?text(n.children):String(n??'');
 const api=Object.fromEntries(['Prepare','Apply','ApplyDescribe','ApplyStop'].map(n=>['executionReview'+n,(...args)=>{
  const fields=n==='Prepare'?['sessionId','executionId','revision','requestId','paths']:n==='Apply'?['sessionId','applyId','approvalId']:['sessionId','applyId'];
  return ipc('executionReview'+n,Object.fromEntries(fields.map((f,i)=>[f,args[i]])));
 }]));
 api.approvalAsk=(name,args)=>bridge.request('approval/ask',{name,args});api.approvalAnswer=(approvalId,decision)=>bridge.request('approval/answer',{approvalId,decision});
 const render=context.module.exports.ReviewWriteback.setup({sessionId:'current',active:true,task:execution,review,api});
 find(find(render(),n=>n.type==='label'&&text(n).includes('src/main.txt')),n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});
 await find(render(),n=>n.type==='button'&&text(n)==='生成写回提案').props.onClick();
 assert.ok(text(render()).includes(plan.approvalArguments),'页面须先展示完整精确提案');
 await find(render(),n=>n.type==='button'&&text(n)==='确认并写回所选文件').props.onClick();
 assert.equal(find(render(),n=>n.type==='p'&&n.props.role==='alert'),undefined,'页面写回不得隐藏错误');checks++;
 let state=await ipc('executionReviewApplyDescribe',{sessionId:'current',applyId:plan.applyId});
 for(let i=0;i<100&&state.phase==='applying';i++){await new Promise(r=>setTimeout(r,20));state=await ipc('executionReviewApplyDescribe',{sessionId:'current',applyId:plan.applyId});}
 assert.equal(state.phase,'completed');assert.equal(state.files[0].phase,'applied');assert.equal(sha(readFileSync(join(review.sourceDirectory,'src/main.txt'))),review.files.find(r=>r.path==='src/main.txt').afterDigest);checks++;
 assert.deepEqual(await ipc('executionReviewApply',{sessionId:'current',applyId:plan.applyId,approvalId:123}),state);checks++;
 assert.deepEqual(await ipc('executionReviewApplyStop',{sessionId:'current',applyId:plan.applyId}),state);checks++;
}finally{await bridge.stop();}
assert.equal(bridge.notifications.find(n=>n.method==='host/settled')?.params.executionSettled,true);checks++;
const run=(action,params,input='')=>spawnSync(cli,['job',action,JSON.stringify(params)],{cwd:root,input,env:fixtureHostEnv(root,{TMP:root,TEMP:root}),encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:1048576});
const params={sessionId:'current',executionId:execution.executionId,revision:execution.revision,requestId:'cli-real-write',paths:['added.txt','empty.txt']};
const prepared=run('review-prepare',params);assert.equal(prepared.status,0,prepared.stderr);const plan=JSON.parse(prepared.stdout),call={sessionId:'current',applyId:plan.applyId};checks++;
const refused=run('review-apply',call,'n\n');assert.equal(refused.status,1);assert.match(refused.stderr,/not-authorized/);assert.equal(existsSync(join(review.sourceDirectory,'added.txt')),false);checks++;
const applied=run('review-apply',call,'y\n');assert.equal(applied.status,0,applied.stderr);assert.match(applied.stderr,/写回完整提案/);assert.equal(JSON.parse(applied.stdout).phase,'completed');checks++;
assert.equal(readFileSync(join(review.sourceDirectory,'added.txt'),'utf8'),'ADDED');assert.equal(existsSync(join(review.sourceDirectory,'empty.txt')),false);checks++;
const repeated=run('review-apply',call);assert.equal(repeated.status,0,repeated.stderr);assert.equal(repeated.stderr,'');assert.deepEqual(JSON.parse(repeated.stdout),JSON.parse(applied.stdout));checks++;
const replay=run('review-apply-describe',{sessionId:'current',applyId:hostApplyId});assert.equal(replay.status,0,replay.stderr);assert.equal(JSON.parse(replay.stdout).phase,'completed');checks++;
const report={passed:true,checks,hostApplyId,cliApplyId:plan.applyId,sourceLog:source,sourceLogSha256:sha(readFileSync(source)),hostSha256:sha(readFileSync(host)),cliSha256:sha(readFileSync(cli)),renderedWriteback:true,scope:'真实页面组件→有限IPC→Host，与CLI明确审批；合成项目三文件实际写回；非完整Electron/安装态'};
writeFileSync(join(root,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,evidence:root}));
