'use strict';
const {readFileSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');
module.exports=async function pageToolsMainSmoke({app,bridge,SESSION_DIR,SESSION_LOG,seedIfNeeded,createWindow}) {
  seedIfNeeded();await bridge.start(SESSION_DIR);const win=createWindow();
  const js=code=>win.webContents.executeJavaScript(code);
  try {
    for(let i=0;i<150;i++){
      if(await js("!!document.querySelector('.app[data-page-session=\"current\"]')"))break;
      await new Promise(r=>setTimeout(r,40));
    }
    if(!await js("!!document.querySelector('.app[data-page-session=\"current\"]')"))throw Error('page-session-not-ready');
    await js("(()=>{const button=document.createElement('button');button.id='page-core-probe';button.textContent='页面核心接线检查';button.dataset.clicks='0';button.addEventListener('click',()=>button.dataset.clicks=String(Number(button.dataset.clicks)+1));document.body.appendChild(button);})()");
    const read=await js("window.sacode.pageToolCall('page.readState',{selector:'#page-core-probe'})");
    if(read.text!=='页面核心接线检查'||read.tag!=='BUTTON')throw Error('page-core-read-mismatch');
    await bridge.request('approval/set-mode',{mode:'plan'});
    const rejected=await js("window.sacode.pageToolCall('page.clickElement',{selector:'#page-core-probe'})");
    if(!String(rejected.error).includes('approval-mode-denied'))throw Error('page-plan-not-rejected');
    if(await js("document.querySelector('#page-core-probe').dataset.clicks")!=='0')throw Error('page-mutated-in-plan');
    await js("document.querySelector('.app').setAttribute('data-page-session','different')");
    const stale=await js("window.sacode.pageToolCall('page.readState',{selector:'#page-core-probe'})");
    if(stale.error!=='page-session-not-rendered')throw Error('page-render-session-guard-missing');
    await js("document.querySelector('.app').setAttribute('data-page-session','current')");
    await bridge.stop();
    const log=readFileSync(SESSION_LOG,'utf8');
    if(!log.includes('page-tool/dispatch')||!log.includes('page-tool/result')||log.includes('goal/evidence'))throw Error('page-audit-facts-mismatch');
    writeFileSync(join(SESSION_DIR,'page-tools-smoke.json'),JSON.stringify({passed:true,realHost:true,realMainWindow:true,realPreload:true,realHandler:true,paidModel:false,nativeApprovalNotTested:true}));
    console.log('PAGE_TOOLS_MAIN_SMOKE PASS');app.exit(0);
  } catch(error) {console.error('PAGE_TOOLS_MAIN_SMOKE FAIL',error);await bridge.stop();app.exit(1);}
};
