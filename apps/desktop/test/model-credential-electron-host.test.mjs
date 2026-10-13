import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
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
  writeFileSync(join(dir,'fixture.html'),`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'"><script src="checks.js"></script>`);
  writeFileSync(join(dir,'checks.js'),`(async()=>{
    try {
      const r=await window.sacode.modelsSaveCredential('electron','fixture-electron-key',1);
      if(r.saved!==true)throw Error('missing-saved-fact');
      let refused=false;try{await window.sacode.modelsSaveCredential('electron','fixture-stale-key',0);}catch(e){refused=String(e).includes('settings-conflict');}
      if(!refused)throw Error('stale-not-refused');
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
      const win=new BrowserWindow({show:false,webPreferences:{offscreen:true,contextIsolation:true,nodeIntegration:false,preload:${JSON.stringify(join(desktop,'preload.cjs'))}}});
      await win.loadFile(${JSON.stringify(join(dir,'fixture.html'))});
      for(let i=0;i<200;i++){
        const result=await win.webContents.executeJavaScript('window.__result');
        if(result){const view=await bridge.request('model/registry/describe');if(view.revision!==1||view.providers[0].keyConfigured!==true)throw Error('missing-core-state');console.log('CREDENTIAL_RESULT '+JSON.stringify(result));bridge.stop();app.exit(result.ok?0:1);return;}
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
