// 上游结果 → 浏览器可见字段的严格白名单。
// 绝不 ...spread 上游对象；只显式挑选下列字段，新增上游字段不会自动出现在浏览器。
import type { EventFrameView, SessionDetail, SessionSummary } from '../../src/shared/types.js';
import type { RawEventFrame } from './transport.js';

export function toSessionSummary(raw: Record<string, unknown>): SessionSummary {
  return {
    id: String(raw['id'] ?? ''),
    title: String(raw['title'] ?? ''),
    status: String(raw['status'] ?? 'unknown'),
    createdAt: String(raw['createdAt'] ?? ''),
    updatedAt: String(raw['updatedAt'] ?? ''),
  };
}

export function toSessionDetail(raw: Record<string, unknown>): SessionDetail {
  return {
    id: String(raw['id'] ?? ''),
    title: String(raw['title'] ?? ''),
    status: String(raw['status'] ?? 'unknown'),
    createdAt: String(raw['createdAt'] ?? ''),
    updatedAt: String(raw['updatedAt'] ?? ''),
    workspaceId: String(raw['workspaceId'] ?? ''),
  };
}

export function toEventFrame(raw: RawEventFrame): EventFrameView {
  return {
    id: String(raw.id),
    kind: String(raw.kind),
    at: String(raw.at),
    summary: String(raw.summary),
  };
}
