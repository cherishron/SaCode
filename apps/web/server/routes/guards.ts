import type { FastifyRequest, FastifyReply } from 'fastify';
import type { SessionStore, SessionRecord } from '../auth/session.js';
import type { WebConfig } from '../config.js';
import { checkOrigin, checkFetchMetadata } from '../security/origin.js';
import { csrfEqual } from '../auth/csrf.js';

/** 对外只回稳定错误码，不回显上游错误/路径/凭据/堆栈。 */
export const STABLE_ERRORS: Record<string, number> = {
  unauthorized: 401,
  'missing-origin': 403,
  'forbidden-origin': 403,
  'forbidden-fetch-site': 403,
  csrf_invalid: 403,
  rate_limited: 429,
  target_unavailable: 502,
  upstream_timeout: 504,
  not_found: 404,
  bad_request: 400,
  request_too_large: 413,
  cursor_expired: 410,
};

export function sendError(reply: FastifyReply, code: string, extra?: Record<string, unknown>): FastifyReply {
  const status = STABLE_ERRORS[code] ?? 400;
  return reply.code(status).send({ code, ...extra });
}

export function getSessionId(request: FastifyRequest): string | undefined {
  const c = request.cookies;
  if (!c) return undefined;
  return c['sacode_session'] || c['sacode_dev_session'];
}

/** 安全方法：浏览器对同源 GET/HEAD 不发 Origin，缺失时放行（见 security/origin.ts 说明）。 */
const SAFE_METHODS = new Set(['GET', 'HEAD']);

/** 所有 /api 请求（读与写）都校验 Origin + Fetch Metadata（§4.3 / §7.1）。 */
export function checkApiOrigin(request: FastifyRequest, config: WebConfig): string | null {
  const allowMissing = SAFE_METHODS.has(request.method.toUpperCase());
  const oc = checkOrigin(request.headers['origin'], config.origin, allowMissing);
  if (!oc.ok) return oc.reason ?? 'forbidden-origin';
  const fm = checkFetchMetadata(request.headers as Record<string, string | undefined>);
  if (!fm.ok) return fm.reason ?? 'forbidden-fetch-site';
  return null;
}

export function requireSession(request: FastifyRequest, sessions: SessionStore): SessionRecord | null {
  return sessions.get(getSessionId(request));
}

/** 写请求额外校验 CSRF（定长比较）。 */
export function checkCsrf(request: FastifyRequest, csrfToken: string | undefined): boolean {
  const provided = request.headers['x-csrf-token'];
  if (typeof provided !== 'string') return false;
  return csrfEqual(provided, csrfToken);
}
