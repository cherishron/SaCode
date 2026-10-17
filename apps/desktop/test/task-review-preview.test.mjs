import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes,createRequire} from 'node:module';
const source=readFileSync(new URL('../renderer/pages/task-review-preview.ts',import.meta.url),'utf8');
const {decodeReviewPreview}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
const task={sessionId:'s',executionId:'execution-1',revision:5},row={path:'a.txt',beforeDigest:'a'.repeat(64),afterDigest:''};
const reply=(bytes,extra={})=>({version:1,sessionId:'s',executionId:'execution-1',revision:5,path:'a.txt',side:'before',sha256:'a'.repeat(64),exists:true,totalBytes:bytes.length,returnedBytes:bytes.length,truncated:false,data:Buffer.from(bytes).toString('base64'),...extra});
test('正文预览保留空文件、中文与二进制边界',()=>{
 assert.equal(decodeReviewPreview(reply(Buffer.from('中文')),task,row,'before').text,'中文');
 assert.equal(decodeReviewPreview(reply(Buffer.alloc(0)),task,row,'before').exists,true);
 assert.equal(decodeReviewPreview(reply(Buffer.from([0,255])),task,row,'before').binary,true);
 assert.equal(decodeReviewPreview(reply(Buffer.alloc(0),{side:'after',sha256:'',exists:false}),task,row,'after').exists,false);
});
test('截断不能冒充完整；会话、修订、摘要及字节错误拒绝',()=>{
 const bytes=Buffer.from([0xe4,0xb8]);
 assert.deepEqual(decodeReviewPreview(reply(bytes,{totalBytes:3,truncated:true}),task,row,'before'),{text:'',binary:false,truncated:true,totalBytes:3,exists:true});
 for(const extra of [{sessionId:'other'},{executionId:'execution-2'},{revision:4},{sha256:'b'.repeat(64)},{path:'other'},{side:'after'},{returnedBytes:0},{totalBytes:70000,truncated:false},{returnedBytes:65537}])assert.throws(()=>decodeReviewPreview(reply(Buffer.from('x'),extra),task,row,'before'));
});
test('有限 IPC 预览只允许登记路径和前后侧，不接受额外对象身份',async()=>{
 const {registerExecutionIpc}=createRequire(import.meta.url)('../execution-ipc.cjs');const handlers=new Map(),calls=[];
 registerExecutionIpc({handle:(name,handler)=>handlers.set(name,handler)},async(...args)=>{calls.push(args);return{};});
 const read=handlers.get('sacode:executionReviewFile'),valid={sessionId:'s',executionId:'execution-1',revision:5,path:'a.txt',side:'before'};
 await read({},valid);assert.equal(calls.length,1);assert.deepEqual(calls[0],['execution/review-file',valid]);
 for(const args of [{...valid,objectId:'arbitrary'},{...valid,side:'other'},{...valid,revision:0},{...valid,path:'x'.repeat(4097)},{...valid,revision:1.5}])await assert.rejects(read({},args));
 assert.equal(calls.length,1);
});
