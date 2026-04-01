import express from "express";
import cors from "cors";
import helmet from "helmet";
import session from "express-session";
import { createServer } from "http";
import { config } from "dotenv";

import routes from "./routes/index.js";
import { SaClawWebSocketServer } from "./websocket/index.js";
import { createDatabase, disconnectDatabase } from "@saclaw/database";

// 加载环境变量
config();

const app = express();
const server = createServer(app);

// 中间件
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session
app.use(
  session({
    secret: process.env.SESSION_SECRET || "saclaw-secret-change-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  })
);

// API 路由
app.use("/api", routes);

// WebSocket 服务器
let wsServer: SaClawWebSocketServer | null = null;

// 环境变量检查
function validateEnvironment(): void {
  const isProduction = process.env.NODE_ENV === "production";
  const errors: string[] = [];

  if (isProduction) {
    // 生产环境必须设置的环境变量
    if (!process.env.JWT_SECRET) {
      errors.push("JWT_SECRET is required in production");
    }
    if (!process.env.SESSION_SECRET) {
      errors.push("SESSION_SECRET is required in production");
    }
    if (!process.env.ENCRYPTION_KEY) {
      errors.push("ENCRYPTION_KEY is required in production");
    }
    if (process.env.JWT_SECRET === "saclaw-dev-secret-change-in-production") {
      errors.push("JWT_SECRET must be changed from default value in production");
    }
    if (process.env.SESSION_SECRET === "saclaw-secret-change-in-production") {
      errors.push("SESSION_SECRET must be changed from default value in production");
    }
  } else {
    // 开发环境警告
    if (!process.env.JWT_SECRET) {
      console.warn("⚠️  WARNING: JWT_SECRET not set, using development default");
    }
    if (!process.env.SESSION_SECRET) {
      console.warn("⚠️  WARNING: SESSION_SECRET not set, using development default");
    }
    if (!process.env.ENCRYPTION_KEY) {
      console.warn("⚠️  WARNING: ENCRYPTION_KEY not set, using development default");
    }
  }

  if (errors.length > 0) {
    console.error("❌ Environment validation failed:");
    errors.forEach((err) => console.error(`   - ${err}`));
    process.exit(1);
  }
}

// 启动服务器
async function start() {
  // 验证环境变量
  validateEnvironment();

  const port = parseInt(process.env.PORT || "3000", 10);
  const host = process.env.HOST || "localhost";

  // 连接数据库
  await createDatabase({
    type: (process.env.DATABASE_TYPE as "sqlite" | "mysql" | "postgres") || "sqlite",
    path: process.env.DATABASE_PATH || "./data/saclaw.db",
  });

  // 启动 WebSocket
  wsServer = new SaClawWebSocketServer(server);

  server.listen(port, host, () => {
    console.log(`🦞 SaClaw API Server running at http://${host}:${port}`);
    console.log(`📡 WebSocket available at ws://${host}:${port}/ws`);
    console.log(`📚 API docs at http://${host}:${port}/api`);
  });
}

// 优雅关闭
async function shutdown() {
  console.log("\nShutting down...");

  if (wsServer) {
    wsServer.close();
  }

  await disconnectDatabase();

  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// 启动
start().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});

export { app, server };
