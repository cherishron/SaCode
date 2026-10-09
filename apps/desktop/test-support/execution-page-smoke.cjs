// 渲染正式 Vue 页面、preload 和抽取的正式有限 IPC；服务端为本轮新 Host。
// 此独立页面夹具不替代完整产品窗口或安装包验收。
const {app,BrowserWindow,ipcMain}=require('electron');
const {readFileSync,writeFileSync,mkdirSync,existsSync}=require('node:fs');
const {join,resolve}=require('node:path');
const {pathToFileURL}=require('node:url');
const vm=require('node:vm');
const {HostBridge}=require('../host-bridge.cjs');
const root=process.env.SACODE_EXECUTION_PAGE_DIR;if(!root)throw Error('需要私有取证目录');
mkdirSync(root,{recursive:true});app.setPath('userData',join(root,'electron'));
writeFileSync(join(root,'session.log'),`0\tworkspace/directory\t${root.replaceAll('\\','\\\\')}\n`);
const desktop=resolve(__dirname,'..');
const bridge=new HostBridge(process.env.SACODE_HOST,{...process.env,PATH:join(process.env.SystemRoot,'System32'),SACODE_USER_SETTINGS_DIR:join(root,'settings'),SACODE_PROVIDER_KEY:'',STEPFUN_API_KEY:'',TEMP:root,TMP:root});
const main=readFileSync(join(desktop,'main.cjs'),'utf8');
const context={ipcMain,bridge,withHost:fn=>fn(),isStr:v=>typeof v==='string',Buffer};
vm.runInNewContext(main.slice(main.indexOf('const executionActions'),main.indexOf('ipcMain.handle("sacode:projection"')),context);
vm.runInNewContext(main.slice(main.indexOf('ipcMain.handle("sacode:approvalAsk"'),main.indexOf('ipcMain.handle("sacode:turnStart"')),context);
ipcMain.handle('sacode:workspaceGet',()=>bridge.request('workspace/get',{}));
ipcMain.handle('sacode:terminalOutput',(_e,{sessionId,cursor,limit})=>bridge.request('session/terminal-output',{sessionId,cursor,limit}));
const url=p=>pathToFileURL(join(desktop,'renderer',p)).href;
writeFileSync(join(root,'index.html'),`<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:"><link rel="stylesheet" href="${url('styles.css')}"><link rel="stylesheet" href="${url('product-design.css')}"></head><body><div id="app"></div><script src="${url('vendor/vue.runtime.global.prod.js')}"></script><script src="${url('vendor/tinyvue.iife.js')}"></script><script src="${url('vendor/client-slots.iife.js')}"></script><script src="mount.js"></script></body></html>`);
writeFileSync(join(root,'mount.js'),`Vue.createApp({render(){return Vue.h(SaCodeSlots.TerminalOutput,{active:true,sessionId:'current',executionApi:window.sacode,read:cursor=>window.sacode.terminalOutput('current',cursor,16)})}}).mount('#app');`);
const checks=[],errors=[];let win;const deadline=setTimeout(()=>{console.error('页面取证超时');app.exit(1)},45000);
app.whenReady().then(async()=>{
 await bridge.start(root);win=new BrowserWindow({show:false,width:700,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false,preload:join(desktop,'preload.cjs')}});
 win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)errors.push(message)});
 const js=s=>win.webContents.executeJavaScript(s);
 async function wait(s){for(let i=0;i<100;i++){if(await js(s))return;await new Promise(r=>setTimeout(r,50))}throw Error('等待失败：'+s)}
 function check(name,value){checks.push({name,pass:!!value});if(!value)throw Error(name)}
 await win.loadFile(join(root,'index.html'));
 await wait(`document.querySelector('.execution-task')?.textContent.includes('修订 1')`);
 await js(`const input=document.querySelector('.execution-form input');input.value='cmd';input.dispatchEvent(new Event('input',{bubbles:true}));`);
 await js(`[...document.querySelectorAll('button')].find(b=>b.textContent==='保存提案').click()`);
 await wait(`document.querySelector('.execution-state')?.textContent.includes('等待审批')`);
 check('真实页面保存提案并显示全部原始字段',await js(`const s=document.querySelector('.execution-state').textContent;['workspaceRevision','executable','argv','timeoutMs','outputLimit','SHA256'].every(k=>s.includes(k))`));
 await js(`[...document.querySelectorAll('button')].find(b=>b.textContent==='批准此提案一次').click()`);
 await wait(`document.querySelector('.execution-state')?.textContent.includes('已准入')`);
 check('启动按钮遵守关闭的监督门禁',await js(`[...document.querySelectorAll('button')].find(b=>b.textContent==='启动').disabled`));
 await js(`[...document.querySelectorAll('button')].find(b=>b.textContent==='读取已保存输出').click()`);
 await wait(`!document.querySelector('.execution-task [role=status]')`);
 check('空分页不标记 EOF',await js(`document.querySelector('.execution-state').textContent.includes('未收到采集结束记录')`));
 await js(`[...document.querySelectorAll('button')].find(b=>b.textContent==='取消提案').click()`);
 await wait(`document.querySelector('.execution-state')?.textContent.includes('启动前已取消')`);
 for(const theme of ['light','dark']){await js(`document.documentElement.setAttribute('data-theme','${theme}')`);writeFileSync(join(root,theme+'.png'),(await win.webContents.capturePage()).toPNG());}
 check('没有请求语言模型、没有启动执行进程',!readFileSync(join(root,'session.log'),'utf8').includes('owned-subprocess:'));
 check('CSP 与浏览器无脚本错误',errors.length===0);
 console.log('EXECUTION_PAGE_PASS '+checks.length+' checks');
 writeFileSync(join(root,'checks.json'),JSON.stringify({checks,errors},null,2));
 clearTimeout(deadline);win.destroy();await bridge.stop();app.quit();
}).catch(async e=>{writeFileSync(join(root,'failure.txt'),String(e.stack||e));writeFileSync(join(root,'checks.json'),JSON.stringify({checks,errors},null,2));console.error(e);clearTimeout(deadline);if(win)win.destroy();await bridge.stop();app.exit(1)});
