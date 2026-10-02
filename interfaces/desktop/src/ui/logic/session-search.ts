/**
 * 会话搜索 — 契约 §3.2：对 title + preview 做子串匹配（首版不做向量）。
 * 纯函数，便于单测。
 */

export interface SessionSearchItem {
  id: string;
  title: string;
  /** 末条消息摘要；daemon 未提供时为空，仅匹配 title。 */
  preview?: string;
}

/** 大小写不敏感子串匹配；query 空白时原样返回全部。 */
export function filterSessionsByQuery<T extends SessionSearchItem>(
  sessions: readonly T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...sessions];
  return sessions.filter((session) => {
    const title = (session.title || '').toLowerCase();
    const preview = (session.preview || '').toLowerCase();
    return title.includes(q) || preview.includes(q);
  });
}
