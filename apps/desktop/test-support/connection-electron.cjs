'use strict';
const {app,BrowserWindow,ipcMain}=require('electron');
const {join}=require('node:path');const {writeFileSync,mkdtempSync,mkdirSync}=require('node:fs');
const repo=process.env.SACODE_CONNECTION_REPO,root=process.env.SACODE_CONNECTION_FIXTURE;
const {HostBridge}=require(join(repo,'apps/desktop/host-bridge.cjs'));
let bridge,win;
function domainId(v){return typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);}
function domainText(max){return v=>typeof v==='string'&&v.length<=max;}
function domainInt(min,max){return v=>Number.isSafeInteger(v)&&v>=min&&v<=max;}
function domainEnum(...vals){return v=>vals.includes(v);}
function domainCredentialRef(v){return typeof v==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(v);}
function domainObject(spec){return v=>{if(!v||typeof v!=='object'||Array.isArray(v))return false;for(const k in spec){if(!Object.hasOwn(v,k)||!spec[k](v[k]))return false;}return true;};}
function domainArray(item,max){return v=>Array.isArray(v)&&v.length<=max&&v.every(item);}
function domainConnectionDefinition(v){
  if(!v||typeof v!=='object'||Array.isArray(v))return false;
  const common={id:x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(x),title:domainText(600),enabled:x=>typeof x==='boolean'};
  const target={host:domainText(253),port:domainInt(1,65535),user:domainText(256),credentialRef:domainCredentialRef};
  const ssh=domainObject({...common,kind:domainEnum('ssh'),spec:domainObject(target)});
  const database=domainObject({...common,kind:domainEnum('database'),spec:domainObject({...target,engine:domainEnum('postgresql','mysql','dm'),database:domainText(256),tlsMode:domainEnum('verify-full')})});
  const envRef=domainObject({key:domainCredentialRef,credentialRef:domainCredentialRef});
  const stdio=domainObject({...common,kind:domainEnum('mcp'),spec:domainObject({transport:domainEnum('stdio'),command:domainText(4096),args:domainArray(domainText(4096,0),100),envRefs:domainArray(envRef,128)})});
  const http=domainObject({...common,kind:domainEnum('mcp'),spec:domainObject({transport:domainEnum('http'),endpoint:domainText(4096),credentialRef:domainCredentialRef})});
  return ssh(v)||database(v)||stdio(v)||http(v);
}
function domainParams(args,required){if(!domainObject(required)(args))throw new TypeError('ipc-invalid-arguments');return Object.fromEntries(Object.keys(args).map(k=>[k,args[k]]));}
function registerConnectionIpc(ipcMain,request){
  ipcMain.handle('sacode:connectionList',(_e,a)=>{const p=domainParams(a,{sessionId:domainId,scope:domainEnum('user','project')});return request('connection/list',p);});
  ipcMain.handle('sacode:connectionSave',(_e,a)=>{const p=domainParams(a,{sessionId:domainId,scope:domainEnum('user','project'),revision:domainInt(0),definition:domainConnectionDefinition});return request('connection/save',p);});
  ipcMain.handle('sacode:connectionControl',(_e,a)=>{const p=domainParams(a,{sessionId:domainId,scope:domainEnum('user','project'),revision:domainInt(0),id:domainText(80),action:domainEnum('enable','disable','remove')});return request('connection/control',p);});
}
app.whenReady().then(async()=>{
 try{
  bridge=new HostBridge(process.env.SACODE_HOST,process.env);await bridge.start(root);await bridge.request('initialize');const catalog=await bridge.request('session/catalog');const sessionId=catalog.entries.find(x=>x.current).id;await bridge.request('workspace/set-directory',{sessionId,directory:root});
  registerConnectionIpc(ipcMain,(method,args)=>bridge.request(method,args));
  win=new BrowserWindow({show:false,width:1100,height:850,webPreferences:{preload:join(repo,'apps/desktop/preload.cjs'),contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  await win.loadFile(join(root,'fixture.html'));
  const start=Date.now();let result;while(Date.now()-start<60000){result=await win.webContents.executeJavaScript('window.connectionResult||null');if(result)break;await new Promise(r=>setTimeout(r,100));}
  if(!result?.ok)throw Error(result?.error||'connection-ui-timeout');
  win.showInactive();win.webContents.invalidate();await new Promise(r=>setTimeout(r,200));
  writeFileSync(join(root,'connection-light.png'),(await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript("document.documentElement.dataset.theme='dark'");await new Promise(r=>setTimeout(r,100));writeFileSync(join(root,'connection-dark.png'),(await win.webContents.capturePage()).toPNG());
  win.setSize(500,850);await new Promise(r=>setTimeout(r,150));const overflow=await win.webContents.executeJavaScript('document.documentElement.scrollWidth>innerWidth');if(overflow)throw Error('connection-narrow-overflow');writeFileSync(join(root,'connection-narrow.png'),(await win.webContents.capturePage()).toPNG());
  writeFileSync(join(root,'result.json'),JSON.stringify({...result,overflow}));await bridge.stop(10000);app.exit(0);
 }catch(e){writeFileSync(join(root,'result.json'),JSON.stringify({ok:false,error:e.message}));if(bridge)await bridge.stop(10000);app.exit(1);}
});
