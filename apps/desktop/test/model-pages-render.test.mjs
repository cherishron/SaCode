import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
const require=createRequire(import.meta.url),here=dirname(fileURLToPath(import.meta.url));
test('模型设置真实渲染列表、编辑入口与只读操作护栏',{timeout:20000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'sacode-model-pages-'));
  await build({stdin:{contents:"export {Page as Providers} from './provider-settings';export {Page as Customs} from './custom-models';",resolveDir:join(here,'../renderer/pages'),loader:'ts'},bundle:true,format:'iife',globalName:'ModelPages',outfile:join(dir,'pages.js'),plugins:[{name:'vue-runtime',setup(b){b.onResolve({filter:/^vue$/},()=>({path:'vue',namespace:'runtime'}));b.onLoad({filter:/.*/,namespace:'runtime'},()=>({contents:'module.exports=globalThis.Vue;',loader:'js'}));}}]});
  const vue=pathToFileURL(join(here,'../node_modules/vue/dist/vue.runtime.global.prod.js'));
  writeFileSync(join(dir,'fixture.html'),`<!doctype html><meta charset="utf-8"><div id="fixture"></div><script src="${vue}"></script><script src="${pathToFileURL(join(dir,'pages.js'))}"></script>`);
  const result=await new Promise((resolve,reject)=>{
    const child=spawn(require('electron'),[join(here,'../test-support/model-pages-smoke.cjs'),join(dir,'fixture.html')],{windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';
    const timer=setTimeout(()=>{child.kill();reject(Error('页面渲染验收超时'));},15000);
    child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);child.on('error',reject);child.on('close',code=>{clearTimeout(timer);resolve({code,out,err});});
  });assert.equal(result.code,0,result.out+'\n'+result.err);
});
