import type { FastifyInstance } from 'fastify';
import { Type, type Static } from '@sinclair/typebox';
import type { WebConfig } from '../config.js';
import type { SessionStore } from '../auth/session.js';
import { verifyPassword, getDummyHash } from '../auth/password.js';
import type { SlidingWindowLimiter } from '../security/limits.js';
import { sendError, checkApiOrigin, requireSession, checkCsrf, getSessionId } from './guards.js';
import { setSessionCookie, clearSessionCookie } from './cookies.js';

const LoginSchema = Type.Object(
  {
    username: Type.String({ maxLength: 128 }),
    password: Type.String({ maxLength: 256 }),
  },
  { additionalProperties: false },
);

type LoginBody = Static<typeof LoginSchema>;

export async function registerAuth(
  app: FastifyInstance,
  config: WebConfig,
  sessions: SessionStore,
  loginLimiter: SlidingWindowLimiter,
): Promise<void> {
  // 登录：校验 Origin/Fetch-Metadata；5/15min 滑动窗口；用户不存在也走等价验证避免枚举。
  app.post('/api/auth/login', { schema: { body: LoginSchema } }, async (req, reply) => {
    const oe = checkApiOrigin(req, config);
    if (oe) return sendError(reply, oe);
    const body = req.body as LoginBody;
    const key = `${body.username}:${req.ip}`;
    if (!loginLimiter.allow(key)) return sendError(reply, 'rate_limited');

    const account = config.accounts.find((a) => a.username === body.username);
    const ok = account
      ? await verifyPassword(account.passwordHash, body.password)
      : await verifyPassword(await getDummyHash(), body.password);
    if (!account || !ok) return sendError(reply, 'unauthorized');

    loginLimiter.reset(key);
    // 登录轮换：销毁旧会话，换新 id 与 csrf
    const rec = sessions.rotate(getSessionId(req), account.id, account.username);
    setSessionCookie(reply, rec.id, config);
    return {
      authenticated: true,
      owner: { id: rec.ownerId, username: rec.username },
      csrfToken: rec.csrfToken,
    };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const oe = checkApiOrigin(req, config);
    if (oe) return sendError(reply, oe);
    const rec = requireSession(req, sessions);
    if (!rec) return sendError(reply, 'unauthorized');
    if (!checkCsrf(req, rec.csrfToken)) return sendError(reply, 'csrf_invalid');
    sessions.destroy(rec.id);
    clearSessionCookie(reply, config);
    return { ok: true };
  });

  // 会话查询（GET 只读，无 CSRF；用于前端加载/刷新恢复登录态）。
  app.get('/api/auth/session', async (req, reply) => {
    const oe = checkApiOrigin(req, config);
    if (oe) return sendError(reply, oe);
    const rec = requireSession(req, sessions);
    if (!rec) return sendError(reply, 'unauthorized');
    sessions.touch(rec.id);
    return {
      authenticated: true,
      owner: { id: rec.ownerId, username: rec.username },
      csrfToken: rec.csrfToken,
    };
  });
}
