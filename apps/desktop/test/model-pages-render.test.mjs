import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtempSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {electronTestOptions} from '../test-support/electron-env-gate.mjs';
const require=createRequire(import.meta.url),here=dirname(fileURLToPath(import.meta.url));
for(const theme of ['light','dark'])for(const width of [1000,600])test('模型设置渲染与竞态 '+theme+' '+width,electronTestOptions({timeout:30000}),async()=>{
  // %TEMP% 在某些环境被 ACL/AV 拒写：esbuild 输出与 electron user-data 都落到仓库内可写目录，
  // 不依赖系统 temp。ELECTRON_RUN_AS_NODE 会被 harness 注入，spawn 子进程必须删掉它，
  // 否则 electron 当纯 node 跑、app 未定义；并给 --user-data-dir 绕开 %APPDATA%\Electron 的 ACL。
  const baseDir=process.env.SACODE_MODEL_TEST_ROOT||join(here,'..','..','..','target','tmp','model-pages');
  mkdirSync(baseDir,{recursive:true});
  const dir=mkdtempSync(join(baseDir,'run-'));
  const userData=join(dir,'user-data');mkdirSync(userData,{recursive:true});
  await build({stdin:{contents:"export {Page as Providers} from './provider-settings';export {Page as Customs} from './custom-models';export {createModelCenterAssembly,createModelCenterAdapters} from './client-slots';",resolveDir:join(here,'../renderer/pages'),loader:'ts'},bundle:true,format:'iife',globalName:'ModelPages',outfile:join(dir,'pages.js'),plugins:[{name:'vue-runtime',setup(b){b.onResolve({filter:/^vue$/},()=>({path:'vue',namespace:'runtime'}));b.onLoad({filter:/.*/,namespace:'runtime'},()=>({contents:'module.exports=globalThis.Vue;',loader:'js'}));}}]});
  for(const [source,name] of [['../node_modules/vue/dist/vue.runtime.global.prod.js','vue.js'],['../renderer/styles.css','styles.css'],['../renderer/product-design.css','product-design.css'],['../renderer/dialog.js','dialog.js'],['../test-support/model-pages-smoke.cjs','model-pages-smoke.cjs']])copyFileSync(join(here,source),join(dir,name));
  const vue=pathToFileURL(join(dir,'vue.js'));
  writeFileSync(join(dir,'fixture.html'),`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="script-src 'self'"><link rel="stylesheet" href="${pathToFileURL(join(dir,'styles.css'))}"><link rel="stylesheet" href="${pathToFileURL(join(dir,'product-design.css'))}"><div id="fixture" class="model-center-page"></div><script src="${vue}"></script><script src="${pathToFileURL(join(dir,'dialog.js'))}"></script><script src="${pathToFileURL(join(dir,'pages.js'))}"></script>`);
  const childEnv={...process.env,TEMP:dir,TMP:dir,SACODE_MODEL_THEME:theme,SACODE_MODEL_WIDTH:String(width)};delete childEnv.ELECTRON_RUN_AS_NODE;
  const result=await new Promise((resolve,reject)=>{
    const child=spawn(require('electron'),[`--user-data-dir=${userData}`,join(dir,'model-pages-smoke.cjs'),join(dir,'fixture.html')],{env:childEnv,windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';
    const timer=setTimeout(()=>{child.kill();reject(Error('页面渲染验收超时'));},25000);
    child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);resolve({code,out,err});});
  });assert.equal(result.code,0,result.out+'\n'+result.err);
  const report=JSON.parse(result.out.trim().split('\n').at(-1));
  assert.ok(Array.isArray(report.checks)&&report.checks.length>0,'渲染检查不能是空集');
  assert.deepEqual(report.errors,[]);
  assert.deepEqual(report.checks.filter(check=>!check.ok),[]);
  console.log(theme+' '+width+'：'+report.checks.length+' 项通过');
});
