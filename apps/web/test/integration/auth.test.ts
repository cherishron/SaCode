import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../server/index.js';
import { buildTestConfig } from '../helpers/test-config.js';
import { cookieHeader, getCookieName, getCookieFlags } from '../helpers/http.js';
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

async function login(): Promise<{ cookie: string; csrf: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin: config.origin, 'content-type': 'application/json' },
    payload: JSON.stringify({ username: 'tester', password: 'test-password' }),
  });
  expect(res.statusCode).toBe(200);
  const csrf = (JSON.parse(res.payload) as { csrfToken: string }).csrfToken;
  return { cookie: cookieHeader(res.headers['set-cookie'] as string), csrf };
}

describe('auth security', () => {
  it('login without origin -> 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ username: 'tester', password: 'test-password' }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('login wrong password -> 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: config.origin, 'content-type': 'application/json' },
      payload: JSON.stringify({ username: 'tester', password: 'wrong' }),
    });
    expect(res.statusCode).toBe(401);
  });

  it('login success sets dev cookie + csrf', async () => {
    const { cookie, csrf } = await login();
    expect(cookie).toContain('sacode_dev_session=');
    expect(csrf.length).toBeGreaterThan(20);
  });

  it('cookie is HttpOnly + SameSite=Strict', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: config.origin, 'content-type': 'application/json' },
      payload: JSON.stringify({ username: 'tester', password: 'test-password' }),
    });
    const sc = res.headers['set-cookie'] as string;
    expect(getCookieName(sc)).toBe('sacode_dev_session');
    expect(getCookieFlags(sc)).toContain('httponly');
    expect(getCookieFlags(sc)).toContain('samesite=strict');
  });

  it('session query requires cookie', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { origin: config.origin },
    });
    expect(res.statusCode).toBe(401);
  });

  it('session query with cookie returns owner + csrf', async () => {
    const { cookie } = await login();
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { origin: config.origin, cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as { authenticated: boolean; owner: { username: string } };
    expect(body.authenticated).toBe(true);
    expect(body.owner.username).toBe('tester');
  });

  it('logout without csrf -> 403', async () => {
    const { cookie } = await login();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { origin: config.origin, cookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it('logout with csrf -> ok, then session 401', async () => {
    const { cookie, csrf } = await login();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { origin: config.origin, cookie, 'x-csrf-token': csrf },
    });
    expect(res.statusCode).toBe(200);
    const after = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { origin: config.origin, cookie },
    });
    expect(after.statusCode).toBe(401);
  });

  it('login rate limit after 5 failures -> 429', async () => {
    let last = 200;
    for (let i = 0; i < 6; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { origin: config.origin, 'content-type': 'application/json' },
        payload: JSON.stringify({ username: 'tester', password: 'bad' }),
      });
      last = res.statusCode;
    }
    expect(last).toBe(429);
  });
});
