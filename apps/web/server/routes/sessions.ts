import type { FastifyInstance } from 'fastify';
import type { WebConfig } from '../config.js';
import type { SessionStore } from '../auth/session.js';
import type { TargetGateway } from '../daemon/gateway.js';
import { sendError, checkApiOrigin, requireSession } from './guards.js';
import { toSessionSummary, toSessionDetail } from '../daemon/mapper.js';

export async function registerSessions(
  app: FastifyInstance,
  config: WebConfig,
  sessions: SessionStore,
  gateway: TargetGateway,
): Promise<void> {
  // 会话目录：初始化（取 workspace 绑定上下文）+ catalog，返回白名单字段。
  app.get('/api/targets/:targetId/sessions', async (req, reply) => {
    const oe = checkApiOrigin(req, config);
    if (oe) return sendError(reply, oe);
    if (!requireSession(req, sessions)) return sendError(reply, 'unauthorized');
    const { targetId } = req.params as { targetId: string };
    if (!gateway.has(targetId)) return sendError(reply, 'not_found');
    try {
      const init = await gateway.initialize(targetId);
      const list = await gateway.catalogSessions(targetId);
      return {
        targetId,
        workspaceId: init.workspaceId ?? null,
        sessions: list.map((raw) => toSessionSummary(raw)),
      };
    } catch {
      return sendError(reply, 'target_unavailable');
    }
  });

  // 会话详情：白名单字段（含 workspaceId）。未知会话 → 404。
  app.get('/api/targets/:targetId/sessions/:sessionId', async (req, reply) => {
    const oe = checkApiOrigin(req, config);
    if (oe) return sendError(reply, oe);
    if (!requireSession(req, sessions)) return sendError(reply, 'unauthorized');
    const { targetId, sessionId } = req.params as { targetId: string; sessionId: string };
    if (!gateway.has(targetId)) return sendError(reply, 'not_found');
    try {
      const detail = await gateway.getSessionDetail(targetId, sessionId);
      return { targetId, session: toSessionDetail(detail) };
    } catch {
      return sendError(reply, 'not_found');
    }
  });
}
