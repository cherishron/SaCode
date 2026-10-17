import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const bundle=await build({entryPoints:[fileURLToPath(new URL('../renderer/pages/review-writeback-state.ts',import.meta.url))],bundle:true,write:false,format:'cjs'});
const context={module:{exports:{}},globalThis:{crypto:{randomUUID:()=> 'request-1'}}};vm.runInNewContext(bundle.outputFiles[0].text,context);
const {createReviewWriteback}=context.module.exports;
const id='review-apply-'+'a'.repeat(64),task={sessionId:'s1',executionId:'execution-1',revision:4};
const row={path:'src/a.cj',beforeObject:'sha256:'+'b'.repeat(64),afterObject:'sha256:'+'c'.repeat(64),beforeDigest:'b'.repeat(64),afterDigest:'c'.repeat(64)};
const review={sourceDirectory:'D:/source',sourceIdentity:'1'.repeat(48),files:[row]};
const exact={version:1,sessionId:'s1',executionId:'execution-1',executionRevision:4,applyId:id,sourceDirectory:review.sourceDirectory,sourceIdentity:review.sourceIdentity,files:[row]};
const reply=(phase='awaiting-approval')=>({version:1,sessionId:'s1',applyId:id,phase,files:[{path:row.path,phase:phase==='completed'?'applied':'not-attempted'}],...(phase==='awaiting-approval'?{approvalArguments:JSON.stringify(exact)}:{})});
function fixture(overrides={}){const calls=[];let session='s1';const api={executionReviewPrepare:async(...args)=>{calls.push(['prepare',...args]);return reply();},approvalAsk:async(...args)=>{calls.push(['ask',...args]);return {approvalId:3};},approvalAnswer:async(...args)=>{calls.push(['answer',...args]);return {accepted:true};},executionReviewApply:async(...args)=>{calls.push(['apply',...args]);return reply('completed');},executionReviewApplyDescribe:async()=>reply('completed'),executionReviewApplyStop:async()=>reply('cancelled'),...overrides};return {write:createReviewWriteback(api,()=>session,()=>{}),calls,setSession:v=>session=v};}
test('写回必须先展示匹配的不可变提案，再独立确认精确审批',async()=>{
 const {write,calls}=fixture();await write.prepare(task,review,[row.path]);assert.deepEqual(calls.map(c=>c[0]),['prepare']);assert.equal(write.state.status.phase,'awaiting-approval');
 await write.approve();assert.deepEqual(calls.map(c=>c[0]),['prepare','ask','answer','apply']);assert.equal(calls[1][1],'execution/review-apply');assert.equal(calls[1][2],JSON.stringify(exact));assert.equal(write.state.status.phase,'completed');
 await write.approve();assert.equal(calls.length,4);
});
test('错误提案不得生成可审批状态',async()=>{
 const {write,calls}=fixture({executionReviewPrepare:async()=>({...reply(),approvalArguments:JSON.stringify({...exact,sourceIdentity:'other'})})});await write.prepare(task,review,[row.path]);assert.equal(write.state.plan,null);assert.match(write.state.error,/不一致/);await write.approve();assert.equal(calls.length,0);
});
test('切会话后的迟到审批回执不继续回答或执行',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r);const {write,calls,setSession}=fixture({approvalAsk:()=>pending});await write.prepare(task,review,[row.path]);const applying=write.approve();setSession('s2');write.reset();resolve({approvalId:3});await applying;assert.equal(calls.filter(c=>c[0]==='answer'||c[0]==='apply').length,0);assert.equal(write.state.plan,null);
});
test('写回请求失联不假报待审批，可按同批次查询真实完成',async()=>{
 const {write}=fixture({executionReviewApply:async()=>{throw Error('connection lost');}});await write.prepare(task,review,[row.path]);await write.approve();assert.equal(write.state.status,null);assert.match(write.state.error,/connection lost/);await write.refresh();assert.equal(write.state.status.phase,'completed');
});
test('停止和刷新回执必须匹配会话批次及路径',async()=>{
 const {write}=fixture({executionReviewApplyStop:async()=>({...reply('cancelled'),applyId:'wrong'})});await write.prepare(task,review,[row.path]);await write.refresh(true);assert.match(write.state.error,/身份/);assert.equal(write.state.status.phase,'awaiting-approval');
});
