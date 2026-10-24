import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { loadConfig, type WebConfig } from './config.js';
import { SessionStore } from './auth/session.js';
import { SlidingWindowLimiter } from './security/limits.js';
import { TargetGateway } from './daemon/gateway.js';
import { createRealTransport } from './daemon/real-transport.js';
import { registerHealth } from './routes/health.js';
import { registerAuth } from './routes/auth.js';
import { registerTargets } from './routes/targets.js';
import { registerSessions } from './routes/sessions.js';
import { registerEvents } from './routes/events.js';
import type { SseOptions } from './events/connection.js';

export interface BuildOptions {
  config?: WebConfig;
  gateway?: TargetGateway;
  sse?: SseOptions;
}

/**
 * 定位构建后的前端静态目录。
 * 源码运行时本文件在 <root>/server/，构建产物在 <root>/dist/server/server/，
 * 相对路径 '../dist/client' 在两种布局下解析结果不同；故逐级向上找 dist/client，
 * 兼容源码直跑与构建产物两种布局（缺失则返回 null，静态与 SPA 回退都不注册）。
 */
function resolveClientDir(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, 'dist', 'client');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export async function buildApp(
  opts: BuildOptions = {},
): Promise<{ app: FastifyInstance; sessions: SessionStore; gateway: TargetGateway }> {
  const config = opts.config ?? loadConfig();
  const app = Fastify({
    logger: { level: process.env['SACODE_WEB_LOG_LEVEL'] || 'info' },
    bodyLimit: 256 * 1024, // 全局请求体上限 256 KiB（§4.4）
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });
  await app.register(cookie);
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  const sessions = new SessionStore(config.sessionIdleMs, config.sessionAbsoluteMs);
  const loginLimiter = new SlidingWindowLimiter(5, 15 * 60 * 1000);
  const gateway =
    opts.gateway ??
    new TargetGateway(
      config,
      process.env['SACODE_WEB_DAEMON_REAL'] === '1' ? createRealTransport : undefined,
    );

  await registerHealth(app);
  await registerAuth(app, config, sessions, loginLimiter);
  await registerTargets(app, config, sessions, gateway);
  await registerSessions(app, config, sessions, gateway);
  await registerEvents(app, config, sessions, gateway, opts.sse);

  const clientDir = resolveClientDir();
  if (clientDir) {
    await app.register(fastifyStatic, { root: clientDir, wildcard: false });
  }
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api')) return reply.code(404).send({ code: 'not_found' });
    if (clientDir) return reply.sendFile('index.html');
    return reply.code(404).send({ code: 'not_found' });
  });

  const sweep = setInterval(() => {
    sessions.sweep();
  }, 60_000);
  app.addHook('onClose', async () => {
    clearInterval(sweep);
    await gateway.stopAll();
  });

  return { app, sessions, gateway };
}

export async function startServer(): Promise<void> {
  const config = loadConfig();
  const { app } = await buildApp({ config });
  await app.listen({ host: config.bind, port: config.port });
  const shutdown = async () => {
    try {
      await app.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// 仅当本文件被直接作为进程入口运行时自启动；被 import（如测试中的 buildApp）时不启动。
const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  void startServer();
}
