// 由 Electron 执行：实际仓颉宿主 + 实际 preload + CSP 页面 + Vue 构建产物。
// 这是图片切片验收，不替代完整应用整页或安装器验收。
const {app,BrowserWindow,ipcMain}=require('electron');
const {mkdtempSync,copyFileSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');
const {tmpdir}=require('node:os');
const assert=require('node:assert/strict');
const {HostBridge}=require('../host-bridge.cjs');
const {png}=require('./image-fixture.cjs');
require('../stdio-guard.cjs').installStdioGuard();
const root=mkdtempSync(join(process.env.SACODE_IMAGE_SMOKE_ROOT||tmpdir(),'sacode-image-electron-'));
app.setPath('userData',join(root,'electron'));
let bridge,window;
app.whenReady().then(async()=>{
 bridge=new HostBridge(process.env.SACODE_HOST,{...process.env,SACODE_USER_SETTINGS_DIR:join(root,'settings')});await bridge.start(root);
 const uploaded=await bridge.request('attachment/upload',{kind:'image',name:'可解码图片.png',mediaType:'image/png',data:png.toString('base64')});
 await bridge.request('queue/enqueue',{text:'图片',rpcId:'image-electron',receiptIds:[uploaded.receiptId]});
 ipcMain.handle('sacode:attachmentImageRead',(_event,args)=>bridge.request('attachment/image-read',args));
 const renderer=join(__dirname,'..','renderer');
 for(const file of ['vue.runtime.global.prod.js','composer-attachments.iife.js'])copyFileSync(join(renderer,'vendor',file),join(root,file));
 copyFileSync(join(renderer,'composer-attachments.css'),join(root,'images.css'));
 copyFileSync(join(__dirname,'..','preload.cjs'),join(root,'preload.cjs'));
 writeFileSync(join(root,'index.html'),`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' blob:; style-src 'self'; script-src 'self'"><link rel="stylesheet" href="images.css"><div id="app"></div><script src="vue.runtime.global.prod.js"></script><script src="composer-attachments.iife.js"></script><script src="entry.js"></script>`);
 writeFileSync(join(root,'entry.js'),`
 const state=Vue.reactive({sessionId:'current',shown:true});window.imageState=state;
 const image=${JSON.stringify(uploaded.attachment)};
 window.imageApp=Vue.createApp({setup:()=>()=>state.shown?Vue.h(SaCodeAttachments.PersistedImage,{attachment:image,sessionId:state.sessionId,label:'历史图片'}):null});
 window.imageApp.mount('#app');
 `);
 window=new BrowserWindow({show:false,webPreferences:{preload:join(root,'preload.cjs'),contextIsolation:true,nodeIntegration:false}});
 const js=code=>window.webContents.executeJavaScript(code,true);
 const wait=async(expression)=>assert.equal(await js(`(async()=>{const until=Date.now()+5000;while(Date.now()<until){if(${expression})return true;await new Promise(r=>setTimeout(r,20));}return false;})()`),true,expression);
 await window.loadFile(join(root,'index.html'));
 await wait("document.querySelector('.persisted-image img')?.naturalWidth===2 && document.querySelector('.persisted-image')?.dataset.imageState==='ready'");
 assert.deepEqual(await js("(()=>{const img=document.querySelector('.persisted-image img');return [img.naturalWidth,img.naturalHeight,img.src.startsWith('blob:')];})()"),[2,1,true]);
 await js("document.querySelector('.persisted-image-frame').focus();document.querySelector('.persisted-image-frame').click()");
 await wait("document.querySelector('dialog')?.open && document.querySelector('.attachments-original')?.naturalWidth===2");
 await js("document.querySelector('.attachments-lightbox-close').click()");
 await wait("!document.querySelector('dialog') && document.activeElement===document.querySelector('.persisted-image-frame')");
 await js("document.querySelector('.persisted-image-frame').click();imageState.sessionId='other'");
 await wait("!document.querySelector('dialog') && document.querySelector('.persisted-image')?.dataset.imageState==='error'");
 await js("imageState.sessionId='current'");
 await wait("document.querySelector('.persisted-image img')?.naturalWidth===2 && document.querySelector('.persisted-image')?.dataset.imageState==='ready'");
 await js("imageState.shown=false");await wait("!document.querySelector('.persisted-image')");
 assert.equal((await bridge.stop()).code,0);bridge=null;
 console.log('PERSISTED_IMAGE_SMOKE PASS：真实 PNG 解码、原图、关闭焦点、会话切换与卸载');window.destroy();app.exit(0);
}).catch(async error=>{console.error(error.stack||error);if(bridge)await bridge.stop();if(window&&!window.isDestroyed())window.destroy();app.exit(1);});
