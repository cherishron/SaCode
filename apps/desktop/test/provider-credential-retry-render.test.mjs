import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const here=dirname(fileURLToPath(import.meta.url));
const require=createRequire(import.meta.url);
test('真实Electron供应商部分保存与密钥独立重试', {timeout:40000}, async()=>{
  const base=join(here,'../.tmp-test/provider-retry-render');mkdirSync(base,{recursive:true});
  const dir=mkdtempSync(join(base,'run-'));mkdirSync(join(dir,'user-data'));
  await build({entryPoints:[join(here,'../renderer/pages/provider-settings.ts')],bundle:true,format:'iife',globalName:'ProviderPage',outfile:join(dir,'page.js'),plugins:[{name:'vue-runtime',setup(b){b.onResolve({filter:/^vue$/},()=>({path:'vue',namespace:'runtime'}));b.onLoad({filter:/.*/,namespace:'runtime'},()=>({contents:'module.exports=globalThis.Vue;',loader:'js'}));}}]});
  writeFileSync(join(dir,'fixture.html'),`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'"><div id="fixture"></div><script src="${pathToFileURL(join(here,'../renderer/vendor/vue.runtime.global.prod.js')).href}"></script><script src="page.js"></script><script src="checks.js"></script>`);
  writeFileSync(join(dir,'checks.js'),`(async()=>{
    const checks=[];const check=(v,label)=>{if(!v)throw Error(label);checks.push(label);};
    const wait=async()=>{await Vue.nextTick();await new Promise(r=>setTimeout(r,30));await Vue.nextTick();};
    const button=t=>Array.from(document.querySelectorAll('button')).find(n=>n.textContent===t);
    const input=(label,value)=>{const n=document.querySelector('input[aria-label="'+label+'"]');check(!!n,label);n.value=value;n.dispatchEvent(new Event('input',{bubbles:true}));};
    for(const changed of [false,true]){
      let saves=0,retries=[];const provider={id:'p',name:'供应商',baseUrl:'https://example.com/v1',protocol:'openai-completions',transport:'direct',sortOrder:1,enabled:true,declared:false,credentialWritable:true,models:[{id:'m',name:'模型',contextWindow:'',maxTokens:'',image:false}]};
      const app=Vue.createApp(ProviderPage.Page,{adapter:{describe:async()=>({providers:[provider],catalog:[],revision:1,writable:true}),save:async()=>{saves++;const e=Error('密钥失败');e.configurationRevision=2;throw e;},saveCredential:async(...a)=>{retries.push(a);}}});app.mount('#fixture');await wait();
      button('编辑').click();await wait();input('API 密钥','fixture-key');await wait();button('保存').click();await wait();
      check(!!button('仅重试密钥'),'部分保存显示重试按钮');
      if(changed){input('显示名称','后来修改');await wait();}
      button('仅重试密钥').click();await wait();check(saves===1,'不重复写配置');check(retries.length===(changed?0:1),'编辑后拒绝旧凭据写入');
      if(!changed)check(JSON.stringify(retries[0])===JSON.stringify(['p','fixture-key',2]),'使用配置回执修订');
      app.unmount();document.querySelector('#fixture').textContent='';
    }
    window.__result={ok:true,checks};
  })().catch(e=>window.__result={ok:false,error:e.message});`);
  writeFileSync(join(dir,'main.cjs'),`const {app,BrowserWindow}=require('electron');app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,webPreferences:{offscreen:true,nodeIntegration:false,contextIsolation:true}});await win.loadFile(${JSON.stringify(join(dir,'fixture.html'))});for(let i=0;i<200;i++){const result=await win.webContents.executeJavaScript('window.__result');if(result){console.log('PROVIDER_RESULT '+JSON.stringify(result));app.exit(result.ok?0:1);return;}await new Promise(r=>setTimeout(r,100));}app.exit(1);}).catch(e=>{console.error(e);app.exit(1);});`);
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const electron=require('electron');
  const child=spawn(electron,['--no-sandbox','--disable-gpu','--user-data-dir='+join(dir,'user-data'),join(dir,'main.cjs')],{env,windowsHide:true});
  let output='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>output+=v);
  const timer=setTimeout(()=>child.kill(),30000);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);}).finally(()=>clearTimeout(timer));
  assert.equal(code,0,output);const line=output.split(/\r?\n/).find(v=>v.startsWith('PROVIDER_RESULT '));assert.ok(line,output);assert.equal(JSON.parse(line.slice(16)).ok,true);console.log(dir);
});