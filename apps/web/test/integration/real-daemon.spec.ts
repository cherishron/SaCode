import { get, type ClientRequest, type IncomingMessage } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../server/index.js';
import { loadConfig } from '../../server/config.js';
import { cookieHeader } from '../helpers/http.js';

// 显式门控；启用却缺配置必须失败，不能把占位断言当成真实链路证据。
const ENABLED = process.env['SACODE_WEB_DAEMON_REAL'] === '1';
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`real-test-config-required:${name}`);
  return value;
}

function openStream(
  url: string,
  headers: Record<string, string>,
): Promise<{
  request: ClientRequest;
  response: IncomingMessage;
  opened: Promise<void>;
}> {
  return new Promise((resolve, reject) => {
    const request = get(url, { headers }, (response) => {
      let text = '';
      const opened = new Promise<void>((done, fail) => {
        const timer = setTimeout(() => fail(new Error('real-sse-open-timeout')), 5000);
        const stop = () => clearTimeout(timer);
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          text += chunk;
          if (text.includes(': open')) {
            stop();
            done();
          }
        });
        response.once('error', (error) => {
          stop();
          fail(error);
        });
        response.once('end', () => {
          stop();
          fail(new Error('real-sse-ended-before-open'));
        });
        response.once('close', stop);
      });
      // 握手失败时依然消费opened的拒绝，防止测试清理产生未处理异常。
      void opened.catch(() => {});
      resolve({ request, response, opened });
    });
    request.once('error', reject);
  });
}

describe.skipIf(!ENABLED)('真实daemon受保护只读链路', () => {
  it('login → targets → sessions → detail → events → SSE', async () => {
    const username = required('SACODE_WEB_REAL_TEST_USERNAME');
    const password = required('SACODE_WEB_REAL_TEST_PASSWORD');
    const sessionId = required('SACODE_WEB_REAL_TEST_SESSION_ID');
    required('SACODE_WEB_REAL_TRANSPORT_PATH');
    const loaded = loadConfig();
    const targetId = process.env['SACODE_WEB_REAL_TEST_TARGET_ID'] ?? loaded.targets[0]?.id;
    const target = loaded.targets.find((item) => item.id === targetId);
    expect(target, '需配置真实只读目标').toBeDefined();
    expect(target?.workspaceId, '需配置服务端工作区绑定').toBeTruthy();
    expect(target?.instanceId, '需配置服务端实例绑定').toBeTruthy();
    // 仅测试BFF使用临时HTTP监听和开发cookie；daemon认证/TLS/绑定不降级。
    const config = { ...loaded, bind: '127.0.0.1', port: 0, isDev: true };
    let app: FastifyInstance | undefined;
    let stream: Awaited<ReturnType<typeof openStream>> | undefined;
    try {
      const built = await buildApp({ config });
      app = built.app;
      const address = await app.listen({ host: '127.0.0.1', port: 0 });
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { origin: config.origin, 'content-type': 'application/json' },
        payload: { username, password },
      });
      expect(login.statusCode).toBe(200);
      const cookie = cookieHeader(String(login.headers['set-cookie']));
      expect(cookie).not.toBe('');
      const headers = { origin: config.origin, cookie };
      const targets = await app.inject({ method: 'GET', url: '/api/targets', headers });
      expect(targets.statusCode).toBe(200);
      expect(targets.json().targets).toContainEqual({ id: target!.id, label: target!.label });
      expect(targets.payload).not.toContain('credentialRef');
      const root = `/api/targets/${encodeURIComponent(target!.id)}/sessions`;
      const sessions = await app.inject({ method: 'GET', url: root, headers });
      expect(sessions.statusCode).toBe(200);
      expect(sessions.json().workspaceId).toBe(target!.workspaceId);
      expect(sessions.json().sessions.some((item: { id: string }) => item.id === sessionId)).toBe(true);
      const selected = `${root}/${encodeURIComponent(sessionId)}`;
      const detail = await app.inject({ method: 'GET', url: selected, headers });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().session).toMatchObject({ id: sessionId, workspaceId: target!.workspaceId });
      const events = await app.inject({ method: 'GET', url: `${selected}/events`, headers });
      expect(events.statusCode).toBe(200);
      const first = events.json() as {
        frames: { id: string; kind: string; summary: string }[];
        nextCursor: string;
      };
      // 夹具需预置至少一条持久事件；不得以空目录/空历史冒充链路完成。
      expect(first.frames.length).toBeGreaterThan(0);
      expect(first.frames[0]?.id).toMatch(/^real:/);
      expect(first.frames[0]?.kind).toBeTruthy();
      expect(first.nextCursor).toBeTruthy();
      const next = await app.inject({
        method: 'GET',
        url: `${selected}/events?cursor=${encodeURIComponent(first.nextCursor)}`,
        headers,
      });
      expect(next.statusCode).toBe(200);
      const seen = new Set(first.frames.map((frame) => frame.id));
      expect(next.json().frames.every((frame: { id: string }) => !seen.has(frame.id))).toBe(true);
      const anonymous = await app.inject({
        method: 'GET',
        url: `${selected}/stream`,
        headers: { origin: config.origin },
      });
      expect(anonymous.statusCode).toBe(401);
      stream = await openStream(`${address}${selected}/stream`, headers);
      expect(stream.response.statusCode).toBe(200);
      expect(stream.response.headers['content-type']).toContain('text/event-stream');
      // : open 仅在真实上游订阅建立后发送；本测试不执行写操作来制造直播事件。
      await stream.opened;
    } finally {
      stream?.response.destroy();
      stream?.request.destroy();
      await app?.close();
    }
  }, 60000);
});
