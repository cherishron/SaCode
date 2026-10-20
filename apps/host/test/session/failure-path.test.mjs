import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fixture,task,snapshot,eventsOf,sse,tool,options,sha} from '../support/session-protocol.mjs';

for(const failure of ['http-500','missing-file','outside-workspace'])test('R3失败路径：'+failure,options,async()=>{
  let target='',modelSawToolError=false;
  await fixture(failure,async(body,res,n)=>{
    if(failure==='http-500'){res.writeHead(500,{'content-type':'application/json'});res.end('{"error":{"message":"synthetic-upstream-failure"}}');return;}
    if(n===1){tool(res,'read',{path:target},'invalid-read');return;}
    assert.equal(n,2,'工具失败后不得无限重试');
    const reply=body.messages.filter(message=>message.role==='tool').at(-1);
    assert.equal(reply.tool_call_id,'invalid-read');
    const parsed=JSON.parse(reply.content);assert.ok(parsed.error,'失败必须作为工具错误交还模型');
    assert.ok(!reply.content.includes('SYNTHETIC_OUTSIDE_DO_NOT_READ'),'不得泄漏工作区外合成文件正文');
    modelSawToolError=true;sse(res,{content:'工具读取失败，本次没有修改文件。'});
  },async({bridge,project,evidence,outside,original,dir,result,requests})=>{
    target=failure==='missing-file'?'does-not-exist.cjs':outside;
    const outsideBefore=readFileSync(outside);
    const turn=await task(bridge,'失败验收：不要重试或修改文件。'+failure);
    assert.equal(turn.answered,0,'read及模型失败不应出现写审批');
    const view=await snapshot(bridge);
    const events=eventsOf(join(dir,'session.log'));
    const ends=events.filter(event=>event.type==='request/end').map(event=>JSON.parse(event.data));
    const runtime=events.filter(event=>event.type==='tool/runtime/result').map(event=>event.data);
    const history=view.projection.messages.join('\n');
    assert.equal(readFileSync(join(project,'sum.cjs'),'utf8'),original);
    assert.equal(readFileSync(outside).equals(outsideBefore),true);
    assert.ok(!runtime.some(text=>text.startsWith('ok-read:')||text.startsWith('ok-edit:')),'不得伪造成功工具结果');
    assert.ok(!history.includes('SYNTHETIC_OUTSIDE_DO_NOT_READ'));
    if(failure==='http-500'){
      assert.equal(turn.settled.interrupted,true);assert.match(turn.settled.finishReason,/error|failed/);
      assert.ok(ends.some(end=>end.state==='failed'&&/500|provider|server/.test(end.finishReason)));
      assert.match(history,/error|failed|500/,'投影须能看见模型失败，而非假成功');
    }else{
      assert.equal(modelSawToolError,true);assert.equal(turn.settled.interrupted,false);
      assert.match(history,/工具读取失败|error/);assert.ok(runtime.length>0);
      assert.ok(runtime.some(text=>/error|denied|rejected|fail|outside|not-found|no-such|invalid/i.test(text)),'运行日志须含真实工具失败');
    }
    writeFileSync(join(evidence,'projection.json'),JSON.stringify(view,null,2));
    result.outcome={interrupted:turn.settled.interrupted,finishReason:turn.settled.finishReason,pendingToolCalls:turn.settled.pendingToolCalls,
      eventCount:view.projection.events,durable:view.projection.durable,requestEnds:ends,runtimeResults:runtime,
      modelSawToolError,fileUnchanged:true,outsideUnchanged:true,logSha256:sha(readFileSync(join(dir,'session.log'))),requests:requests()};
  });
});
