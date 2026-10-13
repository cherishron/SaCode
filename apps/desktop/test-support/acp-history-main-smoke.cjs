'use strict';
const {writeFileSync,readFileSync}=require('node:fs');
const {join}=require('node:path');
module.exports=async function acpHistorySmoke({app,bridge,SESSION_DIR,SESSION_LOG,seedIfNeeded,createWindow}) {
  seedIfNeeded();
  const admission={schema:1,id:'delegation-1',sessionId:'current',taskId:'task-1',requestId:'request-1',peerId:'协议夹具',workspace:SESSION_DIR,taskDigest:'a'.repeat(64),revision:1,phase:'initializing'};
  const started={schema:1,delegationId:'delegation-1',sessionId:'current',taskId:'task-1',requestId:'request-1',protocolSessionId:'fixture-session',protocolRequestId:3,revision:3,phase:'running',detail:'intent-before-send'};
  const ended={...started,revision:4,phase:'completed',detail:'prompt-stop:end_turn'};
  const field=text=>text.replaceAll('\\','\\\\').replaceAll('\t','\\t').replaceAll('\n','\\n').replaceAll('\r','\\r');
  writeFileSync(SESSION_LOG,[[0,'acp/admission',admission],[1,'acp/task/start',started],[2,'acp/task/settled',ended]].map(([seq,type,data])=>seq+'\t'+type+'\t'+field(JSON.stringify(data))+'\n').join(''));
  const before=readFileSync(SESSION_LOG);const win=createWindow();const js=code=>win.webContents.executeJavaScript(code);
  const wait=async code=>{for(let i=0;i<200;i++){if(await js(code))return;await new Promise(resolve=>setTimeout(resolve,30));}throw Error('acp-page-timeout:'+code);};
  try {
    await wait("!!document.querySelector('#toggle-side') && !!window.sacode?.acpDelegationList");
    await js("(()=>{if(!document.querySelector('#add-resource')?.getClientRects().length)document.querySelector('#toggle-side').click();})()");
    await wait("!!document.querySelector('#add-resource')?.getClientRects().length");
    await js("document.querySelector('#add-resource').click()");
    await wait("!!document.querySelector('.workbench-resource-list')");
    await js("(()=>{const button=[...document.querySelectorAll('.workbench-resource-list button')].find(b=>b.textContent.trim()==='智能体团队');if(!button)throw Error('agents-resource-missing');button.focus();button.click();})()");
    await wait("!!document.querySelector('#side-page-agents [data-acp-delegation=\"delegation-1\"]')?.getClientRects().length");
    const text=await js("document.querySelector('.acp-history').textContent");
    if(!text.includes('协议夹具')||!text.includes('已结束')||!text.includes('prompt-stop:end_turn'))throw Error('acp-page-facts-mismatch');
    const wrongRejected=await js("window.sacode.acpDelegationList('other').then(()=>false,e=>e.message.includes('acp-session-changed'))");
    if(!wrongRejected)throw Error('acp-page-session-guard-missing');
    if(!before.equals(readFileSync(SESSION_LOG)))throw Error('acp-history-read-mutated-log');
    const click=label=>js(`(()=>{const button=[...document.querySelectorAll('.acp-history button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!button||button.disabled)throw Error('acp-control-unavailable');button.click();})()`);
    await wait("document.querySelector('.acp-history').textContent.includes('本项目会话 ACP 已关闭')");
    await click('开启 ACP');await wait("document.querySelector('.acp-history').textContent.includes('本项目会话 ACP 已开启')");
    await click('关闭 ACP');await wait("document.querySelector('.acp-history').textContent.includes('本项目会话 ACP 已关闭')");
    const saved=await js("window.sacode.acpSettingsDescribe('current')");
    if(saved.enabled!==false||saved.revision!==2)throw Error('acp-settings-roundtrip-mismatch');
    if(process.env.SACODE_ACP_OPENCODE_EXECUTABLE){
      await bridge.request('workspace/set-directory',{sessionId:'current',directory:SESSION_DIR});
      await click('检查 OpenCode 提供方');
      await wait("(()=>{const t=document.querySelector('.acp-history').textContent;return t.includes('提供方尚未就绪')||t.includes('本地凭据列表为空')||t.includes('本地凭据前提及 ACP 协议探针通过');})()");
      if(!await js("document.querySelector('.acp-history').textContent.includes('真实模型任务尚未验证')"))throw Error('acp-provider-task-boundary-missing');
    }
    const after=readFileSync(SESSION_LOG,'utf8');
    if((after.match(/\tacp\/task\/start\t/g)||[]).length!==1)throw Error('acp-settings-started-task');
    await js("document.querySelector('.acp-history').scrollIntoView({block:'start'})");
    writeFileSync(join(SESSION_DIR,'acp-readiness.png'),(await win.webContents.capturePage()).toPNG());
    writeFileSync(join(SESSION_DIR,'acp-history-smoke.json'),JSON.stringify({passed:true,fixture:'recorded-protocol-facts',realHost:true,realIpc:true,realMainWindow:true,configurationRoundTrip:true,startsTask:false,paidModel:false}));
    await bridge.stop();console.log('ACP_HISTORY_MAIN_SMOKE PASS');app.exit(0);
  }catch(error){console.error('ACP_HISTORY_MAIN_SMOKE FAIL',error);await bridge.stop();app.exit(1);}
};
