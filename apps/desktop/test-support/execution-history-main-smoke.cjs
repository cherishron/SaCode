// 真实主窗口恢复已取消的持久执行任务；不启动命令。
const {readFileSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');
module.exports=async({app,bridge,SESSION_DIR,SESSION_LOG,seedIfNeeded,createWindow})=>{
 let win;
 try{
  seedIfNeeded();await bridge.start(SESSION_DIR);
  await bridge.request('workspace/set-directory',{sessionId:'current',directory:SESSION_DIR});
  const workspace=await bridge.request('workspace/get');
  const proposal=JSON.stringify({workspaceRevision:workspace.revision,cwd:workspace.directory,executable:'never-run-in-history-smoke',argv:[],timeoutMs:1000,outputLimit:64});
  const task=await bridge.request('execution/propose',{sessionId:'current',taskId:'history-smoke',requestId:'history-smoke',proposal});
  await bridge.request('execution/stop',{sessionId:'current',executionId:task.executionId,revision:task.revision});
  const facts=()=>readFileSync(SESSION_LOG,'utf8').split('\n').filter(line=>line.includes('\texecution/'));
  const before=facts();win=createWindow();const js=code=>win.webContents.executeJavaScript(code);
  const wait=async code=>{for(let i=0;i<300;i++){if(await js(code))return;await new Promise(done=>setTimeout(done,30));}throw Error('execution-history-timeout:'+code);};
  await wait("!!document.querySelector('#toggle-side')&&!!window.sacode?.executionList");
  await js("(()=>{if(!document.querySelector('#add-resource')?.getClientRects().length)document.querySelector('#toggle-side').click();})()");
  await wait("!!document.querySelector('#add-resource')?.getClientRects().length");
  await js("document.querySelector('#add-resource').click()");await wait("!!document.querySelector('.workbench-resource-list')");
  await js("(()=>{const b=[...document.querySelectorAll('.workbench-resource-list button')].find(b=>b.textContent.trim()==='终端');if(!b)throw Error('terminal-resource-missing');b.click();})()");
  await wait("!!document.querySelector('#side-page-terminal .execution-task')?.getClientRects().length");
  const match=JSON.stringify(task.executionId+' · 启动前已取消');
  await wait(`[...document.querySelectorAll('[aria-label="持久执行任务"] button')].some(b=>b.textContent===${match})`);
  await js(`(()=>{const b=[...document.querySelectorAll('[aria-label="持久执行任务"] button')].find(b=>b.textContent===${match});b.click();})()`);
  await wait("!!document.querySelector('.execution-state')?.textContent.includes('never-run-in-history-smoke')");
  const history=await js("window.sacode.executionList('current',-1,16)");
  if(history.records.length!==1||history.records[0].phase!=='cancelled-before-start')throw Error('execution-history-state-mismatch');
  if(JSON.stringify(facts())!==JSON.stringify(before))throw Error('history-read-started-or-mutated-execution');
  await js("document.querySelector('[aria-label=\"持久执行任务\"]').scrollIntoView({block:'start'})");
  win.showInactive();await new Promise(done=>setTimeout(done,300));
  const visible=await js("(()=>{const r=document.querySelector('[aria-label=\"持久执行任务\"]').getBoundingClientRect();return r.top>=0&&r.top<innerHeight;})()");
  if(!visible)throw Error('execution-history-not-visible');
  writeFileSync(join(SESSION_DIR,'execution-history.png'),(await win.webContents.capturePage()).toPNG());
  writeFileSync(join(SESSION_DIR,'execution-history-smoke.json'),JSON.stringify({passed:true,realHost:true,realIpc:true,realWindow:true,startsCommand:false,executionId:task.executionId}));
  await bridge.stop();console.log('EXECUTION_HISTORY_MAIN_SMOKE PASS');app.exit(0);
 }catch(error){console.error('EXECUTION_HISTORY_MAIN_SMOKE FAIL',error);await bridge.stop();app.exit(1);}
};
