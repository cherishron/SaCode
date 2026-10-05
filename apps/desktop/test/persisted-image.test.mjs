import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';

// 执行实际页面模块；只替换浏览器资源接口与 Vue 生命周期，检查异步资源归属。
const compiled=await build({entryPoints:[new URL('../renderer/pages/persisted-image.ts',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')],bundle:true,write:false,format:'cjs',platform:'browser',external:['vue']});
function fixture(read){
 const created=[],revoked=[],watches=[],unmounts=[];
 const vue={defineComponent:x=>x,ref:value=>({value}),h:(type,props,children)=>({type,props,children}),watch:(_getter,callback,options)=>{watches.push(callback);if(options.immediate)callback();},onBeforeUnmount:callback=>unmounts.push(callback),onMounted:()=>{},Teleport:'teleport'};
 const ctx={module:{exports:{}},exports:{},require:()=>vue,window:{dsh:{attachmentImageRead:read}},Blob,Uint8Array,atob,URL:{createObjectURL:blob=>{created.push(blob);return 'blob:test-'+created.length;},revokeObjectURL:url=>revoked.push(url)}};
 vm.runInNewContext(compiled.outputFiles[0].text,ctx);
 return {api:ctx.module.exports,created,revoked,watches,unmounts};
}
const response=id=>({attachmentId:id,mediaType:'image/png',data:'YWJj'});
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};

test('相同会话图片并发读取合并，最后一份租约释放才撤销 URL',async()=>{
 let calls=0,resolve;
 const f=fixture(()=>{calls++;return new Promise(done=>resolve=done);});
 const a=f.api.acquireImage('s1','image'),b=f.api.acquireImage('s1','image');
 assert.equal(calls,1);resolve(response('image'));
 const first=await a,second=await b;assert.equal(first.url,second.url);assert.equal(f.created.length,1);
 first.release();first.release();assert.deepEqual(f.revoked,[]);
 second.release();assert.deepEqual(f.revoked,[first.url]);
});

test('失败读取可重试，跨会话不共享同一引用的读取授权',async()=>{
 let calls=0;
 const f=fixture(async(_session,id)=>{if(++calls===1)throw Error('scope-rejected');return response(id);});
 await assert.rejects(f.api.acquireImage('s1','image'),/scope-rejected/);
 const a=await f.api.acquireImage('s1','image'),b=await f.api.acquireImage('s2','image');
 assert.equal(calls,3);assert.notEqual(a.url,b.url);a.release();b.release();assert.equal(f.revoked.length,2);
});

test('响应身份和 MIME 必须匹配，非法结果不创建 Blob',async()=>{
 for(const result of [null,{...response('other')},{...response('image'),mediaType:'image/svg+xml'},{...response('image'),data:''},{...response('image'),data:'!'}]){
  const f=fixture(async()=>result);await assert.rejects(f.api.acquireImage('s1','image'));assert.equal(f.created.length,0);
 }
});

test('旧图片的迟到 DOM 解码事件不能改变新会话的加载状态',async()=>{
 const pending=new Map(),f=fixture(session=>new Promise(done=>pending.set(session,done)));
 const props={sessionId:'s1',attachment:{attachmentId:'image',name:'测试.png'},mode:'history',label:'历史图片'};
 const render=f.api.PersistedImage.setup(props);pending.get('s1')(response('image'));await settle();
 const oldImage=render().children[0].children[0];oldImage.props.onLoad();assert.equal(render().props['data-image-state'],'ready');
 props.sessionId='s2';f.watches[0]();oldImage.props.onError();oldImage.props.onLoad();
 assert.equal(render().props['data-image-state'],'loading');
 pending.get('s2')(response('image'));await settle();f.unmounts.forEach(fn=>fn());
});

test('卸载后才到达的图片立即释放，不恢复已关闭视图',async()=>{
 let resolve;
 const f=fixture(()=>new Promise(done=>resolve=done));
 const render=f.api.PersistedImage.setup({sessionId:'s1',attachment:{attachmentId:'image',name:'测试.png'},mode:'history',label:'历史图片'});
 f.unmounts.forEach(fn=>fn());resolve(response('image'));await settle();
 assert.equal(f.created.length,1);assert.deepEqual(f.revoked,['blob:test-1']);
 assert.equal(render().children[0].children[0].type,'span');
});

test('切换会话后旧请求即使后到也不能覆盖新图',async()=>{
 const pending=new Map();
 const f=fixture((session)=>new Promise(done=>pending.set(session,done)));
 const props={sessionId:'s1',attachment:{attachmentId:'image',name:'测试.png'},mode:'history',label:'历史图片'};
 const render=f.api.PersistedImage.setup(props);props.sessionId='s2';f.watches[0]();
 pending.get('s2')(response('image'));await settle();
 assert.equal(render().children[0].children[0].props.src,'blob:test-1');
 pending.get('s1')(response('image'));await settle();
 assert.equal(render().children[0].children[0].props.src,'blob:test-1');assert.deepEqual(f.revoked,['blob:test-2']);
 f.unmounts.forEach(fn=>fn());assert.deepEqual(f.revoked,['blob:test-2','blob:test-1']);
});
