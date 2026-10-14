import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const {createExecutionHistory}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(readFileSync(new URL('../renderer/pages/execution-history.ts',import.meta.url),'utf8'))).toString('base64'));
const row=(id=1)=>({sessionId:'s1',executionId:'execution-'+id,taskId:'t'+id,requestId:'r'+id,revision:1,phase:'awaiting-approval'});
const page=(records,nextCursor,hasMore=false)=>({version:1,source:'durable-history',sessionId:'s1',records,nextCursor,hasMore});
test('持久任务列表分页只读取，不授权或启动；刷新不重复条目',async()=>{
 let calls=0;const view=createExecutionHistory({executionList:async(id,cursor,limit)=>{assert.equal(id,'s1');assert.equal(limit,16);calls++;return cursor<0?page([row()],0,true):page([row(2)],1);}},()=> 's1',()=>{});
 await view.load();await view.load(true);assert.deepEqual(view.state.rows.map(r=>r.executionId),['execution-1','execution-2']);
 await view.load();assert.equal(view.state.rows.length,1);assert.equal(calls,3);
});
test('切会话与关闭后的迟到列表不覆盖当前状态',async()=>{
 let done,id='s1';const view=createExecutionHistory({executionList:()=>new Promise(r=>done=r)},()=>id,()=>{});
 const waiting=view.load();id='s2';view.reset();done(page([row()],0));await waiting;assert.equal(view.state.rows.length,0);assert.equal(view.state.busy,false);
 id='s1';const closed=view.load();view.dispose();done(page([row()],0));await closed;assert.equal(view.state.rows.length,0);
});
test('损坏页整页拒绝，读取失败保留旧记录并允许重试',async()=>{
 let reply=page([row()],0,true);const view=createExecutionHistory({executionList:async()=>reply},()=> 's1',()=>{});
 await view.load();reply=page([row(2),row(2)],2);await view.load(true);assert.match(view.state.error,/无效/);assert.equal(view.state.cursor,0);assert.equal(view.state.rows.length,1);
 reply={...page([row()],0),sessionId:'other'};await view.load();assert.match(view.state.error,/身份/);assert.equal(view.state.rows.length,1);
 reply=page([], -1);await view.load();assert.equal(view.state.error,'');assert.equal(view.state.rows.length,0);
});
