// 受保护真实 daemon + 生产 Web 适配器联调；只使用隔离合成身份，不读用户配置。
import { get, type ClientRequest, type IncomingMessage } from 'node:http';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { buildApp } from '../../server/index.js';
import { hashPassword } from '../../server/auth/password.js';
import { TargetGateway } from '../../server/daemon/gateway.js';
import {
  RemoteTransportAdapter,
  realTransportOptions,
  type RealTransportHandle,
} from '../../server/daemon/real-transport.js';
import type { WebConfig } from '../../server/config.js';
import { createRealReadonlyFixture } from './real-daemon-readonly-fixture.mjs';

function check(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label);
}
async function main(): Promise<void> {
  const fixture = await createRealReadonlyFixture();
  const rpcMethods: string[] = [];
  const checks: Record<string, boolean | number> = {};
  let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
  let stream: ClientRequest | undefined;
  let response: IncomingMessage | undefined;
  const oldLog = process.env['SACODE_WEB_LOG_LEVEL'];
  process.env['SACODE_WEB_LOG_LEVEL'] = 'silent';
  const password = randomBytes(24).toString('base64url');
  try {
    const init = await fixture.rpc('initialize', { workspaceId: fixture.workspaceId });
    check(typeof init.body.result?.instanceId === 'string', 'fixture-instance-missing');
    const cfg: WebConfig = {
      bind: '127.0.0.1',
      port: 0,
      origin: 'http://127.0.0.1:18787',
      isDev: true,
      sessionIdleMs: 300000,
      sessionAbsoluteMs: 600000,
      accounts: [
        { id: 'readonly-owner', username: 'readonly-fixture', passwordHash: await hashPassword(password) },
      ],
      targets: [
        {
          id: 'real-fixture',
          label: '真实隔离候选',
          baseUrl: fixture.endpoint,
          credentialRef: 'FIXTURE_MEMORY_TOKEN',
          workspaceId: fixture.workspaceId,
          instanceId: init.body.result.instanceId,
        },
      ],
    };
    const modulePath = resolve(import.meta.dirname, '../../../desktop/remote-transport.mjs');
    const mod = (await import(pathToFileURL(modulePath).href)) as {
      RemoteTransport: new (options: unknown) => RealTransportHandle;
    };
    const gateway = new TargetGateway(cfg, async (target) => {
      const handle = new mod.RemoteTransport(
        realTransportOptions(target, { FIXTURE_MEMORY_TOKEN: fixture.token }),
      );
      const request = handle.sendRequest.bind(handle);
      handle.sendRequest = (method, params) => {
        rpcMethods.push(method);
        return request(method, params);
      };
      return new RemoteTransportAdapter(target, handle);
    });
    ({ app } = await buildApp({ config: cfg, gateway }));
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const login = await fetch(`${address}/api/auth/login`, {
      method: 'POST',
      headers: { origin: cfg.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'readonly-fixture', password }),
    });
    check(login.status === 200, 'web-login-failed');
    checks.login = true;
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!;
    check(cookie, 'web-cookie-missing');
    const headers = { origin: cfg.origin, cookie };
    async function read(path: string) {
      const result = await fetch(address + path, { headers, signal: AbortSignal.timeout(10000) });
      check(result.status === 200, `web-read-failed:${path.split('?')[0]}`);
      return result.json();
    }
    const targets = await read('/api/targets');
    check(
      targets.targets.some((t: { id: string }) => t.id === 'real-fixture'),
      'web-target-missing',
    );
    check(!JSON.stringify(targets).includes('credentialRef'), 'web-target-secret-field');
    checks.targets = true;
    const root = '/api/targets/real-fixture/sessions';
    const catalog = await read(root);
    check(
      catalog.workspaceId === fixture.workspaceId &&
        catalog.sessions.some((s: { id: string }) => s.id === fixture.sessionId),
      'web-catalog-mismatch',
    );
    checks.catalog = true;
    const selected = `${root}/${encodeURIComponent(fixture.sessionId)}`;
    const detail = await read(selected);
    check(detail.session.id === fixture.sessionId, 'web-detail-mismatch');
    checks.detail = true;
    const history = await read(`${selected}/events`);
    check(
      history.frames.some((f: { summary: string }) => f.summary === 'synthetic-readonly-message-1'),
      'web-persistent-history-missing',
    );
    check(
      history.frames.every((f: { id: string }) => f.id.startsWith('real:')),
      'web-history-not-real',
    );
    checks.history = true;
    checks.eventCount = history.frames.length;
    const next = await read(`${selected}/events?cursor=${encodeURIComponent(history.nextCursor)}`);
    check(
      next.frames.every((f: { id: string }) => !history.frames.some((p: { id: string }) => p.id === f.id)),
      'web-page-duplicated',
    );
    checks.cursorNoDuplicates = true;
    const anonymous = await fetch(address + selected + '/stream', { headers: { origin: cfg.origin } });
    check(anonymous.status === 401, 'web-anonymous-stream-not-rejected');
    checks.anonymousStreamRejected = true;
    await new Promise<void>((done, fail) => {
      const timer = setTimeout(() => {
        stream?.destroy();
        fail(new Error('web-stream-open-timeout'));
      }, 10000);
      stream = get(address + selected + '/stream', { headers }, (res) => {
        response = res;
        if (res.statusCode !== 200) {
          clearTimeout(timer);
          res.resume();
          fail(new Error('web-stream-status-failed'));
          return;
        }
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (part: string) => {
          text += part;
          if (text.includes(': open')) {
            clearTimeout(timer);
            done();
          }
        });
        res.on('error', () => {
          clearTimeout(timer);
          fail(new Error('web-stream-read-failed'));
        });
      });
      stream.on('error', () => {
        clearTimeout(timer);
        fail(new Error('web-stream-request-failed'));
      });
    });
    checks.upstreamAndBrowserStreamOpened = true;
    fixture.revoke();
    const revoked = await fetch(address + selected + '/events', { headers });
    check(revoked.status === 502, 'web-revoked-upstream-not-rejected');
    checks.revokedReadRejected = true;
    check(
      rpcMethods.every((method) => ['initialize', 'session/catalog', 'session/events'].includes(method)),
      'web-extra-rpc-called',
    );
    checks.onlyThreeReadonlyRpcMethods = true;
    fixture.report.web = {
      passed: true,
      checks,
      rpcMethods: [...new Set(rpcMethods)],
      liveBusinessEventsVerified: false,
      browserRenderingVerified: false,
      transportEofRecoveryVerified: false,
      adapter: 'production RemoteTransportAdapter + desktop RemoteTransport, injected in-memory credentials',
    };
  } catch (error) {
    fixture.report.web = {
      passed: false,
      checks,
      failure: error instanceof Error ? error.message : 'unknown',
    };
    throw error;
  } finally {
    response?.destroy();
    stream?.destroy();
    try {
      await app?.close();
      checks.webServerClosed = true;
    } finally {
      fixture.persist();
      await fixture.close();
      if (oldLog === undefined) delete process.env['SACODE_WEB_LOG_LEVEL'];
      else process.env['SACODE_WEB_LOG_LEVEL'] = oldLog;
      console.log(
        JSON.stringify({
          reportPath: fixture.reportPath,
          passed: fixture.report.web?.passed === true,
          checks,
        }),
      );
    }
  }
}
main().catch(() => {
  console.error('真实Web只读联调未通过，请查看脱敏摘要');
  process.exitCode = 1;
});
