// 会话日志投影 → 统一历史项。排序只认 event seq / 标准 ID，不按正文猜关联。
export function eventOrder(id, fallback = Number.MAX_SAFE_INTEGER) {
  const match = String(id).match(/^(?:tool-)?event-(\d+)$/);
  return match ? Number(match[1]) : fallback;
}

export function transcriptItems(messages, tools) {
  return [
    ...messages.map((message, index) => ({ ...message, type: "message", order: eventOrder(message.key, Number.MAX_SAFE_INTEGER - messages.length + index) })),
    ...tools.map((call) => ({ key: call.id, type: "tool", call, order: Number.isSafeInteger(call.eventSeq) ? call.eventSeq : eventOrder(call.id) })),
  ].sort((a, b) => a.order - b.order);
}

export function splitTranscript(items, busy) {
  // 活动轮从最后一条 user 开始保持可变，已完成工具不会过早打印进 Static。
  let boundary = items.findLastIndex((item) => item.type === "message" && item.role === "user");
  if (!busy && boundary >= 0) boundary++;
  if (boundary < 0) boundary = 0;
  const pending = items.findIndex((item) => item.type === "tool" && item.call.status === "running");
  if (pending >= 0) boundary = Math.min(boundary, pending);
  return { stable: items.slice(0, boundary), active: items.slice(boundary) };
}
