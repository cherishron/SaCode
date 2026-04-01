/**
 * IM 流式聊天 API 路由
 *
 * 提供通过 IM 平台进行流式聊天的功能
 */

import { Router, type Request, type Response } from "express";
import {
  SaClawClient,
  StreamingManager,
  createStreamChatController,
  type StreamChatOptions,
} from "@saclaw/core";
import { createAdapter, type BaseAdapter, type StreamSender } from "@saclaw/adapters";
import { getPrismaClient } from "@saclaw/database";
import { authMiddleware } from "../middleware/auth";

const router = Router();

// 存储活跃的客户端和适配器
const activeClients = new Map<string, SaClawClient>();
const activeAdapters = new Map<string, BaseAdapter>();
const streamingManager = new StreamingManager();

/**
 * POST /api/im-chat/send
 * 通过 IM 平台发送流式消息
 */
router.post("/send", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId: string }).userId;
    const { 
      sessionId, 
      platform, 
      channelId, 
      message, 
      initialMessage,
      updateInterval 
    } = req.body;

    if (!platform || !channelId || !message) {
      res.status(400).json({ error: "platform, channelId, and message are required" });
      return;
    }

    // 获取或创建客户端
    let client = activeClients.get(userId);
    if (!client) {
      client = new SaClawClient({
        acpUrl: process.env.IFLOW_ACP_URL || "ws://localhost:8090/acp",
        autoStart: process.env.IFLOW_AUTO_START !== "false",
        timeout: parseInt(process.env.IFLOW_TIMEOUT || "60000", 10),
      });
      await client.connect();
      activeClients.set(userId, client);
    }

    // 获取或创建适配器
    const adapterKey = `${userId}:${platform}`;
    let adapter = activeAdapters.get(adapterKey);
    if (!adapter) {
      const prisma = getPrismaClient();
      const connection = await prisma.iMConnection.findFirst({
        where: { platform },
      });

      if (!connection) {
        res.status(404).json({ error: `No ${platform} connection found` });
        return;
      }

      const config = JSON.parse(connection.config);
      adapter = createAdapter({ platform, config }) as BaseAdapter;
      await adapter.connect();
      activeAdapters.set(adapterKey, adapter);
    }

    // 创建流式聊天控制器
    const streamController = createStreamChatController(
      client,
      adapter as BaseAdapter & Partial<StreamSender>,
      { updateInterval }
    );

    // 设置事件监听
    const events: unknown[] = [];
    streamController.on("chunk", (data) => {
      events.push({ type: "chunk", ...data });
    });

    // 执行流式聊天
    const options: StreamChatOptions = {
      sessionId,
      channelId,
      message,
      initialMessage,
      saveToDatabase: true,
    };

    const result = await streamController.chat(options);

    // 保存消息到数据库
    if (sessionId) {
      const prisma = getPrismaClient();
      await prisma.chatMessage.createMany({
        data: [
          {
            sessionId,
            role: "user",
            content: message,
          },
          {
            sessionId,
            role: "assistant",
            content: result.content,
          },
        ],
      });

      // 更新会话
      await prisma.chatSession.update({
        where: { id: sessionId },
        data: { updatedAt: new Date() },
      });
    }

    res.json({
      success: result.success,
      content: result.content,
      messageId: result.messageId,
      error: result.error,
    });
  } catch (error) {
    console.error("IM chat error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/im-chat/stream
 * WebSocket 风格的流式聊天（返回 SSE）
 */
router.post("/stream", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId: string }).userId;
    const { sessionId, platform, channelId, message } = req.body;

    if (!platform || !channelId || !message) {
      res.status(400).json({ error: "platform, channelId, and message are required" });
      return;
    }

    // 设置 SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // 获取或创建客户端
    let client = activeClients.get(userId);
    if (!client) {
      client = new SaClawClient({
        acpUrl: process.env.IFLOW_ACP_URL || "ws://localhost:8090/acp",
        autoStart: process.env.IFLOW_AUTO_START !== "false",
        timeout: parseInt(process.env.IFLOW_TIMEOUT || "60000", 10),
      });
      await client.connect();
      activeClients.set(userId, client);
    }

    // 流式聊天并发送 SSE
    let accumulatedContent = "";

    try {
      for await (const chunk of client.chat(message, sessionId)) {
        const content = typeof chunk === "string" ? chunk : 
          (chunk as { content?: string; text?: string })?.content ?? 
          (chunk as { text?: string })?.text ?? "";

        if (content) {
          accumulatedContent += content;
          res.write(`data: ${JSON.stringify({ type: "chunk", content })}\n\n`);
        }
      }

      // 发送完成事件
      res.write(`data: ${JSON.stringify({ type: "complete", content: accumulatedContent })}\n\n`);
    } catch (streamError) {
      res.write(`data: ${JSON.stringify({ type: "error", error: String(streamError) })}\n\n`);
    }

    res.end();
  } catch (error) {
    console.error("IM stream chat error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/im-chat/broadcast
 * 向多个 IM 平台广播消息
 */
router.post("/broadcast", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId: string }).userId;
    const { message, platforms, channelId } = req.body;

    if (!message || !platforms || !Array.isArray(platforms)) {
      res.status(400).json({ error: "message and platforms array are required" });
      return;
    }

    const prisma = getPrismaClient();
    const results: Array<{ platform: string; success: boolean; error?: string }> = [];

    // 获取所有连接
    const connections = await prisma.iMConnection.findMany({
      where: {
        platform: { in: platforms },
        status: "connected",
      },
    });

    for (const connection of connections) {
      try {
        const adapterKey = `${userId}:${connection.platform}`;
        let adapter = activeAdapters.get(adapterKey);
        
        if (!adapter) {
          const config = JSON.parse(connection.config);
          adapter = createAdapter({ platform: connection.platform, config }) as BaseAdapter;
          await adapter.connect();
          activeAdapters.set(adapterKey, adapter);
        }

        const targetChannelId = channelId || connection.config;
        await adapter.send(targetChannelId, message);

        results.push({ platform: connection.platform, success: true });
      } catch (error) {
        results.push({
          platform: connection.platform,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    res.json({ results });
  } catch (error) {
    console.error("Broadcast error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/im-chat/status
 * 获取 IM 聊天状态
 */
router.get("/status", authMiddleware, async (_req: Request, res: Response) => {
  const activeSessions = streamingManager.getActiveSessions();

  res.json({
    activeClients: activeClients.size,
    activeAdapters: activeAdapters.size,
    activeStreamingSessions: activeSessions.length,
    sessions: activeSessions.map((s) => ({
      id: s.id,
      platform: s.platform,
      channelId: s.channelId,
      startTime: s.startTime,
    })),
  });
});

/**
 * 清理函数
 */
export function cleanupImChat(): void {
  for (const client of activeClients.values()) {
    client.disconnect();
  }
  activeClients.clear();
  activeAdapters.clear();
  streamingManager.cleanup();
}

export default router;
