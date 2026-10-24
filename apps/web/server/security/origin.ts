export interface OriginCheck {
  ok: boolean;
  reason?: string;
}

/**
 * 校验 Origin 精确匹配配置的 SACODE_WEB_ORIGIN。
 *
 * 关键事实：**浏览器对同源 GET/HEAD 请求默认不发送 Origin 头**（只有 POST 及跨域请求才发）。
 * 因此安全方法（GET/HEAD）在 Origin 缺失时必须放行，否则同源只读接口会被全部 403。
 * 此时跨站读取由另外两道机制防御：
 *   1. 会话 cookie 为 SameSite=Strict，跨站发起的请求不会携带；
 *   2. Fetch Metadata（sec-fetch-site）拒绝 cross-site 来源。
 * 非安全方法（POST 等）仍严格要求 Origin 存在且精确匹配。
 */
export function checkOrigin(actual: string | undefined, expected: string, allowMissing = false): OriginCheck {
  if (!actual) {
    return allowMissing ? { ok: true } : { ok: false, reason: 'missing-origin' };
  }
  if (actual !== expected) return { ok: false, reason: 'forbidden-origin' };
  return { ok: true };
}

/**
 * Fetch Metadata：只允许 same-origin / none（顶层导航/用户发起）。
 * 非浏览器客户端缺省允许（其 Origin 已由 checkOrigin 校验）。
 */
export function checkFetchMetadata(headers: Record<string, string | undefined>): OriginCheck {
  const site = headers['sec-fetch-site'];
  if (site === undefined) return { ok: true };
  if (site === 'same-origin' || site === 'none') return { ok: true };
  return { ok: false, reason: 'forbidden-fetch-site' };
}
