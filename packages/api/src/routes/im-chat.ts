import { Hono } from "hono";
import { stream } from "hono/streaming";
import {
  SACODEClient,
  StreamingManager,
  createStreamChatController,
  type StreamChatOptions,
} from "@sacode/core";
import { createAdapter, type BaseAdapter, type StreamSender } from "@sacode/adapters";
import { getPrismaClient } from "@sacode/database";
import { authMiddleware } from "../middleware/auth";

type Variables = {
  userId: string;
};

const router = new Hono<{ Variables: Variables }>();

const activeClients = new Map<string, SACODEClient>();
const activeAdapters = new Map<string, BaseAdapter>();
const streamingManager = new StreamingManager();

// POST /api/im-chat/send
router.post("/send", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const {
      sessionId,
      platform,
      channelId,
      message,
      initialMessage,
      updateInterval,
    } = await c.req.json();

    if (!platform || !channelId || !message) {
      return c.json({ error: "platform, channelId, and message are required" }, 400);
    }

    let client = activeClients.get(userId);
    if (!client) {
      client = new SACODEClient({
        acpUrl: process.env.IFLOW_ACP_URL || "ws://localhost:8090/acp",
        autoStart: process.env.IFLOW_AUTO_START !== "false",
        timeout: parseInt(process.env.IFLOW_TIMEOUT || "60000", 10),
      });
      await client.connect();
      activeClients.set(userId, client);
    }

    const adapterKey = `${userId}:${platform}`;
    let adapter = activeAdapters.get(adapterKey);
    if (!adapter) {
      const prisma = getPrismaClient();
      const connection = await prisma.iMConnection.findFirst({
        where: { platform },
      });

      if (!connection) {
        return c.json({ error: `No ${platform} connection found` }, 404);
      }

      const config = JSON.parse(connection.config);
      adapter = createAdapter({ platform, config }) as BaseAdapter;
      await adapter.connect();
      activeAdapters.set(adapterKey, adapter);
    }

    const streamController = createStreamChatController(
      client,
      adapter as BaseAdapter & Partial<StreamSender>,
      { updateInterval },
    );

    const events: unknown[] = [];
    streamController.on("chunk", (data) => {
      events.push({ type: "chunk", ...data });
    });

    const options: StreamChatOptions = {
      sessionId,
      channelId,
      message,
      initialMessage,
      saveToDatabase: true,
    };

    const result = await streamController.chat(options);

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

      await prisma.chatSession.update({
        where: { id: sessionId },
        data: { updatedAt: new Date() },
      });
    }

    return c.json({
      success: result.success,
      content: result.content,
      messageId: result.messageId,
      error: result.error,
    });
  } catch (error) {
    console.error("IM chat error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /api/im-chat/stream
router.post("/stream", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const { sessionId, platform, channelId, message } = await c.req.json();

    if (!platform || !channelId || !message) {
      return c.json({ error: "platform, channelId, and message are required" }, 400);
    }

    let client = activeClients.get(userId);
    if (!client) {
      client = new SACODEClient({
        acpUrl: process.env.IFLOW_ACP_URL || "ws://localhost:8090/acp",
        autoStart: process.env.IFLOW_AUTO_START !== "false",
        timeout: parseInt(process.env.IFLOW_TIMEOUT || "60000", 10),
      });
      await client.connect();
      activeClients.set(userId, client);
    }

    return stream(c, async (stream) => {
      c.header("Content-Type", "text/event-stream");
      c.header("Cache-Control", "no-cache");
      c.header("Connection", "keep-alive");

      let accumulatedContent = "";

      try {
        for await (const chunk of client.chat(message, sessionId)) {
          const content = typeof chunk === "string" ? chunk :
            (chunk as { content?: string; text?: string })?.content ??
            (chunk as { text?: string })?.text ?? "";

          if (content) {
            accumulatedContent += content;
            await stream.write(`data: ${JSON.stringify({ type: "chunk", content })}\n\n`);
          }
        }

        await stream.write(`data: ${JSON.stringify({ type: "complete", content: accumulatedContent })}\n\n`);
      } catch (streamError) {
        await stream.write(`data: ${JSON.stringify({ type: "error", error: String(streamError) })}\n\n`);
      }
    });
  } catch (error) {
    console.error("IM stream chat error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /api/im-chat/broadcast
router.post("/broadcast", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const { message, platforms, channelId } = await c.req.json();

    if (!message || !platforms || !Array.isArray(platforms)) {
      return c.json({ error: "message and platforms array are required" }, 400);
    }

    const prisma = getPrismaClient();
    const results: Array<{ platform: string; success: boolean; error?: string }> = [];

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

    return c.json({ results });
  } catch (error) {
    console.error("Broadcast error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /api/im-chat/status
router.get("/status", authMiddleware, (c) => {
  const activeSessions = streamingManager.getActiveSessions();

  return c.json({
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

export function cleanupImChat(): void {
  for (const client of activeClients.values()) {
    client.disconnect();
  }
  activeClients.clear();
  activeAdapters.clear();
  streamingManager.cleanup();
}

export default router;
