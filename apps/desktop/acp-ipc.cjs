'use strict';
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
}
module.exports = { registerAcpIpc };
