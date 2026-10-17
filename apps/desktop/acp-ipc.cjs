'use strict';
const identity = value => typeof value === 'string' && !!value.trim() &&
  Buffer.byteLength(value, 'utf8') <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const taskText = value => typeof value === 'string' && !!value.trim() &&
  Buffer.byteLength(value, 'utf8') <= 65536 && !value.includes('\0');
const peerCount = args => args && Object.hasOwn(args,'peerId') ? 1 : 0;
function peerArguments(args) {
  if (Object.hasOwn(args,'peerId') && !['opencode','codebuddy'].includes(args.peerId)) throw Error('bad-acp-arguments');
  return args.peerId==='codebuddy' ? {peerId:'codebuddy'} : {};
}
function registerAcpIpc(ipcMain, request) {
  for (const [name, method, fields] of [
    ['acpDelegationList', 'acp/delegation/list', ['sessionId']],
    ['acpDelegationDescribe', 'acp/delegation/describe', ['sessionId', 'delegationId']],
    ['acpSettingsDescribe', 'acp/settings/describe', ['sessionId']],
    ['acpProviderProbe', 'acp/provider/probe', ['sessionId']],
    ['acpDiagnosticsDescribe', 'acp/diagnostics/describe', ['sessionId']],
  ]) {
    ipcMain.handle('sacode:' + name, async (_event, args) => {
      const scoped = method==='acp/settings/describe'||method==='acp/provider/probe'||method==='acp/diagnostics/describe';
      if (!args || Array.isArray(args) || Object.keys(args).length !== fields.length + (scoped?peerCount(args):0) || fields.some(key =>
        !Object.hasOwn(args, key) || typeof args[key] !== 'string' || !args[key].trim() ||
        Buffer.byteLength(args[key], 'utf8') > 256 || /[\u0000-\u001f\u007f]/.test(args[key]))) throw Error('bad-acp-arguments');
      if(!scoped)return request(method,args);
      return request(method,{sessionId:args.sessionId,...peerArguments(args)});
    });
  }
  ipcMain.handle('sacode:acpSettingsSetEnabled', async (_event,args)=>{
    if(!args||Array.isArray(args)||Object.keys(args).length!==3+peerCount(args)||!Object.hasOwn(args,'sessionId')||!identity(args.sessionId)||!Object.hasOwn(args,'enabled')||
      typeof args.enabled!=='boolean'||!Object.hasOwn(args,'revision')||!Number.isSafeInteger(args.revision)||args.revision<0)
      throw Error('bad-acp-arguments');
    return request('acp/settings/set-enabled',{sessionId:args.sessionId,enabled:args.enabled,revision:args.revision,...peerArguments(args)});
  });
  ipcMain.handle('sacode:acpDiagnosticsKeep', async (_event,args)=>{
    if(!args||Array.isArray(args)||Object.keys(args).length!==3+peerCount(args)||!['sessionId','diagnosticId','revision'].every(key=>Object.hasOwn(args,key))||!identity(args.sessionId)||
      typeof args.diagnosticId!=='string'||!/^acp-[0-9a-f]{32}$/.test(args.diagnosticId)||!positive(args.revision))throw Error('bad-acp-arguments');
    return request('acp/diagnostics/keep',{sessionId:args.sessionId,diagnosticId:args.diagnosticId,revision:args.revision,...peerArguments(args)});
  });
  for (const [name, method, schema] of [
    ['acpDelegationCreate', 'create', {sessionId:identity, taskId:identity, requestId:identity, peerId:identity, taskText}],
    ['acpDelegationPoll', 'poll', {sessionId:identity, delegationId:identity}],
    ['acpDelegationAnswer', 'answer', {sessionId:identity, delegationId:identity, approvalId:positive,
      decision:value=>value==='allowed-once'||value==='denied',
      optionId:value=>value===''||identity(value)}],
    ['acpDelegationCancel', 'cancel', {sessionId:identity, delegationId:identity, revision:positive}],
    ['acpDelegationClose', 'close', {sessionId:identity, delegationId:identity, revision:positive}],
  ]) {
    ipcMain.handle('sacode:' + name, async (_event, args) => {
      const fields=Object.keys(schema);
      if (!args || typeof args!=='object' || Array.isArray(args) || Object.keys(args).length!==fields.length ||
          fields.some(key=>!Object.hasOwn(args,key)||!schema[key](args[key]))) throw Error('bad-acp-arguments');
      if (method==='answer' && args.decision==='allowed-once' && !identity(args.optionId)) throw Error('bad-acp-arguments');
      return request('acp/delegation/'+method, Object.fromEntries(fields.map(key=>[key,args[key]])));
    });
  }
}
// 请求窗口覆盖核心有界的握手、建会话与进程收束；页面不能指定窗口。
function acpRequestTimeout(method) {
  if (method === 'acp/provider/probe') return 30000;
  if (method === 'acp/delegation/create') return 60000;
  if (method === 'acp/delegation/close') return 15000;
  return 5000;
}
module.exports = { registerAcpIpc, acpRequestTimeout };
