import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{registerExecutionIpc}=require('../execution-ipc.cjs');
test('写回 IPC 仅转发四个有限动作且拒绝未知字段和越界文件集合',async()=>{
 const handlers=new Map(),calls=[];
 registerExecutionIpc({handle:(n,h)=>handlers.set(n,h)},async(method,args)=>{calls.push({method,args});return {accepted:true};});
 const invoke=(name,args)=>handlers.get('sacode:'+name)({},args);
 const prepared={sessionId:'current',executionId:'execution-1',revision:4,requestId:'review-1',paths:['src/a.cj']};
 await invoke('executionReviewPrepare',prepared);
 await invoke('executionReviewApply',{sessionId:'current',applyId:'apply-1',approvalId:2});
 await invoke('executionReviewApplyDescribe',{sessionId:'current',applyId:'apply-1'});
 await invoke('executionReviewApplyStop',{sessionId:'current',applyId:'apply-1'});
 assert.deepEqual(calls.map(c=>c.method),['execution/review-prepare','execution/review-apply','execution/review-apply-describe','execution/review-apply-stop']);
 for(const change of [{paths:[]},{paths:Array(129).fill('a')},{paths:[null]},{paths:['x'.repeat(4097)]},{revision:0},{sourceDirectory:'C:/other'}])await assert.rejects(invoke('executionReviewPrepare',{...prepared,...change}),/bad-execution-arguments/);
 await assert.rejects(invoke('executionReviewApply',{sessionId:'current',applyId:'apply-1',approvalId:0}),/bad-execution-arguments/);
 assert.equal(calls.length,4);
});
