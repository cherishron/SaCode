/**
 * 多媒体消息 API 路由
 *
 * 提供语音、图片、文件等多媒体消息的上传和处理功能
 */

import { Router, type Request, type Response } from "express";
import { getPrismaClient } from "@saclaw/database";
import { authMiddleware } from "../middleware/auth";

const router = Router();

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
 * 上传媒体文件（占位实现，实际需要集成文件存储服务）
 */
router.post("/upload", authMiddleware, async (req: Request, res: Response) => {
  try {
    // TODO: 集成实际的文件存储服务（如 S3、OSS、本地存储等）
    // 当前返回占位 URL
    const { type, filename, mimeType, size } = req.body;

    if (!type) {
      res.status(400).json({ error: "type is required" });
      return;
    }

    // 生成临时 URL（实际项目中应该上传到存储服务）
    const mediaUrl = `https://storage.example.com/${type}/${Date.now()}_${filename ?? "file"}`;

    res.status(201).json({
      success: true,
      mediaUrl,
      mediaMeta: {
        filename,
        mimeType,
        size,
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

    // TODO: 集成实际的媒体处理服务
    // - 语音转文字：Whisper API、阿里云语音识别等
    // - 图片 OCR：百度 OCR、Google Vision API 等
    // - 图片描述：GPT-4V、Claude Vision 等

    let result: Record<string, unknown> = {};

    switch (operation) {
      case "transcribe":
        // 语音转文字
        result = {
          text: "[语音转文字结果占位]",
          duration: 0,
          language: "zh",
        };
        break;

      case "ocr":
        // 图片 OCR
        result = {
          text: "[OCR 识别结果占位]",
          confidence: 0.95,
          regions: [],
        };
        break;

      case "describe":
        // 图片描述
        result = {
          description: "[图片描述占位]",
          tags: [],
          objects: [],
        };
        break;

      default:
        res.status(400).json({ error: "Unknown operation" });
        return;
    }

    res.json({
      success: true,
      mediaUrl,
      type,
      operation,
      result,
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

    // 如果启用自动转文字
    if (autoTranscribe) {
      // TODO: 调用实际的语音转文字服务
      transcribedText = "[语音转文字结果占位]";
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

    // 如果启用自动描述
    if (autoDescribe) {
      // TODO: 调用实际的图片描述服务（如 GPT-4V）
      description = "[图片描述占位]";
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
