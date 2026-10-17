import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const code=await build({entryPoints:[fileURLToPath(new URL('../renderer/pages/file-preview.ts',import.meta.url))],bundle:true,write:false,format:'cjs'});
const ctx={module:{exports:{}}};vm.runInNewContext(code.outputFiles[0].text,ctx);
const {createFilePreview}=ctx.module.exports;
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
test('文件切换不接受上一文件的迟到正文',async()=>{
  const first=deferred(),second=deferred(),view=createFilePreview(path=>path==='a.cj'?first.promise:second.promise,()=>{});
  const a=view.open('a.cj'),b=view.open('b.cj');second.resolve({result:'B'});await b;
  first.resolve({result:'A'});await a;assert.equal(view.state.path,'b.cj');assert.equal(view.state.text,'B');
});
test('拒绝和失败不冒充空文件或残留旧正文',async()=>{
  let allowed=true;const view=createFilePreview(async()=>{if(!allowed)throw Error('not-found');return{result:'旧正文'};},()=>{});
  await view.open('old.cj');allowed=false;await view.open('missing.cj');assert.equal(view.state.loaded,false);assert.equal(view.state.text,'');assert.equal(view.state.error,'not-found');
});
test('关闭预览或卸载后迟到结果不能恢复内容',async()=>{
  for(const action of ['close','dispose']){const pending=deferred();let notices=0;const view=createFilePreview(()=>pending.promise,()=>notices++),read=view.open('a.cj');view[action]();const count=notices;pending.resolve({result:'迟到'});await read;assert.equal(view.state.loaded,false);assert.equal(view.state.text,'');assert.equal(notices,count);}
});
