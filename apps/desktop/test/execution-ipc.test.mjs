import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('持久任务 IPC 使用实际主进程守卫，拒绝额外字段和范围错误',async()=>{
  const source=readFileSync(new URL('../execution-ipc.cjs',import.meta.url),'utf8');
  const handlers=new Map(),calls=[],module={exports:{}};
  vm.runInNewContext(source,{Buffer,module});
  module.exports.registerExecutionIpc({handle:(key,handler)=>handlers.set(key,handler)},(method,args)=>{calls.push({method,args});return args;});
  assert.deepEqual([...handlers.keys()].sort(),[
    'executionPropose','executionAuthorize','executionStart','executionDescribe','executionReviewFile',
    'executionReviewPrepare','executionReviewApply','executionReviewApplyDescribe','executionReviewApplyStop',
    'executionOutput','executionStop',
  ].map(name=>'sacode:'+name).sort());
  const propose=handlers.get('sacode:executionPropose');
  const proposal={sessionId:'current',taskId:'t',requestId:'r',proposal:'{"argv":["中文"]}'};
  await propose(null,proposal);
  assert.equal(calls[0].method,'execution/propose');assert.equal(calls[0].args.proposal,proposal.proposal);
  for(const bad of [null,{...proposal,extra:true},{...proposal,proposal:{}},{...proposal,proposal:'汉'.repeat(400)}]) await assert.rejects(()=>propose(null,bad),/bad-execution-arguments/);
  const output=handlers.get('sacode:executionOutput');
  const params={sessionId:'current',executionId:'execution-1',cursor:-1,limit:16};
  await output(null,params);
  for(const bad of [{...params,cursor:-2},{...params,limit:17},{...params,cursor:1.5}]) await assert.rejects(()=>output(null,bad),/bad-execution-arguments/);
  const authorize=handlers.get('sacode:executionAuthorize');
  await assert.rejects(()=>authorize(null,{sessionId:'current',executionId:'execution-1',revision:1,proposalDigest:'bad',approvalId:1}),/bad-execution-arguments/);
  assert.equal(calls.length,2);
});
