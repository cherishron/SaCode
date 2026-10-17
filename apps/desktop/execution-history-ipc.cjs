// 历史列表只是当前会话的持久投影；不接收任意方法、路径或启动参数。
function registerExecutionHistoryIpc(ipcMain, request) {
  ipcMain.handle('sacode:executionList', async (_event, args) => {
    if (!args || Object.keys(args).length !== 3 || !['sessionId','cursor','limit'].every(key => Object.hasOwn(args,key)) ||
      typeof args.sessionId !== 'string' || !args.sessionId.trim() || Buffer.byteLength(args.sessionId,'utf8') > 256 ||
      !Number.isSafeInteger(args.cursor) || args.cursor < -1 || !Number.isSafeInteger(args.limit) || args.limit < 1 || args.limit > 16) throw Error('bad-execution-arguments');
    return request('execution/list', {sessionId:args.sessionId,cursor:args.cursor,limit:args.limit});
  });
}
module.exports = {registerExecutionHistoryIpc};
