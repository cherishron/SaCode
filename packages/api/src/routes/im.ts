import { Hono } from "hono";
import { getPrismaClient } from "@sacode/database";
import { IMAdapterManager, type Platform } from "@sacode/adapters";
import { EventEmitter } from "events";
import { authMiddleware } from "../middleware/auth";

type Variables = {
  userId: string;
};

const router = new Hono<{ Variables: Variables }>();

const adapterManager = new IMAdapterManager();
const connectionMap = new Map<string, Platform>();

export const connectionEvents = new EventEmitter();

interface ConnectionLog {
  id: string;
  connectionId: string;
  type: "connect" | "disconnect" | "test" | "error" | "message";
  message: string;
  timestamp: Date;
  details?: Record<string, unknown>;
}

const connectionLogs: ConnectionLog[] = [];
const MAX_LOGS = 1000;

function addLog(log: Omit<ConnectionLog, "id" | "timestamp">) {
  const fullLog: ConnectionLog = {
    ...log,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    timestamp: new Date(),
  };
  connectionLogs.unshift(fullLog);
  if (connectionLogs.length > MAX_LOGS) {
    connectionLogs.pop();
  }
  connectionEvents.emit("log", fullLog);
}

// GET /api/im
router.get("/", authMiddleware, async (c) => {
  try {
    const prisma = getPrismaClient();
    const connections = await prisma.iMConnection.findMany({
      orderBy: { updatedAt: "desc" },
    });
    return c.json(connections);
  } catch (error) {
    console.error("Get IM connections error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /api/im
router.post("/", authMiddleware, async (c) => {
  try {
    const { platform, name, config } = await c.req.json();

    if (!platform) {
      return c.json({ error: "Platform is required" }, 400);
    }

    const prisma = getPrismaClient();
    const connection = await prisma.iMConnection.create({
      data: {
        platform,
        name,
        status: "disconnected",
        config: JSON.stringify(config || {}),
      },
    });

    return c.json(connection, 201);
  } catch (error) {
    console.error("Create IM connection error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// PATCH /api/im/:id
router.patch("/:id", authMiddleware, async (c) => {
  try {
    const { id } = c.req.param();
    const { status, config } = await c.req.json();

    const prisma = getPrismaClient();
    const connection = await prisma.iMConnection.update({
      where: { id },
      data: {
        status,
        config: config ? JSON.stringify(config) : undefined,
      },
    });

    return c.json(connection);
  } catch (error) {
    console.error("Update IM connection error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// DELETE /api/im/:id
router.delete("/:id", authMiddleware, async (c) => {
  try {
    const { id } = c.req.param();
    const prisma = getPrismaClient();

    const connection = await prisma.iMConnection.findUnique({ where: { id } });
    if (connection && connection.status === "connected") {
      const platform = connectionMap.get(id);
      if (platform) {
        await adapterManager.disconnect(platform);
        connectionMap.delete(id);
      }
    }

    await prisma.iMConnection.delete({ where: { id } });
    return c.json({ success: true });
  } catch (error) {
    console.error("Delete IM connection error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /api/im/:id/test
router.post("/:id/test", authMiddleware, async (c) => {
  try {
    const { id } = c.req.param();
    const prisma = getPrismaClient();

    const connection = await prisma.iMConnection.findUnique({ where: { id } });
    if (!connection) {
      return c.json({ error: "Connection not found" }, 404);
    }

    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(connection.config || "{}");
    } catch {
      config = {};
    }

    const platform = connection.platform as Platform;
    const startTime = Date.now();

    try {
      const testResult = await adapterManager.testConnection(platform, config);
      const latency = Date.now() - startTime;

      addLog({
        connectionId: id,
        type: "test",
        message: `连接测试成功 - ${platform}`,
        details: { latency, platform },
      });

      return c.json({
        success: true,
        latency,
        platform,
        message: "连接测试成功",
        details: testResult,
      });
    } catch (testError) {
      const latency = Date.now() - startTime;
      const errorMessage = testError instanceof Error ? testError.message : "Test failed";

      addLog({
        connectionId: id,
        type: "error",
        message: `连接测试失败 - ${errorMessage}`,
        details: { latency, platform, error: errorMessage },
      });

      return c.json({
        success: false,
        latency,
        platform,
        error: errorMessage,
      }, 400);
    }
  } catch (error) {
    console.error("Test IM connection error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

export default router;
