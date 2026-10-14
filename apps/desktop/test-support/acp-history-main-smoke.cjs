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
  const wait=async (code,attempts=200)=>{for(let i=0;i<attempts;i++){if(await js(code))return;await new Promise(resolve=>setTimeout(resolve,30));}throw Error('acp-page-timeout:'+code);};
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
    if(process.env.SACODE_ACP_OPENCODE_EXECUTABLE||process.env.SACODE_ACP_DISCOVERY_SMOKE==='1'){
      await bridge.request('workspace/set-directory',{sessionId:'current',directory:SESSION_DIR});
      await click('开启 ACP');await wait("document.querySelector('.acp-history').textContent.includes('本项目会话 ACP 已开启')");
      await click('检查 OpenCode 提供方');
      await js("Promise.all([window.sacode.goalDescribe('current'),window.sacode.teamDescribe('current')])");
      await wait("(()=>{const t=document.querySelector('.acp-history').textContent;return t.includes('提供方尚未就绪')||t.includes('ACP 协议已连接');})()",1200);
      if(!await js("document.querySelector('.acp-history').textContent.includes('真实模型任务尚未验证')"))throw Error('acp-provider-task-boundary-missing');
      if(!await js("(()=>{const t=document.querySelector('.acp-diagnostics')?.textContent||'';return t.includes('诊断编号 acp-')&&t.includes('模型价格')&&t.includes('未知，未核价')&&t.includes('请求工作目录');})()"))throw Error('acp-structured-diagnostics-missing');
      const detail=await js("[...document.querySelectorAll('.acp-history pre')].map(p=>p.textContent).join('\\n')");
      if(detail.includes('log-file-permission-denied')&&!await js("document.querySelector('.acp-history').textContent.includes('日志文件访问被拒绝')"))throw Error('acp-log-permission-reason-hidden');
      if(process.env.SACODE_ACP_METADATA_SMOKE==='1'){
        await js("(()=>{const summary=[...document.querySelectorAll('.acp-history summary')].find(e=>e.textContent==='查看上次诊断');if(summary&&!summary.parentElement.open)summary.click();})()");
        await wait("!!document.querySelector('.acp-history > section.tool-card > .acp-diagnostics > .acp-instance-metadata')?.getClientRects().length&&document.querySelector('.acp-history > section.tool-card > .acp-diagnostics > .acp-instance-metadata').textContent.includes('missing-fixture-model')");
        const metadata=await js("document.querySelector('.acp-history > section.tool-card > .acp-diagnostics > .acp-instance-metadata').textContent");
        if(!metadata.includes('sacode-fixture/fixture')||!metadata.includes('当前启用目录未列出，调用可能失败')||!metadata.includes('模型价格未知'))throw Error('acp-instance-risks-not-separated');
        await js("(()=>{const e=document.querySelector('textarea[aria-label=\"OpenCode 委派任务\"]');e.value='只检查按钮状态，不发送';e.dispatchEvent(new Event('input',{bubbles:true}));})()");
        await wait("!!document.querySelector('.acp-history button[type=\"submit\"]')&&!document.querySelector('.acp-history button[type=\"submit\"]').disabled");
        if(!await js("document.querySelector('.acp-history').textContent.includes('ACP 协议已连接')"))throw Error('acp-agent-warning-blocked-protocol');
        await js("document.querySelector('.acp-history > section.tool-card > .acp-diagnostics > .acp-instance-metadata').scrollIntoView({block:'start'})");
        win.showInactive();
        await new Promise(resolve=>setTimeout(resolve,300));
        const geometry=await js("(()=>{const e=document.querySelector('.acp-history > section.tool-card > .acp-diagnostics > .acp-instance-metadata'),r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:innerHeight,ancestors:[...function*(v){while(v){yield v;v=v.parentElement}}(e)].map(v=>({tag:v.tagName,cls:v.className,scroll:v.scrollTop,height:v.clientHeight,full:v.scrollHeight,overflow:getComputedStyle(v).overflowY}))};})()");
        writeFileSync(join(SESSION_DIR,'acp-instance-geometry.json'),JSON.stringify(geometry));
        if(geometry.top<0||geometry.top>=geometry.height)throw Error('acp-instance-metadata-not-in-viewport');
        writeFileSync(join(SESSION_DIR,'acp-instance-metadata.png'),(await win.webContents.capturePage()).toPNG());
      }
      await wait("[...document.querySelectorAll('.acp-history button')].some(b=>b.textContent.trim()==='暂不修复／保留现状'&&!b.disabled)");
      await click('暂不修复／保留现状');
      await wait("document.querySelector('.acp-history').textContent.includes('已保留现状')");
      const decision=await js("window.sacode.acpDiagnosticsDescribe('current')");
      if(decision.source!=='durable-history'||decision.record?.decision!=='kept'||decision.record?.report?.modelTaskTested!==false)throw Error('acp-diagnostic-decision-not-durable');
    }
    const after=readFileSync(SESSION_LOG,'utf8');
    if((after.match(/\tacp\/task\/start\t/g)||[]).length!==1)throw Error('acp-settings-started-task');
    await js("document.querySelector('.acp-history').scrollIntoView({block:'start'})");
    writeFileSync(join(SESSION_DIR,'acp-readiness.png'),(await win.webContents.capturePage()).toPNG());
    writeFileSync(join(SESSION_DIR,'acp-history-smoke.json'),JSON.stringify({passed:true,fixture:'recorded-protocol-facts',realHost:true,realIpc:true,realMainWindow:true,configurationRoundTrip:true,concurrentReadDuringProbe:true,automaticDiscovery:process.env.SACODE_ACP_DISCOVERY_SMOKE==='1',startsTask:false,paidModel:false}));
    await bridge.stop();console.log('ACP_HISTORY_MAIN_SMOKE PASS');app.exit(0);
  }catch(error){console.error('ACP_HISTORY_MAIN_SMOKE FAIL',error);await bridge.stop();app.exit(1);}
};
