// 独立 Electron 目标栏验收：真实 Vue 页面 → 有限 IPC → 仓颉宿主，无模型夹具。
const {app,BrowserWindow,ipcMain}=require('electron');
const {HostBridge}=require('../host-bridge.cjs');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {pathToFileURL}=require('node:url');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'sacode-goal-ui-'));
const log=process.env.SACODE_GOAL_SMOKE_LOG||path.join(root,'result.log');
const record=text=>fs.appendFileSync(log,text+'\n');
let bridge,win,checks=0;
app.whenReady().then(async()=>{
 try{
  bridge=new HostBridge(process.env.SACODE_HOST||path.resolve(__dirname,'../dist/host/bin/sacode-host.exe'),{...process.env,SACODE_USER_SETTINGS_DIR:path.join(root,'settings'),SACODE_PROVIDER_KEY:'',SACODE_PROVIDER_BASE_URL:'',STEPFUN_API_KEY:''});await bridge.start(root);
  const actions=['describe','create','edit','pause','resume','clear'];
  ipcMain.handle('goal-smoke',(_e,action,revision,objective)=>{if(!actions.includes(action))throw Error('非法动作');return bridge.request('goal/'+action,{sessionId:'current',...(revision===undefined?{}:{revision}),...(objective===undefined?{}:{objective})});});
  const preload=path.join(root,'preload.cjs');fs.writeFileSync(preload,"const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('goalAdapter',{describe:()=>ipcRenderer.invoke('goal-smoke','describe'),create:text=>ipcRenderer.invoke('goal-smoke','create',undefined,text),edit:(rev,text)=>ipcRenderer.invoke('goal-smoke','edit',rev,text),pause:rev=>ipcRenderer.invoke('goal-smoke','pause',rev),resume:rev=>ipcRenderer.invoke('goal-smoke','resume',rev),clear:rev=>ipcRenderer.invoke('goal-smoke','clear',rev)});");
  const renderer=path.resolve(__dirname,'../renderer'),url=p=>pathToFileURL(path.join(renderer,p)).href;
  const html=path.join(root,'goal.html');fs.writeFileSync(html,`<!doctype html><html lang="zh"><head><meta charset="utf-8"><link rel="stylesheet" href="${url('styles.css')}"><link rel="stylesheet" href="${url('goal-bar.css')}"></head><body><div id="app"></div><script src="${url('vendor/vue.runtime.global.prod.js')}"></script><script src="${url('vendor/goal-bar.iife.js')}"></script></body></html>`);
  win=new BrowserWindow({show:false,width:1000,height:450,webPreferences:{preload,contextIsolation:true,nodeIntegration:false}});win.webContents.on('console-message',(_e,_l,msg)=>record('console: '+msg));await win.loadFile(html);
  await win.webContents.executeJavaScript("void Vue.createApp({render:()=>Vue.h(SaCodeGoal.GoalBar,{adapter:window.goalAdapter})}).mount('#app')");
  const wait=async(predicate)=>{for(let i=0;i<100;i++){if(await win.webContents.executeJavaScript(predicate))return;await new Promise(r=>setTimeout(r,30));}throw Error('界面超时：'+predicate);};
  const check=async(predicate)=>{await wait(predicate);checks++;};
  const click=async(label)=>win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(label)}).click()`);
  const submit=async(text)=>win.webContents.executeJavaScript(`(()=>{const box=document.querySelector('textarea');box.value=${JSON.stringify(text)};box.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));})()`);
  await check("document.body.textContent.includes('设置持续目标')");await click('设置持续目标');await submit('真实宿主界面目标');await check("document.querySelector('.goal-objective')?.textContent==='真实宿主界面目标'");
  if((await bridge.request('goal/describe',{sessionId:'current'})).revision!==1)throw Error('创建未落核心');checks++;
  await click('暂停');await check("document.querySelector('.goal-phase')?.textContent==='已暂停'");
  await click('恢复');await check("document.querySelector('.goal-phase')?.textContent==='已启用'");
  await click('编辑');await submit('修改后的真实目标');await check("document.querySelector('.goal-objective')?.textContent==='修改后的真实目标'");
  fs.writeFileSync(path.join(root,'goal-bar.png'),(await win.webContents.capturePage()).toPNG());
  await click('删除');await check("!document.querySelector('.goal-objective') && document.body.textContent.includes('设置持续目标')");
  if((await bridge.request('goal/describe',{sessionId:'current'})).phase!=='none')throw Error('删除未落核心');checks++;
  record(`GOAL_UI PASS ${checks} checks; screenshot=${path.join(root,'goal-bar.png')}`);win.destroy();await bridge.stop();app.exit(0);
 }catch(e){record('GOAL_UI FAIL '+e.stack);if(win)record(await win.webContents.executeJavaScript('document.body.innerText'));if(win)win.destroy();if(bridge)await bridge.stop();app.exit(1);}
});
