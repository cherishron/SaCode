import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {registerExecutionHistoryIpc}=createRequire(import.meta.url)('../execution-history-ipc.cjs');
test('执行历史有限IPC严格校验字段，不能携带启动或路径参数',async()=>{
 const handlers=new Map(),calls=[];registerExecutionHistoryIpc({handle:(name,fn)=>handlers.set(name,fn)},async(...args)=>calls.push(args));
 assert.deepEqual([...handlers.keys()],['sacode:executionList']);const invoke=args=>handlers.get('sacode:executionList')({},args);
 for(const args of [null,{}, {sessionId:'s',cursor:-2,limit:1},{sessionId:'s',cursor:-1,limit:17},{sessionId:'',cursor:-1,limit:1},{sessionId:'s',cursor:-1,limit:1,start:true}])await assert.rejects(invoke(args),/bad-execution/);
 assert.equal(calls.length,0);await invoke({sessionId:'s',cursor:-1,limit:16});assert.deepEqual(calls,[['execution/list',{sessionId:'s',cursor:-1,limit:16}]]);
});
