// 测试 HTTP 辅助：从 inject 的 set-cookie 头解析 cookie 名/值/标志。
export function cookieHeader(setCookie: string): string {
  const head = setCookie.split(';')[0] ?? '';
  return head;
}

export function getCookieName(setCookie: string): string {
  return (setCookie.split(';')[0] ?? '').split('=')[0] ?? '';
}

export function getCookieFlags(setCookie: string): string {
  return setCookie.split(';').slice(1).join(';').toLowerCase();
}
