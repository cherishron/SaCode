// execution/* 动作的有限 IPC 注册，逐字段校验在主进程。
// 渲染层拿不到「发任意 execution 方法」的能力。

const isStr = (v) => typeof v === "string";

function registerExecutionIpc(ipcMain, request) {
  const executionActions = {
    executionPropose: ['execution/propose', ['sessionId','taskId','requestId','proposal']],
    executionAuthorize: ['execution/authorize', ['sessionId','executionId','revision','proposalDigest','approvalId']],
    executionStart: ['execution/start', ['sessionId','executionId','revision']],
    executionDescribe: ['execution/describe', ['sessionId','executionId']],
    executionReviewFile: ['execution/review-file', ['sessionId','executionId','revision','path','side']],
    executionReviewPrepare: ['execution/review-prepare', ['sessionId','executionId','revision','requestId','paths']],
    executionReviewApply: ['execution/review-apply', ['sessionId','applyId','approvalId']],
    executionReviewApplyDescribe: ['execution/review-apply-describe', ['sessionId','applyId']],
    executionReviewApplyStop: ['execution/review-apply-stop', ['sessionId','applyId']],
    executionOutput: ['execution/output', ['sessionId','executionId','cursor','limit']],
    executionStop: ['execution/stop', ['sessionId','executionId','revision']],
  };
  for (const [action,[method,fields]] of Object.entries(executionActions)) {
    ipcMain.handle(`sacode:${action}`, async (_event, args) => {
      if (!args || Object.keys(args).length !== fields.length || fields.some(key => !Object.hasOwn(args,key))) throw Error('bad-execution-arguments');
      for (const key of fields) {
        const value=args[key];
        if (key === 'paths') {
          if (!Array.isArray(value) || !value.length || value.length > 128 || value.some(p=>typeof p!=='string'||!p.trim()||Buffer.byteLength(p,'utf8')>4096)) throw Error('bad-execution-arguments');
        } else if (['revision','approvalId','cursor','limit'].includes(key)) {
          if (!Number.isSafeInteger(value) || (key==='cursor' ? value < -1 : value < 1) || (key==='limit' && value > 16)) throw Error('bad-execution-arguments');
        } else if (!isStr(value) || !value.trim() || Buffer.byteLength(value,'utf8') > (key==='proposal' ? 1024 : key==='path' ? 4096 : 256)) throw Error('bad-execution-arguments');
      }
      if ('side' in args && !['before','after'].includes(args.side)) throw Error('bad-execution-arguments');
      if ('proposalDigest' in args && !/^[0-9a-f]{64}$/.test(args.proposalDigest)) throw Error('bad-execution-arguments');
      return request(method, args);
    });
  }
}

module.exports = { registerExecutionIpc, isStr };
