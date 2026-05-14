/**
 * 多媒体消息 API 路由
 *
 * 提供语音、图片、文件等多媒体消息的上传和处理功能
 */

import { Router, type Request, type Response } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { getPrismaClient } from "@sacode/database";
import { authMiddleware } from "../middleware/auth";

const router = Router();
const DEFAULT_MEDIA_DIR = "data/media";

// ============================================
// 类型定义
// ============================================

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

// ============================================
// 路由
// ============================================

/**
 * POST /api/media/upload
 * 上传媒体文件
 */
router.post("/upload", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { type, filename, mimeType, contentBase64 } = req.body;

    if (!type) {
      res.status(400).json({ error: "type is required" });
      return;
    }

    if (typeof contentBase64 !== "string" || contentBase64.length === 0) {
      res.status(400).json({ error: "contentBase64 is required" });
      return;
    }

    const buffer = Buffer.from(contentBase64, "base64");
    if (buffer.length === 0) {
      res.status(400).json({ error: "contentBase64 is invalid" });
      return;
    }

    const storage = await saveLocalMediaFile({ type, filename, content: buffer });

    res.status(201).json({
      success: true,
      mediaUrl: storage.mediaUrl,
      mediaMeta: {
        filename: storage.filename,
        mimeType,
        size: buffer.length,
        storage: "local",
      },
    });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: "Failed to upload media" });
  }
});

/**
 * POST /api/media/message
 * 发送多媒体消息
 */
router.post("/message", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId: string }).userId;
    const { sessionId, message }: { sessionId: string; message: MediaMessage } = req.body;

    if (!sessionId || !message) {
      res.status(400).json({ error: "sessionId and message are required" });
      return;
    }

    const prisma = getPrismaClient();

    // 验证会话所有权
    const session = await prisma.chatSession.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    // 创建多媒体消息
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

    res.status(201).json({
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
    });
  } catch (error) {
    console.error("Send media message error:", error);
    res.status(500).json({ error: "Failed to send media message" });
  }
});

/**
 * GET /api/media/session/:sessionId
 * 获取会话的多媒体消息
 */
router.get("/session/:sessionId", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId: string }).userId;
    const { sessionId } = req.params;
    const { type } = req.query;

    const prisma = getPrismaClient();

    // 验证会话所有权
    const session = await prisma.chatSession.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    // 构建查询条件
    const where: Record<string, unknown> = { sessionId };
    if (type && typeof type === "string") {
      where.contentType = type;
    }

    const messages = await prisma.chatMessage.findMany({
      where,
      orderBy: { createdAt: "asc" },
    });

    // 解析 mediaMeta
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

    res.json(parsedMessages);
  } catch (error) {
    console.error("Get media messages error:", error);
    res.status(500).json({ error: "Failed to get media messages" });
  }
});

/**
 * POST /api/media/process
 * 处理媒体文件（如语音转文字、图片 OCR 等）
 */
router.post("/process", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { mediaUrl, type, operation } = req.body;

    if (!mediaUrl || !type || !operation) {
      res.status(400).json({ error: "mediaUrl, type, and operation are required" });
      return;
    }

    if (!isSupportedMediaOperation(operation)) {
      res.status(400).json({ error: "Unknown operation" });
      return;
    }

    res.status(501).json({
      error: "Media processing service is not configured",
      mediaUrl,
      type,
      operation,
      requiredEnv: mediaOperationEnv(operation),
    });
  } catch (error) {
    console.error("Process media error:", error);
    res.status(500).json({ error: "Failed to process media" });
  }
});

/**
 * POST /api/media/voice
 * 发送语音消息并自动转文字
 */
router.post("/voice", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId: string }).userId;
    const { sessionId, mediaUrl, duration, autoTranscribe = true } = req.body;

    if (!sessionId || !mediaUrl) {
      res.status(400).json({ error: "sessionId and mediaUrl are required" });
      return;
    }

    const prisma = getPrismaClient();

    // 验证会话所有权
    const session = await prisma.chatSession.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    let transcribedText: string | undefined;

    if (autoTranscribe) {
      res.status(501).json({
        error: "Voice transcription service is not configured",
        requiredEnv: mediaOperationEnv("transcribe"),
      });
      return;
    }

    // 创建语音消息
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

    res.status(201).json({
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
    });
  } catch (error) {
    console.error("Send voice message error:", error);
    res.status(500).json({ error: "Failed to send voice message" });
  }
});

/**
 * POST /api/media/image
 * 发送图片消息并自动生成描述
 */
router.post("/image", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId: string }).userId;
    const { sessionId, mediaUrl, width, height, autoDescribe = true } = req.body;

    if (!sessionId || !mediaUrl) {
      res.status(400).json({ error: "sessionId and mediaUrl are required" });
      return;
    }

    const prisma = getPrismaClient();

    // 验证会话所有权
    const session = await prisma.chatSession.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    let description: string | undefined;

    if (autoDescribe) {
      res.status(501).json({
        error: "Image description service is not configured",
        requiredEnv: mediaOperationEnv("describe"),
      });
      return;
    }

    // 创建图片消息
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

    res.status(201).json({
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
    });
  } catch (error) {
    console.error("Send image message error:", error);
    res.status(500).json({ error: "Failed to send image message" });
  }
});

export default router;

async function saveLocalMediaFile(input: { type: string; filename?: string; content: Buffer }): Promise<{ filename: string; mediaUrl: string }> {
  const safeType = sanitizePathSegment(input.type);
  const originalName = sanitizeFilename(input.filename ?? "file.bin");
  const filename = `${Date.now()}_${crypto.randomUUID()}_${originalName}`;
  const mediaDir = path.resolve(process.env.MEDIA_STORAGE_DIR ?? DEFAULT_MEDIA_DIR, safeType);
  await fs.mkdir(mediaDir, { recursive: true });
  await fs.writeFile(path.join(mediaDir, filename), input.content);
  const baseUrl = process.env.MEDIA_PUBLIC_BASE_URL ?? "/media";
  return { filename, mediaUrl: `${baseUrl.replace(/\/$/, "")}/${safeType}/${filename}` };
}

function sanitizePathSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]/g, "-") || "file";
}

function sanitizeFilename(value: string): string {
  const basename = path.basename(value).replace(/[^a-zA-Z0-9._-]/g, "-");
  return basename || "file.bin";
}

function isSupportedMediaOperation(value: unknown): value is "transcribe" | "ocr" | "describe" {
  return value === "transcribe" || value === "ocr" || value === "describe";
}

function mediaOperationEnv(operation: "transcribe" | "ocr" | "describe"): string[] {
  switch (operation) {
    case "transcribe":
      return ["MEDIA_TRANSCRIBE_PROVIDER", "MEDIA_TRANSCRIBE_API_KEY"];
    case "ocr":
      return ["MEDIA_OCR_PROVIDER", "MEDIA_OCR_API_KEY"];
    case "describe":
      return ["MEDIA_VISION_PROVIDER", "MEDIA_VISION_API_KEY"];
  }
}
