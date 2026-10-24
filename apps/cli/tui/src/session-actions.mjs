// compact/clear 的 Host 契约适配；不在 TUI 伪造业务状态。
import { requireCapability } from './capability-views.mjs';

export async function compactDescribe(client, capabilities, sessionId) {
  requireCapability(capabilities, 'compact/describe');
  const reply = await client.request('compact/describe', { sessionId }, 15000);
  if (reply?.sessionId !== sessionId || typeof reply.state !== 'string') throw new Error('压缩状态响应身份或格式无效');
  return reply;
}

export function compactDetailLines(reply) {
  const lines = [
    `会话：${reply.sessionId}`,
    `策略：${reply.strategy || 'local-extractive-v1'}（有损：${reply.lossy ? '是' : '否'}）`,
    `状态：${reply.state}${reply.reason ? ` · ${reply.reason}` : ''}`,
    `事件总数：${reply.eventCount ?? '未知'}`,
    `已持久事件：${reply.durableCount ?? '未知'}`,
    `已压缩修订：${reply.indexRevision ?? 0}`,
    `工作区绑定：${reply.workspaceBound ? '是' : '否'}`,
  ];
  if (reply.beforeInputBound != null) {
    lines.push(`压缩前输入字节：${reply.beforeInputBound}`);
    if (reply.afterInputBound != null) {
      lines.push(`压缩后输入字节：${reply.afterInputBound}`);
      lines.push(`节省：${reply.savedInputBound ?? (reply.beforeInputBound - reply.afterInputBound)} 字节`);
    }
  }
  return lines;
}

export async function compactRun(client, capabilities, sessionId) {
  requireCapability(capabilities, 'compact/run');
  const requestId = `tui-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const reply = await client.request('compact/run', { sessionId, requestId }, 30000);
  if (reply?.sessionId !== sessionId || typeof reply.status !== 'string') throw new Error('压缩回执身份或状态无效');
  return reply;
}

export async function sessionClear(client, sessionId) {
  const reply = await client.request('session/clear', { sessionId }, 15000);
  if (reply?.cleared !== true || reply.sessionId !== sessionId || !Number.isSafeInteger(reply.revision)) throw new Error('清空回执未确认');
  return reply;
}
