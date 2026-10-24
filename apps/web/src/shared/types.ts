// 前后端共享的纯类型（不引入任何 Node 或浏览器运行时 API）
// 用于约束 BFF 对外响应结构，避免把上游 daemon 原始对象透传。

export interface ApiError {
  /** 稳定错误码，不含任何敏感信息 */
  code: string;
  /** 可选人类可读信息，绝不回显上游错误/路径/凭据 */
  message?: string;
}

export interface OwnerInfo {
  id: string;
  username: string;
}

export interface SessionInfo {
  authenticated: true;
  owner: OwnerInfo;
  /** 仅返回到前端内存，前端不得写入 localStorage/sessionStorage/IndexedDB */
  csrfToken: string;
}

export interface TargetInfo {
  id: string;
  label: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionDetail extends SessionSummary {
  workspaceId: string;
}

export interface EventFrameView {
  id: string;
  kind: string;
  at: string;
  summary: string;
}

export interface EventsPage {
  frames: EventFrameView[];
  nextCursor: string | null;
  generation: number;
}
