import type { FastifyReply } from 'fastify';
import type { WebConfig } from '../config.js';

/**
 * 设置会话 cookie。
 * 生产：__Host- 前缀、Secure、HttpOnly、SameSite=Strict、Path=/、无 Domain。
 * 开发（非 production）：仅回环，不设 Secure，避免本地 http 无法写入。
 */
export function setSessionCookie(reply: FastifyReply, id: string, config: WebConfig): void {
  const maxAge = Math.floor(config.sessionAbsoluteMs / 1000);
  if (config.isDev) {
    reply.setCookie('sacode_dev_session', id, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      maxAge,
    });
  } else {
    reply.setCookie('__Host-sacode_session', id, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      secure: true,
      maxAge,
    });
  }
}

export function clearSessionCookie(reply: FastifyReply, config: WebConfig): void {
  if (config.isDev) {
    reply.clearCookie('sacode_dev_session', { path: '/' });
  } else {
    reply.clearCookie('__Host-sacode_session', { path: '/' });
  }
}
