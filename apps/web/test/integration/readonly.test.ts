import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../server/index.js';
import { buildTestConfig } from '../helpers/test-config.js';
import { cookieHeader } from '../helpers/http.js';
import type { WebConfig } from '../../server/config.js';

let app: FastifyInstance;
let config: WebConfig;

beforeEach(async () => {
  config = await buildTestConfig();
  const r = await buildApp({ config });
  app = r.app;
});
afterEach(async () => {
  await app.close();
});

async function login(): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin: config.origin, 'content-type': 'application/json' },
    payload: JSON.stringify({ username: 'tester', password: 'test-password' }),
  });
  return cookieHeader(res.headers['set-cookie'] as string);
}

describe('read-only surface', () => {
  it('GET targets requires auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/targets', headers: { origin: config.origin } });
    expect(res.statusCode).toBe(401);
  });

  it('GET targets lists only id/label (no credential)', async () => {
    const cookie = await login();
    const res = await app.inject({
      method: 'GET',
      url: '/api/targets',
      headers: { origin: config.origin, cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as { targets: Array<Record<string, unknown>> };
    expect(body.targets[0]).toEqual({ id: 'sim-1', label: 'Simulated' });
    expect(res.payload).not.toContain('credentialRef');
    expect(res.payload).not.toContain('http://localhost:9999');
  });

  it('GET sessions rejects wrong origin', async () => {
    const cookie = await login();
    const res = await app.inject({
      method: 'GET',
      url: '/api/targets/sim-1/sessions',
      headers: { origin: 'https://evil.example', cookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it('GET sessions returns whitelisted fields', async () => {
    const cookie = await login();
    const res = await app.inject({
      method: 'GET',
      url: '/api/targets/sim-1/sessions',
      headers: { origin: config.origin, cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as { workspaceId: string; sessions: unknown[] };
    expect(body.workspaceId).toBe('ws-sim-1');
    expect(body.sessions.length).toBe(6);
    expect(res.payload).not.toContain('credential');
  });

  it('GET session detail', async () => {
    const cookie = await login();
    const res = await app.inject({
      method: 'GET',
      url: '/api/targets/sim-1/sessions/sess-1',
      headers: { origin: config.origin, cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as { session: { workspaceId: string } };
    expect(body.session.workspaceId).toBe('ws-sim-1');
  });

  it('GET events returns frames + cursor', async () => {
    const cookie = await login();
    const res = await app.inject({
      method: 'GET',
      url: '/api/targets/sim-1/sessions/sess-1/events',
      headers: { origin: config.origin, cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as { frames: unknown[]; nextCursor: string };
    expect(body.frames.length).toBe(10);
    // 游标为不透明 base64url（含 target/session/lastEventId/generation），前端原样回传
    expect(body.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(body.nextCursor.length).toBeGreaterThan(0);
  });

  it('unknown target -> 404', async () => {
    const cookie = await login();
    const res = await app.inject({
      method: 'GET',
      url: '/api/targets/nope/sessions',
      headers: { origin: config.origin, cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('unknown action -> 404', async () => {
    const cookie = await login();
    const res = await app.inject({
      method: 'GET',
      url: '/api/unknown',
      headers: { origin: config.origin, cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('SSE stream without auth -> 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/targets/sim-1/sessions/sess-1/stream',
      headers: { origin: config.origin },
    });
    expect(res.statusCode).toBe(401);
  });

  it('SSE stream wrong target -> 404', async () => {
    const cookie = await login();
    const res = await app.inject({
      method: 'GET',
      url: '/api/targets/nope/sessions/sess-1/stream',
      headers: { origin: config.origin, cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});
