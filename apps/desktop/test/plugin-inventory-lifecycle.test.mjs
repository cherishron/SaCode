import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {assertStaticRendererBundle} from '../../../scripts/renderer-bundle-guard.mjs';
const require=createRequire(import.meta.url),here=dirname(fileURLToPath(import.meta.url));
test('插件清单提供者晚绑定、换绑、卸载与迟到读取隔离',{timeout:30000},async()=>{
  // 与 model-pages-render 同款 harness 环境硬化：%TEMP% 可能被 ACL/AV 拒写，
  // esbuild 输出与 electron user-data 都落到仓库内可写目录；ELECTRON_RUN_AS_NODE
  // 会被 harness 注入，spawn 子进程必须删掉它，否则 electron 当纯 node 跑、app 未定义。
  const baseDir=join(here,'..','.tmp-test','plugin-inventory');
  mkdirSync(baseDir,{recursive:true});
  const dir=mkdtempSync(join(baseDir,'run-'));
  const userData=join(dir,'user-data');mkdirSync(userData,{recursive:true});
  const source=fileURLToPath(new URL('../renderer/pages/plugins-page.ts',import.meta.url));
  const bundle=join(dir,'inventory.js');
  const resultBundle=await build({stdin:{contents:readFileSync(process.env.SACODE_INVENTORY_SOURCE||source,'utf8'),resolveDir:dirname(source),sourcefile:source,loader:'ts'},
    bundle:true,format:'iife',globalName:'SaCodePlugins',outfile:bundle,logLevel:'warning',metafile:true,
    plugins:[{name:'unique-vue-runtime',setup(b){b.onResolve({filter:/^vue$/},()=>({path:'vue',namespace:'runtime'}));b.onLoad({filter:/.*/,namespace:'runtime'},()=>({contents:'module.exports=globalThis.Vue;',loader:'js'}));}}]});
  assertStaticRendererBundle(readFileSync(bundle,'utf8'),resultBundle.metafile);
  const vue=fileURLToPath(new URL('../node_modules/vue/dist/vue.runtime.global.prod.js',import.meta.url));
  const page=join(dir,'fixture.html');writeFileSync(page,`<!doctype html><meta charset="utf-8"><div id="fixture"></div><script src="${pathToFileURL(vue)}"></script><script src="${pathToFileURL(bundle)}"></script>`);
  const runner=fileURLToPath(new URL('../test-support/plugin-inventory-lifecycle.cjs',import.meta.url));
  let output='',errors='';
  const childEnv={...process.env};delete childEnv.ELECTRON_RUN_AS_NODE;
  const result=await new Promise((resolve,reject)=>{
    const child=spawn(require('electron'),['--no-sandbox','--disable-gpu',`--user-data-dir=${userData}`,runner,page],{env:childEnv,windowsHide:true,stdio:['ignore','pipe','pipe']});
    const timer=setTimeout(()=>{child.kill();reject(Error('Chromium 生命周期验收超时'));},25000);
    child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>errors+=d);child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);resolve(code);});
  });
  assert.equal(result,0,output+'\n'+errors);
  const line=output.split(/\r?\n/).find(l=>l.startsWith('[{"name":'));
  assert.ok(line,'缺少 Chromium 断言结果');const checks=JSON.parse(line);
  assert.equal(checks.length,11);assert.ok(checks.every(c=>c.ok),line);
});
