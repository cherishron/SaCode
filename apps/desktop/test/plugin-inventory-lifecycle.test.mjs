import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {assertStaticRendererBundle} from '../../../scripts/renderer-bundle-guard.mjs';
const require=createRequire(import.meta.url);
test('插件清单提供者晚绑定、换绑、卸载与迟到读取隔离',{timeout:20000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'sacode-inventory-lifecycle-'));
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
  const result=await new Promise((resolve,reject)=>{
    const child=spawn(require('electron'),[runner,page],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    const timer=setTimeout(()=>{child.kill();reject(Error('Chromium 生命周期验收超时'));},15000);
    child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>errors+=d);child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);resolve(code);});
  });
  assert.equal(result,0,output+'\n'+errors);
  const line=output.split(/\r?\n/).find(l=>l.startsWith('[{"name":'));
  assert.ok(line,'缺少 Chromium 断言结果');const checks=JSON.parse(line);
  assert.equal(checks.length,11);assert.ok(checks.every(c=>c.ok),line);
});
