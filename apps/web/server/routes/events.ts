import type { FastifyInstance } from 'fastify';
import type { WebConfig } from '../config.js';
import type { SessionStore } from '../auth/session.js';
import type { TargetGateway } from '../daemon/gateway.js';
import { sendError, checkApiOrigin, requireSession } from './guards.js';
import { toEventFrame } from '../daemon/mapper.js';
import { SseConnection, type SseOptions } from '../events/connection.js';

const PAGE_LIMIT = 500;

export async function registerEvents(
  app: FastifyInstance,
  config: WebConfig,
  sessions: SessionStore,
  gateway: TargetGateway,
  options: SseOptions = {},
): Promise<void> {
  const connections = new Set<SseConnection>();
  let stopping = false;
  app.addHook('preClose', async () => {
    stopping = true;
    for (const connection of connections) connection.close(true);
  });

  // 事件补读（GET）：基于不透明游标；游标过期/跨会话返回 nextCursor=null。
  app.get('/api/targets/:targetId/sessions/:sessionId/events', async (req, reply) => {
    const oe = checkApiOrigin(req, config);
    if (oe) return sendError(reply, oe);
    if (!requireSession(req, sessions)) return sendError(reply, 'unauthorized');
    const { targetId, sessionId } = req.params as { targetId: string; sessionId: string };
    if (!gateway.has(targetId)) return sendError(reply, 'not_found');
    const cursor = (req.query as { cursor?: string }).cursor;
    try {
      const broker = await gateway.getBroker(targetId);
      const { frames, nextCursor } = await broker.refill(sessionId, cursor, PAGE_LIMIT);
      return {
        frames: frames.map(toEventFrame),
        nextCursor,
        generation: broker.getGeneration(sessionId),
      };
    } catch {
      return sendError(reply, 'target_unavailable');
    }
  });

  // 背压恢复后提示补读；持续不可写的客户端 30s 后强制断开，不追加无界队列。
  app.get('/api/targets/:targetId/sessions/:sessionId/stream', async (req, reply) => {
    const oe = checkApiOrigin(req, config);
    if (oe) return sendError(reply, oe);
    const login = requireSession(req, sessions);
    if (!login) return sendError(reply, 'unauthorized');
    const { targetId, sessionId } = req.params as { targetId: string; sessionId: string };
    if (!gateway.has(targetId)) return sendError(reply, 'not_found');

    let broker;
    try {
      broker = await gateway.getBroker(targetId);
    } catch {
      return sendError(reply, 'target_unavailable');
    }
    if (!sessions.get(login.id)) return sendError(reply, 'unauthorized');
    const raw = reply.raw;
    if (stopping) return sendError(reply, 'target_unavailable');
    if (raw.destroyed || req.raw.aborted) return;

    let subId: string | undefined;
    let unbind = () => {};
    const connection = new SseConnection(
      raw,
      () => sessions.get(login.id) !== null,
      () => {
        if (subId) broker.removeSubscriber(subId);
        unbind();
        connections.delete(connection);
      },
      options,
    );
    connections.add(connection);
    reply.hijack();
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    });
    unbind = sessions.onRevoke(login.id, () => connection.expire());
    if (connection.isClosed) return;
    connection.write(': open\n\n', false);
    if (connection.isClosed) return;

    subId = broker.addSubscriber({
      onFrame: (frame) => {
        if (frame.sessionId === sessionId)
          connection.write(`data: ${JSON.stringify(toEventFrame(frame))}\n\n`);
      },
      onRefillPrompt: () => connection.promptRefill('generation-changed'),
    });
    for (const frame of broker.snapshotRing(sessionId)) {
      connection.write(`data: ${JSON.stringify(toEventFrame(frame))}\n\n`);
      if (connection.isClosed) break;
    }
  });
}
