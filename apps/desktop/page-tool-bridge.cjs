'use strict';

// 页面只能消费核心队列中的执行请求；调用方不能绕过审批直接取得 handler。
function createPageToolBridge({bridge, getWindow, askPermission, intervalMs = 100}) {
  let disposed = false, polling = false, attachedProc = null, sessionId = '', invocations = 0;
  const current = (proc, target) => !disposed && bridge.proc === proc && !bridge.failure && proc?.exitCode == null && proc?.signalCode == null && getWindow() === target;
  async function attach(force = false) {
    const proc = bridge.proc;
    if (disposed || !proc || !getWindow()) throw Error('page-tools-unavailable');
    if (!force && attachedProc === proc && sessionId) return sessionId;
    const reply = await bridge.request('page/tool/attach', {});
    if (disposed || bridge.proc !== proc || typeof reply?.sessionId !== 'string' || !reply.sessionId) throw Error('page-attachment-stale');
    attachedProc = proc; sessionId = reply.sessionId; return sessionId;
  }
  async function pump() {
    if (disposed || polling || !bridge.proc || !getWindow()) return;
    polling = true;
    try {
      const sid = await attach(), proc = attachedProc, target = getWindow();
      const view = await bridge.request('page/tool/poll', {sessionId: sid});
      if (!current(proc, target) || view?.sessionId !== sid || !Array.isArray(view.requests)) return;
      for (const request of view.requests) {
        if (!request || request.sessionId !== sid || typeof request.requestId !== 'string' || !request.requestId ||
            !['page.readState','page.clickElement','page.inputText','page.scroll'].includes(request.name) || typeof request.arguments !== 'string') continue;
        const args = JSON.parse(request.arguments);
        if (!args || typeof args !== 'object' || Array.isArray(args)) continue;
        const granted = await bridge.request('page/tool/claim', {sessionId: sid, requestId: request.requestId});
        if (granted?.allowed !== true || !current(proc, target)) continue;
        let result;
        try {
          result = await target.webContents.executeJavaScript(
            `(async()=>{const root=document.querySelector('.app[data-page-session]');if(!root||root.getAttribute('data-page-session')!==${JSON.stringify(sid)})return JSON.stringify({error:'page-session-not-rendered'});const tools=window.DshPageTools&&window.DshPageTools.tools;if(!Array.isArray(tools))return JSON.stringify({error:'page-tools-not-loaded'});const tool=tools.find(t=>t&&t.name===${JSON.stringify(request.name)});if(!tool||typeof tool.handler!=='function')return JSON.stringify({error:'tool-not-found'});try{return JSON.stringify(await tool.handler(${JSON.stringify(args)}));}catch(e){return JSON.stringify({error:String(e&&e.message||e)});}})()`
          );
          const parsed = JSON.parse(result);
          if (typeof result !== 'string' || Buffer.byteLength(result,'utf8') > 65536 || !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('bad-page-result');
        } catch { result = JSON.stringify({error:'page-handler-failed'}); }
        if (current(proc, target)) {
          await bridge.request('page/tool/result', {sessionId: sid, requestId: request.requestId, result});
        }
      }
    } catch { attachedProc = null; sessionId = ''; }
    finally { polling = false; }
  }
  const timer = setInterval(()=>void pump(), intervalMs); timer.unref?.();
  async function invokeOwned(name, args = {}) {
    const sid = await attach(true), proc = attachedProc, target = getWindow();
    const argumentsJson = JSON.stringify(args);
    const proposal = await bridge.request('page/tool/prepare', {sessionId:sid, name, arguments:argumentsJson});
    if (proposal?.sessionId !== sid || !Number.isSafeInteger(proposal.approvalId) || proposal.approvalId < 0) throw Error('bad-page-proposal');
    if (proposal.approvalId > 0) {
      const allowed = await askPermission({name, argumentsJson, sessionId:sid, approvalId:proposal.approvalId});
      if (!current(proc, target)) throw Error('page-proposal-stale');
      const answer = await bridge.request('approval/answer', {approvalId:proposal.approvalId, decision:allowed?'allowed-once':'denied'});
      if (!allowed || answer?.accepted !== true) return {error:'page-approval-denied'};
    }
    if (!current(proc, target)) throw Error('page-proposal-stale');
    return bridge.request('page/tool/call', {sessionId:sid, name, arguments:argumentsJson, approvalId:proposal.approvalId}, 40000);
  }
  async function invoke(name, args) {
    invocations += 1; timer.ref?.();
    try { return await invokeOwned(name, args); }
    finally { invocations -= 1; if (!invocations) timer.unref?.(); }
  }
  function dispose() { disposed = true; clearInterval(timer); }
  return {attach, invoke, pump, dispose};
}
module.exports = {createPageToolBridge};
