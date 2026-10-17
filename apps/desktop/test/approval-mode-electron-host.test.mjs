import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
const require=createRequire(import.meta.url),desktop=dirname(dirname(fileURLToPath(import.meta.url)));

test('实际权限菜单经Electron IPC切换并回读真实Host',{timeout:40000},async()=>{
  const host=process.env.SACODE_HOST||join(desktop,'dist/host/bin/sacode-host.exe');
  const dir=mkdtempSync(join(tmpdir(),'sacode-mode-electron-'));mkdirSync(join(dir,'user-data'));
  copyFileSync(join(desktop,'renderer/vendor/vue.runtime.global.prod.js'),join(dir,'vue.js'));
  await build({entryPoints:[join(desktop,'renderer/pages/permission-menu.ts')],bundle:true,format:'iife',globalName:'ModePage',outfile:join(dir,'page.js'),plugins:[{name:'vue-runtime',setup(b){b.onResolve({filter:/^vue$/},()=>({path:'vue',namespace:'runtime'}));b.onLoad({filter:/.*/,namespace:'runtime'},()=>({contents:'module.exports=globalThis.Vue;',loader:'js'}));}}]});
  writeFileSync(join(dir,'fixture.html'),`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'"><div id="fixture"></div><script src="vue.js"></script><script src="page.js"></script><script src="checks.js"></script>`);
  writeFileSync(join(dir,'checks.js'),`(async()=>{try{
    Vue.createApp(ModePage.PermissionMenu).mount('#fixture');
    const wait=async(fn)=>{for(let i=0;i<150;i++){await Vue.nextTick();if(fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('mode-state-timeout');};
    const trigger=()=>document.querySelector('.permission-trigger');
    await wait(()=>trigger()?.getAttribute('aria-label')==='权限模式，当前build');
    for(const mode of ['plan','auto','yolo','build','plan']){
      trigger().click();await wait(()=>document.querySelector('.permission-popover'));
      const button=[...document.querySelectorAll('.permission-popover button')].find(b=>b.querySelector('strong')?.textContent===mode);
      if(!button||button.disabled)throw Error('mode-button-unavailable');button.click();
      await wait(()=>trigger().getAttribute('aria-label')==='权限模式，当前'+mode&&!document.querySelector('.permission-popover'));
    }
    window.__result={ok:true};
  }catch(e){window.__result={ok:false,error:String(e)};}})();`);
  writeFileSync(join(dir,'main.cjs'),`const {app,BrowserWindow,ipcMain}=require('electron');const {HostBridge}=require(${JSON.stringify(join(desktop,'host-bridge.cjs'))});
    const bridge=new HostBridge(${JSON.stringify(host)},{...process.env,SACODE_USER_SETTINGS_DIR:${JSON.stringify(join(dir,'settings'))}});
    app.whenReady().then(async()=>{
      await bridge.start(${JSON.stringify(dir)});
      ipcMain.handle('sacode:approvalGetMode',()=>bridge.request('approval/get-mode'));
      ipcMain.handle('sacode:approvalSetMode',(_event,args)=>{if(!args||!['plan','build','auto','yolo'].includes(args.mode))throw Error('bad-approval-mode');return bridge.request('approval/set-mode',{mode:args.mode});});
      const win=new BrowserWindow({show:false,webPreferences:{offscreen:true,contextIsolation:true,nodeIntegration:false,preload:${JSON.stringify(join(desktop,'preload.cjs'))}}});await win.loadFile(${JSON.stringify(join(dir,'fixture.html'))});
      for(let i=0;i<200;i++){const result=await win.webContents.executeJavaScript('window.__result');if(result){if(result.ok){await bridge.stop();await bridge.start(${JSON.stringify(dir)});if((await bridge.request('approval/get-mode')).mode!=='plan')throw Error('mode-not-persisted');}await bridge.stop();console.log('MODE_RESULT '+JSON.stringify(result));app.exit(result.ok?0:1);return;}await new Promise(r=>setTimeout(r,100));}throw Error('mode-window-timeout');
    }).catch(async e=>{console.error(e);await bridge.stop();app.exit(1);});`);
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(require('electron'),['--no-sandbox','--disable-gpu','--user-data-dir='+join(dir,'user-data'),join(dir,'main.cjs')],{env,windowsHide:true});
  let output='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>output+=v);
  const timer=setTimeout(()=>child.kill(),30000);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);}).finally(()=>clearTimeout(timer));
  assert.equal(code,0,output);assert.ok(output.includes('MODE_RESULT {"ok":true}'),output);
});
