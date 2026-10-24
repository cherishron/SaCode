// E2E 服务引导：同进程启动 BFF（18787）+ Vite 开发服务器（5173，同源代理 /api）。
// 仅用于 W02-A 真实浏览器冒烟；不读取磁盘配置，账号/口令硬编码为测试值。
// 由 playwright.config.ts 的 webServer 拉起，进程退出即关闭。
import { fileURLToPath } from 'node:url';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'vite';
import { buildApp } from '../../server/index.js';
import { hashPassword } from '../../server/auth/password.js';
import { TargetGateway } from '../../server/daemon/gateway.js';
import { SimulatedDaemonTransport } from '../../server/daemon/transport.js';
import type { WebConfig } from '../../server/config.js';

const ORIGIN = process.env['E2E_ORIGIN'] || 'http://127.0.0.1:5173';
const BFF_PORT = 18787;
const VITE_PORT = 5173;
/** e2e 专用事件驱动端口（仅回环，用于按需推送合成事件，验证实时 fan-out） */
const DRIVER_PORT = 18788;

async function main(): Promise<void> {
  const passwordHash = await hashPassword('test-password');
  const config: WebConfig = {
    bind: '127.0.0.1',
    port: BFF_PORT,
    origin: ORIGIN,
    targets: [{ id: 'sim-1', label: 'Simulated', baseUrl: 'http://127.0.0.1:9999', credentialRef: 'ref-1' }],
    accounts: [{ id: 'owner-1', username: 'tester', passwordHash }],
    sessionIdleMs: 30 * 60 * 1000,
    sessionAbsoluteMs: 8 * 60 * 60 * 1000,
    isDev: true,
  };

  // 注入合成 transport 并收集引用，供驱动端点按需推送（默认不自动推送，保持确定性）
  const emitters: SimulatedDaemonTransport[] = [];
  const gateway = new TargetGateway(config, undefined, (targetId) => {
    const t = new SimulatedDaemonTransport(targetId);
    emitters.push(t);
    return t;
  });

  const { app } = await buildApp({ config, gateway });
  await app.listen({ host: '127.0.0.1', port: BFF_PORT });

  let seq = 0;
  const driver = createHttpServer((req, res) => {
    if (req.method === 'POST' && (req.url ?? '').startsWith('/emit')) {
      const query = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams;
      const generation = Number(query.get('generation') ?? '1');
      seq += 1;
      const id = `live-${seq}`;
      const summary = `实时事件 ${seq}`;
      for (const t of emitters) {
        t.emit({
          id,
          kind: 'message',
          at: new Date().toISOString(),
          summary,
          sessionId: 'sess-1',
          generation,
        });
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id, summary }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => driver.listen(DRIVER_PORT, '127.0.0.1', r));

  const vite = await createServer({
    root: fileURLToPath(new URL('../../', import.meta.url)),
    configFile: fileURLToPath(new URL('../../vite.config.ts', import.meta.url)),
    server: { host: '127.0.0.1', port: VITE_PORT, strictPort: true },
  });
  await vite.listen();

  const shutdown = () => {
    driver.close();
    void vite.close().catch(() => {});
    void app.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  console.log('E2E_SERVERS_READY');
}

main().catch((e) => {
  console.error('E2E_SERVE_FAIL', e);
  process.exit(1);
});
