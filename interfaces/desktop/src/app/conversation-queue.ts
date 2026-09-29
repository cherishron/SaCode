import type { ExecutionModeInput } from '@cherishron/sacode-client-core';

export interface QueuedMessage {
  id: string;
  prompt: string;
  mode: ExecutionModeInput;
  backendId: string;
  modelProvider?: string;
  modelName?: string;
  skill?: string;
  contextPaths: string[];
  error?: string;
  sending?: boolean;
}

/** A send interrupted by app shutdown may have reached the daemon. Require an explicit retry. */
export function restoreQueuedMessages(raw: string | null): Map<string, QueuedMessage[]> {
  const restored = new Map<string, QueuedMessage[]>();
  if (!raw) return restored;
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return restored;
    for (const row of data) {
      if (!Array.isArray(row) || typeof row[0] !== 'string' || !Array.isArray(row[1])) continue;
      const items: QueuedMessage[] = [];
      for (const value of row[1]) {
        if (!value || typeof value !== 'object') continue;
        const item = value as Partial<QueuedMessage>;
        if (typeof item.id !== 'string' || typeof item.prompt !== 'string'
          || typeof item.backendId !== 'string' || !['auto', 'build', 'plan', 'yolo'].includes(item.mode ?? '')
          || !Array.isArray(item.contextPaths) || !item.contextPaths.every((path) => typeof path === 'string')) continue;
        items.push({ ...item, id: item.id, prompt: item.prompt, backendId: item.backendId,
          mode: item.mode!, contextPaths: item.contextPaths,
          sending: false,
          error: item.sending ? '上次发送状态不确定，请确认会话中是否已提交后再重试' : item.error,
        });
      }
      if (items.length) restored.set(row[0], items);
    }
  } catch { /* Corrupt local storage should not prevent opening the desktop. */ }
  return restored;
}

export function moveQueuedMessage(queue: QueuedMessage[], id: string, direction: -1 | 1): QueuedMessage[] {
  const from = queue.findIndex((item) => item.id === id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= queue.length) return queue;
  const next = [...queue];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}
