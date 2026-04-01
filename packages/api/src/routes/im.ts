import { Router, type Request, type Response } from "express";
import { getPrismaClient } from "@saclaw/database";
import { IMAdapterManager, type Platform } from "@saclaw/adapters";
import { EventEmitter } from "events";
import { authMiddleware } from "../middleware/auth";

const router = Router();

// 全局适配器管理器实例
const adapterManager = new IMAdapterManager();

// 存储连接 ID 与平台的映射
const connectionMap = new Map<string, Platform>();

// 连接日志事件发射器
export const connectionEvents = new EventEmitter();

// 连接日志存储（内存中保留最近 1000 条）
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
  // 发射事件供 WebSocket 订阅
  connectionEvents.emit("log", fullLog);
}

// GET /api/im - 获取 IM 连接列表
router.get("/", authMiddleware, async (req: Request, res: Response) => {
  try {
    const prisma = getPrismaClient();
    const connections = await prisma.iMConnection.findMany({
      orderBy: { updatedAt: "desc" },
    });
    res.json(connections);
  } catch (error) {
    console.error("Get IM connections error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/im - 创建 IM 连接
router.post("/", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { platform, name, config } = req.body;

    if (!platform) {
      res.status(400).json({ error: "Platform is required" });
      return;
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

    res.status(201).json(connection);
  } catch (error) {
    console.error("Create IM connection error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/im/:id - 更新 IM 连接
router.patch("/:id", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, config } = req.body;

    const prisma = getPrismaClient();
    const connection = await prisma.iMConnection.update({
      where: { id },
      data: {
        status,
        config: config ? JSON.stringify(config) : undefined,
      },
    });

    res.json(connection);
  } catch (error) {
    console.error("Update IM connection error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/im/:id - 删除 IM 连接
router.delete("/:id", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const prisma = getPrismaClient();

    // 如果连接处于连接状态，先断开
    const connection = await prisma.iMConnection.findUnique({ where: { id } });
    if (connection && connection.status === "connected") {
      const platform = connectionMap.get(id);
      if (platform) {
        await adapterManager.disconnect(platform);
        connectionMap.delete(id);
      }
    }

    await prisma.iMConnection.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    console.error("Delete IM connection error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/im/:id/test - 测试连接（不保存状态）
router.post("/:id/test", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const prisma = getPrismaClient();

    // 获取连接配置
    const connection = await prisma.iMConnection.findUnique({ where: { id } });
    if (!connection) {
      res.status(404).json({ error: "Connection not found" });
      return;
    }

    // 解析配置
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(connection.config || "{}");
    } catch {
      config = {};
    }

    const platform = connection.platform as Platform;
    const startTime = Date.now();

    try {
      // 尝试连接（使用临时的测试连接）
      const testResult = await adapterManager.testConnection(platform, config);
      const latency = Date.now() - startTime;

      // 记录测试日志
      addLog({
        connectionId: id,
        type: "test",
        message: `连接测试成功 - ${platform}`,
        details: { latency, platform },
      });

      res.json({
        success: true,
        latency,
        platform,
        message: "连接测试成功",
        details: testResult,
      });
    } catch (testError) {
      const latency = Date.now() - startTime;
      const errorMessage = testError instanceof Error ? testError.message : "Test failed";

      // 记录测试失败日志
      addLog({
        connectionId: id,
        type: "error",
        message: `连接测试失败 - ${errorMessage}`,
        details: { latency, platform, error: errorMessage },
      });

      res.status(400).json({
        success: false,
        latency,
        platform,
        error: errorMessage,
      });
    }
  } catch (error) {
    console.error("Test IM connection error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/im/:id/connect - 连接
router.post("/:id/connect", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const prisma = getPrismaClient();

    // 获取连接配置
    const connection = await prisma.iMConnection.findUnique({ where: { id } });
    if (!connection) {
      res.status(404).json({ error: "Connection not found" });
      return;
    }

    // 解析配置
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(connection.config || "{}");
    } catch {
      config = {};
    }

    const platform = connection.platform as Platform;

    try {
      // 实际连接适配器
      await adapterManager.connect(platform, config);
      connectionMap.set(id, platform);

      // 更新数据库状态
      const updatedConnection = await prisma.iMConnection.update({
        where: { id },
        data: { status: "connected", updatedAt: new Date() },
      });

      // 记录连接日志
      addLog({
        connectionId: id,
        type: "connect",
        message: `已连接到 ${platform}`,
        details: { platform, connectionName: connection.name },
      });

      // 发射状态变更事件
      connectionEvents.emit("status", {
        connectionId: id,
        status: "connected",
        platform,
      });

      res.json({ success: true, connection: updatedConnection });
    } catch (connectError) {
      // 连接失败，更新状态为错误
      await prisma.iMConnection.update({
        where: { id },
        data: { status: "error", updatedAt: new Date() },
      });

      const errorMessage = connectError instanceof Error ? connectError.message : "Connection failed";

      // 记录错误日志
      addLog({
        connectionId: id,
        type: "error",
        message: `连接失败: ${errorMessage}`,
        details: { platform, error: errorMessage },
      });

      // 发射状态变更事件
      connectionEvents.emit("status", {
        connectionId: id,
        status: "error",
        platform,
        error: errorMessage,
      });

      res.status(500).json({ error: errorMessage });
    }
  } catch (error) {
    console.error("Connect IM error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/im/:id/disconnect - 断开连接
router.post("/:id/disconnect", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const prisma = getPrismaClient();

    // 获取连接信息
    const connection = await prisma.iMConnection.findUnique({ where: { id } });
    if (!connection) {
      res.status(404).json({ error: "Connection not found" });
      return;
    }

    // 断开适配器连接
    const platform = connectionMap.get(id);
    if (platform) {
      try {
        await adapterManager.disconnect(platform);
      } catch (disconnectError) {
        console.warn("Adapter disconnect error:", disconnectError);
      }
      connectionMap.delete(id);
    }

    // 更新数据库状态
    const updatedConnection = await prisma.iMConnection.update({
      where: { id },
      data: { status: "disconnected", updatedAt: new Date() },
    });

    // 记录断开日志
    addLog({
      connectionId: id,
      type: "disconnect",
      message: `已断开 ${connection.platform}`,
      details: { platform: connection.platform, connectionName: connection.name },
    });

    // 发射状态变更事件
    connectionEvents.emit("status", {
      connectionId: id,
      status: "disconnected",
      platform: connection.platform,
    });

    res.json({ success: true, connection: updatedConnection });
  } catch (error) {
    console.error("Disconnect IM error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/im/:id/status - 获取连接状态
router.get("/:id/status", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const prisma = getPrismaClient();

    const connection = await prisma.iMConnection.findUnique({
      where: { id },
      select: { id: true, platform: true, status: true, updatedAt: true },
    });

    if (!connection) {
      res.status(404).json({ error: "Connection not found" });
      return;
    }

    // 检查适配器是否真正连接
    const platform = connectionMap.get(id);
    const adapter = platform ? adapterManager.get(platform) : null;
    const isConnected = adapter !== undefined;

    res.json({
      ...connection,
      adapterConnected: isConnected,
    });
  } catch (error) {
    console.error("Get IM status error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/im/:id/logs - 获取连接日志
router.get("/:id/logs", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { limit = 50, type } = req.query;

    // 过滤特定连接的日志
    let logs = connectionLogs.filter((log) => log.connectionId === id);

    // 按类型过滤
    if (type && typeof type === "string") {
      logs = logs.filter((log) => log.type === type);
    }

    // 限制数量
    const limitNum = Math.min(Math.max(1, parseInt(limit as string, 10)), 100);
    logs = logs.slice(0, limitNum);

    res.json(logs);
  } catch (error) {
    console.error("Get IM logs error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/im/logs - 获取所有连接日志
router.get("/logs", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { limit = 100, type, connectionId } = req.query;

    let logs = connectionLogs;

    // 按连接 ID 过滤
    if (connectionId && typeof connectionId === "string") {
      logs = logs.filter((log) => log.connectionId === connectionId);
    }

    // 按类型过滤
    if (type && typeof type === "string") {
      logs = logs.filter((log) => log.type === type);
    }

    // 限制数量
    const limitNum = Math.min(Math.max(1, parseInt(limit as string, 10)), 200);
    logs = logs.slice(0, limitNum);

    res.json(logs);
  } catch (error) {
    console.error("Get all IM logs error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/im/:id/logs - 清除特定连接的日志
router.delete("/:id/logs", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const initialLength = connectionLogs.length;

    // 移除特定连接的日志
    for (let i = connectionLogs.length - 1; i >= 0; i--) {
      if (connectionLogs[i]?.connectionId === id) {
        connectionLogs.splice(i, 1);
      }
    }

    const removedCount = initialLength - connectionLogs.length;

    res.json({ success: true, removedCount });
  } catch (error) {
    console.error("Clear IM logs error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;