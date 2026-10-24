import type { FastifyInstance } from 'fastify';
import type { WebConfig } from '../config.js';
import type { SessionStore } from '../auth/session.js';
import type { TargetGateway } from '../daemon/gateway.js';
import { sendError, checkApiOrigin, requireSession } from './guards.js';

export async function registerTargets(
  app: FastifyInstance,
  config: WebConfig,
  sessions: SessionStore,
  gateway: TargetGateway,
): Promise<void> {
  // 目标列表：仅返回 id/label，绝不返回 baseUrl/credentialRef。
  app.get('/api/targets', async (req, reply) => {
    const oe = checkApiOrigin(req, config);
    if (oe) return sendError(reply, oe);
    if (!requireSession(req, sessions)) return sendError(reply, 'unauthorized');
    return { targets: gateway.listTargets() };
  });
}
