import { Hono } from "hono";
import { getPrismaClient } from "@sacode/database";
import { authMiddleware } from "../middleware/auth";

type Variables = {
  userId: string;
};

const router = new Hono<{ Variables: Variables }>();

type ContentType = "text" | "image" | "audio" | "video" | "file" | "mixed";

interface MediaMessage {
  type: ContentType;
  content: string;
  mediaUrl?: string;
  mediaMeta?: {
    filename?: string;
    mimeType?: string;
    size?: number;
    width?: number;
    height?: number;
    duration?: number;
    thumbnail?: string;
  };
}

// POST /api/media/upload
router.post("/upload", authMiddleware, async (c) => {
  try {
    const { type, filename, mimeType, size } = await c.req.json();

    if (!type) {
      return c.json({ error: "type is required" }, 400);
    }

    const mediaUrl = `https://storage.example.com/${type}/${Date.now()}_${filename ?? "file"}`;

    return c.json({
      success: true,
      mediaUrl,
      mediaMeta: {
        filename,
        mimeType,
        size,
      },
    }, 201);
  } catch (error) {
    console.error("Upload error:", error);
    return c.json({ error: "Failed to upload media" }, 500);
  }
});

// POST /api/media/message
router.post("/message", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const { sessionId, message }: { sessionId: string; message: MediaMessage } = await c.req.json();

    if (!sessionId || !message) {
      return c.json({ error: "sessionId and message are required" }, 400);
    }

    const prisma = getPrismaClient();

    const session = await prisma.chatSession.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    const chatMessage = await prisma.chatMessage.create({
      data: {
        sessionId,
        role: "user",
        content: message.content,
        contentType: message.type,
        mediaUrl: message.mediaUrl,
        mediaMeta: message.mediaMeta ? JSON.stringify(message.mediaMeta) : null,
      },
    });

    return c.json({
      success: true,
      message: {
        id: chatMessage.id,
        sessionId: chatMessage.sessionId,
        role: chatMessage.role,
        content: chatMessage.content,
        contentType: chatMessage.contentType,
        mediaUrl: chatMessage.mediaUrl,
        mediaMeta: chatMessage.mediaMeta ? JSON.parse(chatMessage.mediaMeta) : null,
        createdAt: chatMessage.createdAt,
      },
    }, 201);
  } catch (error) {
    console.error("Send media message error:", error);
    return c.json({ error: "Failed to send media message" }, 500);
  }
});

// GET /api/media/session/:sessionId
router.get("/session/:sessionId", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const sessionId = c.req.param("sessionId");
    const type = c.req.query("type");

    const prisma = getPrismaClient();

    const session = await prisma.chatSession.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    const where: Record<string, unknown> = { sessionId };
    if (type && typeof type === "string") {
      where.contentType = type;
    }

    const messages = await prisma.chatMessage.findMany({
      where,
      orderBy: { createdAt: "asc" },
    });

    const parsedMessages = messages.map((m) => ({
      id: m.id,
      sessionId: m.sessionId,
      role: m.role,
      content: m.content,
      contentType: m.contentType,
      mediaUrl: m.mediaUrl,
      mediaMeta: m.mediaMeta ? JSON.parse(m.mediaMeta) : null,
      createdAt: m.createdAt,
    }));

    return c.json(parsedMessages);
  } catch (error) {
    console.error("Get media messages error:", error);
    return c.json({ error: "Failed to get media messages" }, 500);
  }
});

// POST /api/media/process
router.post("/process", authMiddleware, async (c) => {
  try {
    const { mediaUrl, type, operation } = await c.req.json();

    if (!mediaUrl || !type || !operation) {
      return c.json({ error: "mediaUrl, type, and operation are required" }, 400);
    }

    let result: Record<string, unknown> = {};

    switch (operation) {
      case "transcribe":
        result = {
          text: "[语音转文字结果占位]",
          duration: 0,
          language: "zh",
        };
        break;

      case "ocr":
        result = {
          text: "[OCR 识别结果占位]",
          confidence: 0.95,
          regions: [],
        };
        break;

      case "describe":
        result = {
          description: "[图片描述占位]",
          tags: [],
          objects: [],
        };
        break;

      default:
        return c.json({ error: "Unknown operation" }, 400);
    }

    return c.json({
      success: true,
      mediaUrl,
      type,
      operation,
      result,
    });
  } catch (error) {
    console.error("Process media error:", error);
    return c.json({ error: "Failed to process media" }, 500);
  }
});

// POST /api/media/voice
router.post("/voice", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const { sessionId, mediaUrl, duration, autoTranscribe = true } = await c.req.json();

    if (!sessionId || !mediaUrl) {
      return c.json({ error: "sessionId and mediaUrl are required" }, 400);
    }

    const prisma = getPrismaClient();

    const session = await prisma.chatSession.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    let transcribedText: string | undefined;

    if (autoTranscribe) {
      transcribedText = "[语音转文字结果占位]";
    }

    const chatMessage = await prisma.chatMessage.create({
      data: {
        sessionId,
        role: "user",
        content: transcribedText ?? "[语音消息]",
        contentType: "audio",
        mediaUrl,
        mediaMeta: JSON.stringify({
          duration,
          transcribedText,
          mimeType: "audio/webm",
        }),
      },
    });

    return c.json({
      success: true,
      message: {
        id: chatMessage.id,
        sessionId: chatMessage.sessionId,
        role: chatMessage.role,
        content: chatMessage.content,
        contentType: chatMessage.contentType,
        mediaUrl: chatMessage.mediaUrl,
        mediaMeta: chatMessage.mediaMeta ? JSON.parse(chatMessage.mediaMeta) : null,
        createdAt: chatMessage.createdAt,
      },
    }, 201);
  } catch (error) {
    console.error("Send voice message error:", error);
    return c.json({ error: "Failed to send voice message" }, 500);
  }
});

// POST /api/media/image
router.post("/image", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const { sessionId, mediaUrl, width, height, autoDescribe = true } = await c.req.json();

    if (!sessionId || !mediaUrl) {
      return c.json({ error: "sessionId and mediaUrl are required" }, 400);
    }

    const prisma = getPrismaClient();

    const session = await prisma.chatSession.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    let description: string | undefined;

    if (autoDescribe) {
      description = "[图片描述占位]";
    }

    const chatMessage = await prisma.chatMessage.create({
      data: {
        sessionId,
        role: "user",
        content: description ?? "[图片消息]",
        contentType: "image",
        mediaUrl,
        mediaMeta: JSON.stringify({
          width,
          height,
          description,
          mimeType: "image/jpeg",
        }),
      },
    });

    return c.json({
      success: true,
      message: {
        id: chatMessage.id,
        sessionId: chatMessage.sessionId,
        role: chatMessage.role,
        content: chatMessage.content,
        contentType: chatMessage.contentType,
        mediaUrl: chatMessage.mediaUrl,
        mediaMeta: chatMessage.mediaMeta ? JSON.parse(chatMessage.mediaMeta) : null,
        createdAt: chatMessage.createdAt,
      },
    }, 201);
  } catch (error) {
    console.error("Send image message error:", error);
    return c.json({ error: "Failed to send image message" }, 500);
  }
});

export default router;
