const {app,BrowserWindow,ipcMain}=require('electron');
const {join}=require('node:path');const {writeFileSync}=require('node:fs');
const repo=process.env.SACODE_KNOWLEDGE_REPO,root=process.env.SACODE_KNOWLEDGE_FIXTURE;
const {HostBridge}=require(join(repo,'apps/desktop/host-bridge.cjs'));
const {registerKnowledgeIpc}=require(join(repo,'apps/desktop/knowledge-ipc.cjs'));
let bridge,win;
app.whenReady().then(async()=>{
 try{
  bridge=new HostBridge(process.env.SACODE_HOST,process.env);await bridge.start(root);await bridge.request('workspace/set-directory',{sessionId:'current',directory:root});
  registerKnowledgeIpc(ipcMain,(method,args)=>bridge.request(method,args));
  win=new BrowserWindow({show:false,width:1100,height:850,webPreferences:{preload:join(repo,'apps/desktop/preload.cjs'),contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  await win.loadFile(join(root,'fixture.html'));
  const start=Date.now();let result;while(Date.now()-start<60000){result=await win.webContents.executeJavaScript('window.knowledgeResult||null');if(result)break;await new Promise(r=>setTimeout(r,100));}
  if(!result?.ok)throw Error(result?.error||'knowledge-ui-timeout');
  const disclosure=await win.webContents.executeJavaScript("document.body.textContent.includes('相关片段会随任务请求发送给当前模型。')&&!document.body.textContent.includes('不自动发送给模型')");
  if(!disclosure)throw Error('knowledge-model-disclosure-missing');
  win.showInactive();win.webContents.invalidate();await new Promise(r=>setTimeout(r,200));
  writeFileSync(join(root,'knowledge-light.png'),(await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript("document.documentElement.dataset.theme='dark'");await new Promise(r=>setTimeout(r,100));writeFileSync(join(root,'knowledge-dark.png'),(await win.webContents.capturePage()).toPNG());
  win.setSize(500,850);await new Promise(r=>setTimeout(r,150));const overflow=await win.webContents.executeJavaScript('document.documentElement.scrollWidth>innerWidth');if(overflow)throw Error('knowledge-narrow-overflow');writeFileSync(join(root,'knowledge-narrow.png'),(await win.webContents.capturePage()).toPNG());
  writeFileSync(join(root,'result.json'),JSON.stringify({...result,overflow}));await bridge.stop(10000);app.exit(0);
 }catch(e){writeFileSync(join(root,'result.json'),JSON.stringify({ok:false,error:e.message}));if(bridge)await bridge.stop(10000);app.exit(1);}
});
