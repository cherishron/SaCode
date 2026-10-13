import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,copyFileSync} from 'node:fs';
import {build} from 'esbuild';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
const require=createRequire(import.meta.url);
const desktop=dirname(dirname(fileURLToPath(import.meta.url)));

test('真实Electron preload和IPC到Host的凭据保存与冲突拒绝',{timeout:40000},async()=>{
  const host=process.env.SACODE_HOST||join(desktop,'dist/host/bin/sacode-host.exe');
  assert.ok(existsSync(host),'需要本批源码构建的Host');
  const dir=mkdtempSync(join(tmpdir(),'sacode-credential-electron-'));mkdirSync(join(dir,'user-data'));
  copyFileSync(join(desktop,'renderer/vendor/vue.runtime.global.prod.js'),join(dir,'vue.js'));
  await build({stdin:{contents:`export {Page} from './provider-settings.ts'; export {createModelCenterAdapters} from './model-center-adapter.ts';`,resolveDir:join(desktop,'renderer/pages'),loader:'ts'},bundle:true,format:'iife',globalName:'ModelPage',outfile:join(dir,'page.js'),plugins:[{name:'vue-runtime',setup(b){b.onResolve({filter:/^vue$/},()=>({path:'vue',namespace:'runtime'}));b.onLoad({filter:/.*/,namespace:'runtime'},()=>({contents:'module.exports=globalThis.Vue;',loader:'js'}));}}]});
  writeFileSync(join(dir,'fixture.html'),`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'"><div id="fixture"></div><script src="vue.js"></script><script src="page.js"></script><script src="checks.js"></script>`);
  writeFileSync(join(dir,'checks.js'),`(async()=>{
    try {
      const r=await window.sacode.modelsSaveCredential('electron','fixture-electron-key',1);
      if(r.saved!==true)throw Error('missing-saved-fact');
      let refused=false;try{await window.sacode.modelsSaveCredential('electron','fixture-stale-key',0);}catch(e){refused=String(e).includes('settings-conflict');}
      if(!refused)throw Error('stale-not-refused');
      const app=Vue.createApp(ModelPage.Page,{adapter:ModelPage.createModelCenterAdapters(window.sacode)['provider-settings']});app.mount('#fixture');
      const wait=async(predicate)=>{for(let i=0;i<100;i++){await Vue.nextTick();if(predicate())return;await new Promise(r=>setTimeout(r,20));}throw Error('page-state-timeout');};
      const button=text=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent===text);
      await wait(()=>button('编辑')&&!button('编辑').disabled);button('编辑').click();await Vue.nextTick();
      const key=document.querySelector('input[aria-label="API 密钥"]');if(!key)throw Error('missing-key-editor');key.value='fixture-page-key';key.dispatchEvent(new Event('input',{bubbles:true}));await Vue.nextTick();button('保存').click();
      await wait(()=>document.body.textContent.includes('已保存（能力按用户声明记录，未自动验证）'));
      if(document.querySelector('input[aria-label="API 密钥"]'))throw Error('editor-not-closed');app.unmount();
      window.__result={ok:true};
    }catch(e){window.__result={ok:false,error:String(e)};}
  })();`);
  writeFileSync(join(dir,'main.cjs'),`const {app,BrowserWindow,ipcMain}=require('electron');
    const {HostBridge}=require(${JSON.stringify(join(desktop,'host-bridge.cjs'))});
    const {registerModelCredentialIpc}=require(${JSON.stringify(join(desktop,'model-credential-ipc.cjs'))});
    const bridge=new HostBridge(${JSON.stringify(host)},{...process.env,SACODE_USER_SETTINGS_DIR:${JSON.stringify(join(dir,'settings'))}});
    app.on('before-quit',()=>bridge.stop());
    app.whenReady().then(async()=>{
      await bridge.start(${JSON.stringify(dir)});
      const empty=await bridge.request('model/registry/describe');
      const saved=await bridge.request('model/registry/update',{draft:{id:'electron',name:'Electron测试',baseUrl:'https://example.com/v1',protocol:'openai-completions',models:[{id:'m',name:'模型',contextWindow:'',maxTokens:'',image:false}]},expectedRevision:empty.revision});
      if(saved.revision!==1)throw Error('unexpected-fixture-revision');
      registerModelCredentialIpc(ipcMain,(method,args)=>bridge.request(method,args),require(${JSON.stringify(join(desktop,'models-guard.cjs'))}));
      ipcMain.handle('sacode:modelsDescribe',()=>bridge.request('model/registry/describe'));
      ipcMain.handle('sacode:modelsCatalog',()=>bridge.request('model/registry/catalog'));
      ipcMain.handle('sacode:modelsSave',(_event,args)=>{
        const guard=require(${JSON.stringify(join(desktop,'models-guard.cjs'))});
        return require(${JSON.stringify(join(desktop,'models-save.cjs'))}).saveModelConfiguration((method,params)=>bridge.request(method,params),guard.sanitizeDraft(args.draft),guard.sanitizeKey(args.key),guard.sanitizeRevision(args.expectedRevision));
      });
      const win=new BrowserWindow({show:false,webPreferences:{offscreen:true,contextIsolation:true,nodeIntegration:false,preload:${JSON.stringify(join(desktop,'preload.cjs'))}}});
      await win.loadFile(${JSON.stringify(join(dir,'fixture.html'))});
      for(let i=0;i<200;i++){
        const result=await win.webContents.executeJavaScript('window.__result');
        if(result){const view=await bridge.request('model/registry/describe');if(result.ok&&(view.revision!==2||view.providers[0].keyConfigured!==true))throw Error('missing-core-state');if(result.ok){const fs=require('node:fs');const keys=fs.readFileSync(${JSON.stringify(join(dir,'settings/credentials.env'))},'utf8');if(!keys.includes('fixture-page-key')||keys.includes('fixture-stale-key'))throw Error('wrong-persisted-key');}console.log('CREDENTIAL_RESULT '+JSON.stringify(result));bridge.stop();app.exit(result.ok?0:1);return;}
        await new Promise(r=>setTimeout(r,100));
      }throw Error('renderer-timeout');
    }).catch(e=>{console.error(e);bridge.stop();app.exit(1);});`);
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(require('electron'),['--no-sandbox','--disable-gpu','--user-data-dir='+join(dir,'user-data'),join(dir,'main.cjs')],{env,windowsHide:true});
  let output='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>output+=v);
  const timer=setTimeout(()=>child.kill(),30000);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);}).finally(()=>clearTimeout(timer));
  assert.equal(code,0,output);assert.ok(output.includes('CREDENTIAL_RESULT {"ok":true}'),output);
});
