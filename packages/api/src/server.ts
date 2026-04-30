import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { logger as honoLogger } from "hono/logger";

import routes from "./routes/index.js";
import { SACODEWebSocketServer } from "./websocket/index.js";
import { createDatabase, disconnectDatabase } from "@sacode/database";

type Variables = {
  userId: string;
};

const app = new Hono<{ Variables: Variables }>();

// 全局中间件
app.use("*", secureHeaders());
app.use("*", cors());
app.use("*", honoLogger());

// API 路由
app.route("/api", routes);

// WebSocket 服务器
let wsServer: SACODEWebSocketServer | null = null;

// 环境变量检查
function validateEnvironment(): void {
  const isProduction = process.env.NODE_ENV === "production";
  const errors: string[] = [];

  if (isProduction) {
    if (!process.env.JWT_SECRET) {
      errors.push("JWT_SECRET is required in production");
    }
    if (!process.env.SESSION_SECRET) {
      errors.push("SESSION_SECRET is required in production");
    }
    if (!process.env.ENCRYPTION_KEY) {
      errors.push("ENCRYPTION_KEY is required in production");
    }
    if (process.env.JWT_SECRET === "SACODE-dev-secret-change-in-production") {
      errors.push("JWT_SECRET must be changed from default value in production");
    }
    if (process.env.SESSION_SECRET === "SACODE-secret-change-in-production") {
      errors.push("SESSION_SECRET must be changed from default value in production");
    }
  } else {
    if (!process.env.JWT_SECRET) {
      console.warn("[!] WARNING: JWT_SECRET not set, using development default");
    }
    if (!process.env.SESSION_SECRET) {
      console.warn("[!] WARNING: SESSION_SECRET not set, using development default");
    }
    if (!process.env.ENCRYPTION_KEY) {
      console.warn("[!] WARNING: ENCRYPTION_KEY not set, using development default");
    }
  }

  if (errors.length > 0) {
    console.error("[ERR] Environment validation failed:");
    errors.forEach((err) => console.error(`   - ${err}`));
    process.exit(1);
  }
}

// 启动服务器
async function start() {
  validateEnvironment();

  const port = parseInt(process.env.PORT || "3000", 10);
  const host = process.env.HOST || "localhost";

  await createDatabase({
    type: (process.env.DATABASE_TYPE as "sqlite" | "mysql" | "postgres") || "sqlite",
    path: process.env.DATABASE_PATH || "./data/SACODE.db",
  });

  const server = Bun.serve({
    fetch: app.fetch,
    port,
    hostname: host,
  });

  wsServer = new SACODEWebSocketServer(server);

  console.log(`[SACODE] API Server running at http://${host}:${port}`);
  console.log(`[NET] WebSocket available at ws://${host}:${port}/ws`);
  console.log(`[DOC] API docs at http://${host}:${port}/api`);

  return server;
}

// 优雅关闭
async function shutdown() {
  console.log("\nShutting down...");

  if (wsServer) {
    wsServer.close();
  }

  await disconnectDatabase();

  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

start().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});

export { app };
