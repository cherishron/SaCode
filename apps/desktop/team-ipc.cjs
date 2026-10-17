const sessionId = value => typeof value === 'string' && (value === 'current' || /^sessions\/session-[A-Za-z0-9_-]+$/.test(value));
const text = (value, max = 4096) => typeof value === 'string' && value.trim().length > 0 && Buffer.byteLength(value, 'utf8') <= max && !value.includes('\0');
const actions = [
  ['teamDescribe', 'team/describe', {}],
  ['teamMemberCreate', 'team/member/create', {name: value => text(value, 128), role: value => text(value, 512)}],
  ['teamMessageSend', 'team/message/send', {target: value => text(value, 128), text}],
  ['teamMessageBroadcast', 'team/message/broadcast', {text}],
  ['teamTaskCreate', 'team/task/create', {title: value => text(value, 1024), dependencies: value => Array.isArray(value) && value.length <= 64 && value.every(item => text(item, 128))}],
  ['teamTaskAssign', 'team/task/assign', {taskId: value => text(value, 128), memberId: value => text(value, 128)}],
  ['teamTaskClaim', 'team/task/claim', {taskId: value => text(value, 128)}],
  ['teamTaskComplete', 'team/task/complete', {taskId: value => text(value, 128), result: text}],
  ['teamMemberStop', 'team/member/stop', {memberId: value => text(value, 128)}],
  ['teamApprovalAnswer', 'team/approval/answer', {memberId: value => text(value, 128), approvalId: value => Number.isSafeInteger(value) && value > 0, decision: value => ['allowed-once', 'denied'].includes(value)}],
];
function registerTeamIpc(ipcMain, request) {
  for (const [action, method, fields] of actions) {
    ipcMain.handle(`sacode:${action}`, async (_event, args) => {
      if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length !== Object.keys(fields).length + 1 || !sessionId(args.teamSessionId) || Object.entries(fields).some(([key, validate]) => !Object.hasOwn(args, key) || !validate(args[key]))) {
        throw new Error('bad-team-arguments');
      }
      return request(method, args);
    });
  }
}
module.exports = {registerTeamIpc};
