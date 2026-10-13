'use strict';
const identity = value => typeof value === 'string' && !!value.trim() &&
  Buffer.byteLength(value, 'utf8') <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const taskText = value => typeof value === 'string' && !!value.trim() &&
  Buffer.byteLength(value, 'utf8') <= 65536 && !value.includes('\0');
function registerAcpIpc(ipcMain, request) {
  for (const [name, method, fields] of [
    ['acpDelegationList', 'acp/delegation/list', ['sessionId']],
    ['acpDelegationDescribe', 'acp/delegation/describe', ['sessionId', 'delegationId']],
  ]) {
    ipcMain.handle('sacode:' + name, async (_event, args) => {
      if (!args || Object.keys(args).length !== fields.length || fields.some(key =>
        !Object.hasOwn(args, key) || typeof args[key] !== 'string' || !args[key].trim() ||
        Buffer.byteLength(args[key], 'utf8') > 256 || /[\u0000-\u001f\u007f]/.test(args[key]))) throw Error('bad-acp-arguments');
      return request(method, args);
    });
  }
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
module.exports = { registerAcpIpc };
