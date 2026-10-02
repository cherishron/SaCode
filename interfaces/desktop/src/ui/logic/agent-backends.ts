/**
 * Agent 后端设置页纯逻辑 — health 徽标 / 额度文案 / args 编辑。
 * 纯函数，无 DOM / 无 client 依赖，便于单测。
 */
import type { AgentBackendDescriptor, AgentBackendQuota } from '@cherishron/sacode-client-core';

/** native sacode 后端 id（与 kernel `DEFAULT_AGENT_BACKEND_ID` 一致）。 */
export const NATIVE_BACKEND_ID = 'sacode';

export type HealthTone = 'success' | 'warning' | 'danger' | 'muted';

export interface HealthBadge {
  label: string;
  tone: HealthTone;
}

/** health → 徽标文案 + 色调（ready 绿 / degraded 黄 / unavailable 红 / unknown 灰）。 */
export function healthBadge(health: AgentBackendDescriptor['health']): HealthBadge {
  switch (health) {
    case 'ready':
      return { label: '就绪', tone: 'success' };
    case 'degraded':
      return { label: '降级', tone: 'warning' };
    case 'unavailable':
      return { label: '不可用', tone: 'danger' };
    case 'unknown':
    default:
      return { label: '未知', tone: 'muted' };
  }
}

/** O5 额度一行小字；无 quota 返回 null（不渲染）。 */
export function formatQuotaLine(quota: AgentBackendQuota | null | undefined): string | null {
  if (!quota) return null;
  const used = quota.used;
  const limit = quota.limit;
  const hasLimit = typeof limit === 'number' && limit > 0;
  const count = hasLimit ? `${used}/${limit}` : `${used} 次`;
  return quota.exhausted ? `今日 ${count} · 已用尽` : `今日 ${count}`;
}

/** 额度已用尽 → warning 样式。 */
export function isQuotaExhausted(quota: AgentBackendQuota | null | undefined): boolean {
  return quota?.exhausted === true;
}

/** 未安装 / 不可用：置灰 + 显示安装指引，不刷红错。 */
export function isBackendUnavailable(backend: Pick<AgentBackendDescriptor, 'health'>): boolean {
  return backend.health === 'unavailable';
}

/** native sacode 不可改（daemon 侧 PUT 会 400）；其余可编辑。 */
export function isBackendEditable(backend: Pick<AgentBackendDescriptor, 'id'>): boolean {
  return backend.id !== NATIVE_BACKEND_ID;
}

/** args 数组 → 编辑框文本：按空白拆行展示，每行一个参数。 */
export function argsToText(args: readonly string[] | null | undefined): string {
  return (args ?? []).filter((a) => a.trim().length > 0).join('\n');
}

/** 编辑框文本 → args 数组：按空白（空格/换行）拆分，忽略空段。 */
export function textToArgs(text: string): string[] {
  return text.split(/\s+/).map((s) => s.trim()).filter(Boolean);
}

/** 后端路径展示行：无路径给占位。 */
export function backendPathText(backend: Pick<AgentBackendDescriptor, 'executable'>): string {
  return backend.executable?.trim() || '未设置路径';
}

/** 安装指引（仅 unavailable 时展示）；无 hint 给默认一行，不刷红。 */
export function installHintFor(backend: Pick<AgentBackendDescriptor, 'install_hint'>): string {
  return backend.install_hint?.trim() || '安装对应 CLI 并确保在 PATH 中，然后点击「探测」重试';
}
