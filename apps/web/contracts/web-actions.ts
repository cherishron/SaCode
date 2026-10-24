// Web 动作 → daemon 方法映射与开放阶段（不复制业务授权策略）。
// 有效开放面 = Web动作 ∩ 当前远程策略 ∩ daemon实现 ∩ 主体资源授权 ∩ 执行前置条件。
export interface WebActionSpec {
  action: string;
  daemonMethod: string;
  scope: 'read' | 'write';
  phase: 'W02-A' | 'W03' | 'blocked';
  notes: string;
}

export const WEB_ACTIONS: WebActionSpec[] = [
  {
    action: 'initialize',
    daemonMethod: 'initialize',
    scope: 'read',
    phase: 'W02-A',
    notes: '目标摘要；先解决工作区上下文',
  },
  {
    action: 'session/catalog',
    daemonMethod: 'session/catalog',
    scope: 'read',
    phase: 'W02-A',
    notes: '会话目录/历史只读首批',
  },
  {
    action: 'session/events',
    daemonMethod: 'session/events',
    scope: 'read',
    phase: 'W02-A',
    notes: '历史投影/分页；不调用 turn/poll',
  },
  {
    action: 'session/create',
    daemonMethod: 'session/create',
    scope: 'write',
    phase: 'W03',
    notes: '需 durable operationId 与资源绑定',
  },
  {
    action: 'task/start',
    daemonMethod: 'task/start',
    scope: 'write',
    phase: 'W03',
    notes: '受 P0-1 scope 授予、P0-2 turn/poll 排他、P0-3 约束',
  },
  {
    action: 'approval/answer',
    daemonMethod: 'approval/answer',
    scope: 'write',
    phase: 'W03',
    notes: '工单与主体/实例/工作区/session 绑定；团队审批不混用',
  },
  {
    action: 'turn/cancel',
    daemonMethod: 'turn/cancel',
    scope: 'write',
    phase: 'W03',
    notes: 'cancelRequested 非终态，须继续查结算',
  },
];

/** W01/W02-A 明确不开放的动作（首版默认拒绝；未知动作网络前 404）。 */
export const BLOCKED_ACTIONS: string[] = [
  'task/start',
  'approval/answer',
  'approval/ask',
  'session/create',
  'session/submit',
  'session/flush',
  'turn/cancel',
  'turn/poll',
  'model/list',
  'model/registry/catalog',
  'workspace/get',
  'workspace/files',
  'workspace/git-status',
  'workspace/git-diff',
  'auth/devices',
  'auth/revoke',
  'auth/enroll',
  'auth/token',
  'daemon/shutdown',
  'credential/*',
  'plugin/*',
  'host/*',
];

/** 当前 W01/W02-A 实际开放的只读方法（与 §8 白名单一致）。 */
export const OPEN_READ_METHODS = WEB_ACTIONS.filter((a) => a.phase === 'W02-A').map((a) => a.daemonMethod);
