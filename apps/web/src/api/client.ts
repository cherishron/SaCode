// 前端 API 客户端。
// 安全约定：CSRF token 仅存内存（不写 localStorage/sessionStorage/IndexedDB）；
// 所有请求 same-origin（cookie 自动携带）；错误映射为稳定 code。
import type {
  ApiError,
  EventsPage,
  SessionDetail,
  SessionInfo,
  SessionSummary,
  TargetInfo,
} from '@shared/types';

export class ApiClientError extends Error {
  constructor(
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'ApiClientError';
  }
}

let csrfToken: string | null = null;
export function getCsrfToken(): string | null {
  return csrfToken;
}
function setCsrfToken(v: string | undefined): void {
  csrfToken = v ?? null;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  }
  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401) {
    setCsrfToken(undefined);
    throw new ApiClientError('unauthorized');
  }
  if (!res.ok) {
    let code = 'error';
    try {
      const j = (await res.json()) as ApiError;
      code = j.code;
    } catch {
      /* ignore */
    }
    throw new ApiClientError(code);
  }
  const data = (await res.json()) as T;
  return data;
}

export const api = {
  async login(username: string, password: string): Promise<SessionInfo> {
    const info = await request<SessionInfo>('POST', '/api/auth/login', { username, password });
    setCsrfToken(info.csrfToken);
    return info;
  },
  async logout(): Promise<void> {
    await request('POST', '/api/auth/logout');
    setCsrfToken(undefined);
  },
  async session(): Promise<SessionInfo> {
    const info = await request<SessionInfo>('GET', '/api/auth/session');
    setCsrfToken(info.csrfToken);
    return info;
  },
  async targets(): Promise<{ targets: TargetInfo[] }> {
    return request('GET', '/api/targets');
  },
  async sessions(
    targetId: string,
  ): Promise<{ targetId: string; workspaceId: string | null; sessions: SessionSummary[] }> {
    return request('GET', `/api/targets/${encodeURIComponent(targetId)}/sessions`);
  },
  async sessionDetail(
    targetId: string,
    sessionId: string,
  ): Promise<{ targetId: string; session: SessionDetail }> {
    return request(
      'GET',
      `/api/targets/${encodeURIComponent(targetId)}/sessions/${encodeURIComponent(sessionId)}`,
    );
  },
  async events(targetId: string, sessionId: string, cursor?: string | null): Promise<EventsPage> {
    const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return request(
      'GET',
      `/api/targets/${encodeURIComponent(targetId)}/sessions/${encodeURIComponent(sessionId)}/events${q}`,
    );
  },
  streamUrl(targetId: string, sessionId: string): string {
    return `/api/targets/${encodeURIComponent(targetId)}/sessions/${encodeURIComponent(sessionId)}/stream`;
  },
};
