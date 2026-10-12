// 编译实际编辑器状态服务；只替身有限工具通道，不读写用户文件或启动公共 Host。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const bundle=await build({entryPoints:[fileURLToPath(new URL('../renderer/pages/file-editor-state.ts',import.meta.url))],bundle:true,write:false,format:'cjs'});
const ctx={module:{exports:{}}};vm.runInNewContext(bundle.outputFiles[0].text,ctx);
const {createFileEditor}=ctx.module.exports;
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function fixture(extra={}){
  let disk='原文',changed=0;const calls=[];
  const base={read:async()=>({result:disk}),ask:async()=>({approvalId:1}),answer:async()=>({accepted:true}),write:async(_path,text)=>{disk=text;return{result:'ok:fixture'};},...extra};
  const api=Object.fromEntries(Object.entries(base).map(([name,fn])=>[name,(...args)=>{calls.push([name,...args]);return fn(...args);} ]));
  const editor=createFileEditor(api,()=>changed++);
  return{editor,calls,changed:()=>changed,disk:()=>disk};
}
async function prepared(extra={}){const f=fixture(extra);await f.editor.open('a.txt');f.editor.edit('新草稿');f.editor.review();return f;}

test('只有布尔 true 审批回执能够写入，字符串和其他真值均拒绝',async()=>{
  for(const accepted of ['false','true',1,{},[],false,null,undefined]){
    const f=await prepared({answer:async()=>({accepted})});await f.editor.save();
    assert.equal(f.calls.some(c=>c[0]==='write'),false,JSON.stringify(accepted));assert.equal(f.disk(),'原文');
    assert.equal(f.editor.state.draft,'新草稿');assert.equal(f.editor.state.review,true);assert.match(f.editor.state.error,/审批/);
  }
});
test('审批回执缺失、数组或空对象不造成写入也不丢草稿',async()=>{
  for(const reply of [undefined,null,[],{}]){
    const f=await prepared({answer:async()=>reply});await f.editor.save();
    assert.equal(f.calls.some(c=>c[0]==='write'),false);assert.equal(f.editor.state.draft,'新草稿');assert.match(f.editor.state.error,/审批/);
  }
});
test('非法读取回执显示准确错误，不作为文件正文进入编辑',async()=>{
  for(const reply of [undefined,null,[],{}, {result:1},{result:false}]){
    const f=fixture({read:async()=>reply});await f.editor.open('a.txt');
    assert.equal(f.editor.state.loaded,false);assert.match(f.editor.state.error,/读取回执/);assert.equal(f.editor.state.busy,false);
  }
});
test('保存前读取回执畸形不发审批，保留当前草稿',async()=>{
  let reads=0;const f=await prepared({read:async()=>++reads===1?{result:'原文'}:null});await f.editor.save();
  assert.equal(f.calls.some(c=>c[0]==='ask'),false);assert.match(f.editor.state.error,/读取回执/);assert.equal(f.editor.state.draft,'新草稿');
});
test('写入回执畸形或工具拒绝不假报已保存，草稿与原始基线保留',async()=>{
  for(const reply of [undefined,null,[],{}, {result:123},{result:'denied:fs-stale-version'}]){
    const f=await prepared({write:async()=>reply});await f.editor.save();
    assert.equal(f.editor.state.original,'原文');assert.equal(f.editor.state.draft,'新草稿');assert.equal(f.editor.state.review,true);
    assert.equal(f.editor.state.notice,'');assert.match(f.editor.state.error,/写入/);assert.equal(f.editor.state.busy,false);
  }
});
test('写后读取回执损坏不能更新基线或宣称保存成功',async()=>{
  let reads=0;const f=await prepared({read:async()=>++reads===3?null:{result:'原文'}});await f.editor.save();
  assert.equal(f.disk(),'新草稿');assert.equal(f.editor.state.original,'原文');assert.equal(f.editor.state.notice,'');
  assert.match(f.editor.state.error,/读取回执/);assert.equal(f.editor.state.draft,'新草稿');
});
test('工单对象畸形或号码无效不回答审批，不调用写入',async()=>{
  for(const grant of [null,undefined,[],{}, {approvalId:'1'},{approvalId:0},{approvalId:1.5}]){
    const f=await prepared({ask:async()=>grant});await f.editor.save();
    assert.equal(f.calls.some(c=>c[0]==='answer'||c[0]==='write'),false);assert.match(f.editor.state.error,/工单/);
  }
});
test('编辑器卸载后 review/discard/reset/cancelReview 不改变旧草稿状态',async()=>{
  const f=await prepared();f.editor.dispose();const before=JSON.stringify(f.editor.state),count=f.changed();
  f.editor.cancelReview();f.editor.discard();assert.equal(f.editor.reset(),false);f.editor.review();f.editor.edit('late');await f.editor.save();await f.editor.open('b.txt');
  assert.equal(JSON.stringify(f.editor.state),before);assert.equal(f.changed(),count);
});
test('卸载后迟到工单只撤销，不同意或启动写入',async()=>{
  const wait=deferred(),f=await prepared({ask:()=>wait.promise});const saving=f.editor.save();await tick();f.editor.dispose();
  wait.resolve({approvalId:9});await saving;assert.equal(f.calls.some(c=>c[0]==='write'),false);
  assert.deepEqual(f.calls.filter(c=>c[0]==='answer'),[['answer',9,'denied']]);
});
test('写入或回读在途卸载，不再更新旧编辑器或启动额外读取',async()=>{
  for(const stage of ['write','readback']){
    const wait=deferred();let reads=0;const f=await prepared(stage==='write'?{write:()=>wait.promise}:{read:async()=>++reads===3?wait.promise:{result:'原文'}});
    const saving=f.editor.save();await tick();f.editor.dispose();const before=JSON.stringify(f.editor.state),count=f.changed();
    wait.resolve(stage==='write'?{result:'ok:fixture'}:{result:'新草稿'});await saving;
    assert.equal(JSON.stringify(f.editor.state),before);assert.equal(f.changed(),count);
    assert.equal(f.calls.filter(c=>c[0]==='read').length,stage==='write'?2:3);
  }
});
test('有效保存支持空正文，多次点击仅发起一份审批及写入',async()=>{
  const wait=deferred(),f=fixture({answer:()=>wait.promise});await f.editor.open('a.txt');f.editor.edit('');f.editor.review();
  const saving=f.editor.save();await tick();await f.editor.save();wait.resolve({accepted:true});await saving;
  assert.equal(f.calls.filter(c=>c[0]==='ask').length,1);assert.equal(f.calls.filter(c=>c[0]==='write').length,1);
  assert.equal(f.disk(),'');assert.equal(f.editor.dirty(),false);assert.match(f.editor.state.notice,/已保存/);
});
