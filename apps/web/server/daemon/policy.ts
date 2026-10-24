// Web 动作 → daemon 方法白名单（W01/W02-A 仅只读三项）。
// 不提供 { method, params } 透传；未知动作在路由层 404，不进入 daemon。
export const READONLY_METHODS = ['initialize', 'session/catalog', 'session/events'] as const;
export type ReadonlyMethod = (typeof READONLY_METHODS)[number];

export function isAllowedReadAction(method: string): boolean {
  return (READONLY_METHODS as readonly string[]).includes(method);
}

/**
 * 资源绑定比较辅助函数；真实适配器另验证服务端配置的 workspaceId / instanceId。
 * P0-3 已按收窄范围修复；此比较本身不证明设备隔离或真实任务授权。
 * 若 BFF 已知绑定 workspace，则要求请求会话归属该 workspace；否则标记为未隔离。
 */
export interface BindingResult {
  isolated: boolean;
  reason?: string;
}

export function assertResourceBinding(
  sessionWorkspaceId: string | null,
  boundWorkspaceId: string | null,
): BindingResult {
  if (!boundWorkspaceId) {
    return { isolated: false, reason: 'no-bound-workspace' };
  }
  if (sessionWorkspaceId !== boundWorkspaceId) {
    return { isolated: false, reason: 'workspace-mismatch' };
  }
  return { isolated: true };
}
