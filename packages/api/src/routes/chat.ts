import { Router, type Request, type Response } from "express";
import { SACODEClient } from "@sacode/core";
import { getPrismaClient } from "@sacode/database";
import { authMiddleware } from "../middleware/auth";

const router = Router();

// 存储活跃的客户端连接
const activeClients = new Map<string, SACODEClient>();

// POST /api/chat
router.post("/", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId: string }).userId;
    const { message, sessionId } = req.body;

    if (!message) {
      res.status(400).json({ error: "Message is required" });
      return;
    }

    // 获取或创建客户端
    let client = activeClients.get(userId);
    if (!client) {
      // 使用新的 Provider 配置模式
      client = new SACODEClient({
        provider: process.env.AI_PROVIDER ? {
          type: process.env.AI_PROVIDER as "openai" | "anthropic" | "deepseek" | "moonshot" | "zhipu",
          apiKey: process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || "",
          model: process.env.AI_MODEL,
          baseUrl: process.env.AI_BASE_URL,
          timeout: parseInt(process.env.AI_TIMEOUT || "60000", 10),
        } : undefined,
        maxToolLoopIterations: parseInt(process.env.MAX_TOOL_LOOP_ITERATIONS || "10", 10),
        debug: process.env.NODE_ENV === "development",
      });
      await client.connect();
      activeClients.set(userId, client);
    }

    // 收集所有响应
    const responses: unknown[] = [];

    for await (const msg of client.chat(message, sessionId)) {
      responses.push(msg);
    }

    // 保存消息到数据库
    const prisma = getPrismaClient();
    if (sessionId) {
      await prisma.chatMessage.create({
        data: {
          sessionId,
          role: "user",
          content: message,
        },
      });
    }

    res.json({ success: true, responses });
  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/chat/agentic - Agentic 模式聊天（带自动规划）
router.post("/agentic", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId: string }).userId;
    const { message, sessionId, enablePlanning } = req.body;

    if (!message) {
      res.status(400).json({ error: "Message is required" });
      return;
    }

    // 获取或创建客户端（带 Agentic 规划支持）
    const clientKey = `${userId}-agentic`;
    let client = activeClients.get(clientKey);
    if (!client) {
      client = new SACODEClient({
        provider: process.env.AI_PROVIDER ? {
          type: process.env.AI_PROVIDER as "openai" | "anthropic" | "deepseek" | "moonshot" | "zhipu",
          apiKey: process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || "",
          model: process.env.AI_MODEL,
          baseUrl: process.env.AI_BASE_URL,
          timeout: parseInt(process.env.AI_TIMEOUT || "60000", 10),
        } : undefined,
        maxToolLoopIterations: parseInt(process.env.MAX_TOOL_LOOP_ITERATIONS || "10", 10),
        enableAgenticPlanning: enablePlanning !== false,
        debug: process.env.NODE_ENV === "development",
      });
      await client.connect();
      activeClients.set(clientKey, client);
    }

    // 收集所有响应（包括 Agentic 事件）
    const responses: unknown[] = [];
    const events: Array<{ type: string; data: unknown }> = [];

    for await (const msg of client.agenticChat(message, sessionId)) {
      if ("type" in msg && typeof msg.type === "string") {
        // Agentic 事件（规划、步骤执行等）
        events.push({ type: msg.type, data: msg });
        responses.push(msg);
      } else {
        // 普通消息响应
        responses.push(msg);
      }
    }

    // 保存消息到数据库
    const prisma = getPrismaClient();
    if (sessionId) {
      await prisma.chatMessage.create({
        data: {
          sessionId,
          role: "user",
          content: message,
        },
      });
    }

    res.json({ success: true, responses, events });
  } catch (error) {
    console.error("Agentic chat error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/chat/sessions
router.get("/sessions", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId: string }).userId;
    const prisma = getPrismaClient();

    const sessions = await prisma.chatSession.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 50,
    });

    res.json(sessions);
  } catch (error) {
    console.error("Get sessions error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/chat/sessions/:id/messages
router.get(
  "/sessions/:id/messages",
  authMiddleware,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const prisma = getPrismaClient();

      const messages = await prisma.chatMessage.findMany({
        where: { sessionId: id },
        orderBy: { createdAt: "asc" },
      });

      res.json(messages);
    } catch (error) {
      console.error("Get messages error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// POST /api/chat/sessions
router.post("/sessions", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId: string }).userId;
    const { title, channelId, platform } = req.body;

    const prisma = getPrismaClient();
    const session = await prisma.chatSession.create({
      data: {
        userId,
        title,
        channelId,
        platform,
      },
    });

    res.status(201).json(session);
  } catch (error) {
    console.error("Create session error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/chat/sessions/:id - 获取会话详情
router.get("/sessions/:id", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId: string }).userId;
    const { id } = req.params;
    const prisma = getPrismaClient();

    const session = await prisma.chatSession.findFirst({
      where: { id, userId },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          take: 100,
        },
      },
    });

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    res.json(session);
  } catch (error) {
    console.error("Get session error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/chat/sessions/:id - 更新会话
router.patch("/sessions/:id", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId: string }).userId;
    const { id } = req.params;
    const { title, channelId, platform } = req.body;
    const prisma = getPrismaClient();

    // 验证会话所有权
    const existingSession = await prisma.chatSession.findFirst({
      where: { id, userId },
    });

    if (!existingSession) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const session = await prisma.chatSession.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(channelId !== undefined && { channelId }),
        ...(platform !== undefined && { platform }),
        updatedAt: new Date(),
      },
    });

    res.json(session);
  } catch (error) {
    console.error("Update session error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/chat/sessions/:id - 删除会话
router.delete("/sessions/:id", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId: string }).userId;
    const { id } = req.params;
    const prisma = getPrismaClient();

    // 验证会话所有权
    const existingSession = await prisma.chatSession.findFirst({
      where: { id, userId },
    });

    if (!existingSession) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    // 删除会话及其消息
    await prisma.$transaction([
      prisma.chatMessage.deleteMany({ where: { sessionId: id } }),
      prisma.chatSession.delete({ where: { id } }),
    ]);

    res.status(204).send();
  } catch (error) {
    console.error("Delete session error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/chat/search - 搜索消息（增强版）
router.get("/search", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId: string }).userId;
    const {
      q,
      sessionId,
      role,
      startDate,
      endDate,
      limit = 50,
      offset = 0,
      highlight = "true",
      facets = "false",
    } = req.query;

    if (!q || typeof q !== "string" || q.trim().length === 0) {
      res.status(400).json({ error: "Search query is required" });
      return;
    }

    const prisma = getPrismaClient();
    const searchQuery = q.trim();
    const shouldHighlight = highlight === "true";
    const shouldIncludeFacets = facets === "true";

    // 构建查询条件
    interface WhereCondition {
      content: { contains: string; mode: "insensitive" };
      sessionId?: string;
      role?: string;
      session?: { userId: string };
      createdAt?: { gte?: Date; lte?: Date };
    }

    const where: WhereCondition = {
      content: {
        contains: searchQuery,
        mode: "insensitive",
      },
      session: {
        userId,
      },
    };

    if (sessionId && typeof sessionId === "string") {
      where.sessionId = sessionId;
    }

    if (role && typeof role === "string" && (role === "user" || role === "assistant")) {
      where.role = role;
    }

    // 时间范围过滤
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate && typeof startDate === "string") {
        where.createdAt.gte = new Date(startDate);
      }
      if (endDate && typeof endDate === "string") {
        where.createdAt.lte = new Date(endDate);
      }
    }

    // 执行搜索
    const messages = await prisma.chatMessage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: Math.min(parseInt(limit as string, 10), 100),
      skip: parseInt(offset as string, 10),
      include: {
        session: {
          select: {
            id: true,
            title: true,
          },
        },
      },
    });

    // 获取总数
    const total = await prisma.chatMessage.count({ where });

    // 高亮处理函数
    function highlightText(text: string, query: string): string {
      if (!query) return text;
      const regex = new RegExp(
        `(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
        "gi"
      );
      return text.replace(regex, "<mark>$1</mark>");
    }

    // 处理结果
    const processedMessages = shouldHighlight
      ? messages.map((msg) => ({
          ...msg,
          contentHighlighted: highlightText(msg.content, searchQuery),
        }))
      : messages;

    // 构建响应
    const response: {
      messages: typeof processedMessages;
      total: number;
      query: string;
      facets?: {
        byRole: Array<{ role: string; count: number }>;
        bySession: Array<{ sessionId: string; sessionTitle: string | null; count: number }>;
        byDate: Array<{ date: string; count: number }>;
      };
    } = {
      messages: processedMessages,
      total,
      query: searchQuery,
    };

    // 聚合统计
    if (shouldIncludeFacets) {
      // 按角色统计
      const byRole = await prisma.chatMessage.groupBy({
        by: ["role"],
        where,
        _count: { id: true },
      });

      // 按会话统计
      const bySessionRaw = await prisma.chatMessage.groupBy({
        by: ["sessionId"],
        where,
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 10,
      });

      const sessionIds = bySessionRaw.map((s) => s.sessionId);
      const sessionDetails = await prisma.chatSession.findMany({
        where: { id: { in: sessionIds } },
        select: { id: true, title: true },
      });

      const sessionMap = new Map(sessionDetails.map((s) => [s.id, s.title]));

      // 按日期统计（最近 7 天）
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const recentMessages = await prisma.chatMessage.findMany({
        where: {
          ...where,
          createdAt: { gte: sevenDaysAgo },
        },
        select: { createdAt: true },
      });

      const dateCount = new Map<string, number>();
      for (const msg of recentMessages) {
        const dateStr = msg.createdAt.toISOString().split("T")[0] ?? "";
        dateCount.set(dateStr, (dateCount.get(dateStr) ?? 0) + 1);
      }

      response.facets = {
        byRole: byRole.map((r) => ({ role: r.role, count: r._count.id })),
        bySession: bySessionRaw.map((s) => ({
          sessionId: s.sessionId,
          sessionTitle: sessionMap.get(s.sessionId) ?? null,
          count: s._count.id,
        })),
        byDate: Array.from(dateCount.entries())
          .map(([date, count]) => ({ date, count }))
          .sort((a, b) => a.date.localeCompare(b.date)),
      };
    }

    res.json(response);
  } catch (error) {
    console.error("Search messages error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/chat/search/suggestions - 搜索建议
router.get("/search/suggestions", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId: string }).userId;
    const { q, limit = 5 } = req.query;

    if (!q || typeof q !== "string" || q.trim().length < 2) {
      res.json({ suggestions: [] });
      return;
    }

    const prisma = getPrismaClient();
    const searchQuery = q.trim();

    // 搜索相关会话标题
    const sessions = await prisma.chatSession.findMany({
      where: {
        userId,
        title: { contains: searchQuery },
      },
      select: { id: true, title: true },
      take: parseInt(limit as string, 10),
    });

    // 搜索相关消息内容（提取关键词片段）
    const messages = await prisma.chatMessage.findMany({
      where: {
        content: { contains: searchQuery },
        session: { userId },
      },
      select: { content: true },
      take: parseInt(limit as string, 10),
    });

    // 生成建议
    const suggestions = [
      ...sessions.map((s) => ({
        type: "session" as const,
        text: s.title ?? "无标题",
        sessionId: s.id,
      })),
      ...messages.map((m) => ({
        type: "message" as const,
        text: m.content.slice(0, 100) + (m.content.length > 100 ? "..." : ""),
      })),
    ];

    res.json({ suggestions: suggestions.slice(0, parseInt(limit as string, 10) * 2) });
  } catch (error) {
    console.error("Search suggestions error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ==================== 批量操作 API ====================

// POST /api/chat/sessions/batch-delete - 批量删除会话
router.post("/sessions/batch-delete", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId: string }).userId;
    const { sessionIds } = req.body as { sessionIds: string[] };

    if (!sessionIds || !Array.isArray(sessionIds) || sessionIds.length === 0) {
      res.status(400).json({ error: "sessionIds is required and must be a non-empty array" });
      return;
    }

    // 限制批量操作数量
    if (sessionIds.length > 100) {
      res.status(400).json({ error: "Cannot delete more than 100 sessions at once" });
      return;
    }

    const prisma = getPrismaClient();

    // 验证所有会话都属于当前用户
    const sessions = await prisma.chatSession.findMany({
      where: {
        id: { in: sessionIds },
        userId,
      },
      select: { id: true },
    });

    const validIds = sessions.map(s => s.id);
    const invalidCount = sessionIds.length - validIds.length;

    if (validIds.length === 0) {
      res.status(404).json({ error: "No valid sessions found" });
      return;
    }

    // 批量删除（级联删除消息）
    const result = await prisma.$transaction([
      prisma.chatMessage.deleteMany({
        where: { sessionId: { in: validIds } },
      }),
      prisma.chatSession.deleteMany({
        where: { id: { in: validIds } },
      }),
    ]);

    res.json({
      success: true,
      deleted: result[1].count,
      invalid: invalidCount,
      message: `成功删除 ${result[1].count} 个会话${invalidCount > 0 ? `，${invalidCount} 个无效` : ""}`,
    });
  } catch (error) {
    console.error("Batch delete sessions error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/chat/messages/batch-delete - 批量删除消息
router.post("/messages/batch-delete", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId: string }).userId;
    const { messageIds, sessionId } = req.body as {
      messageIds?: string[];
      sessionId?: string;
    };

    const prisma = getPrismaClient();

    // 按消息 ID 批量删除
    if (messageIds && Array.isArray(messageIds) && messageIds.length > 0) {
      if (messageIds.length > 500) {
        res.status(400).json({ error: "Cannot delete more than 500 messages at once" });
        return;
      }

      // 验证消息所属会话属于当前用户
      const messages = await prisma.chatMessage.findMany({
        where: { id: { in: messageIds } },
        select: { id: true, sessionId: true },
      });

      const sessionIds = [...new Set(messages.map(m => m.sessionId))];
      const validSessions = await prisma.chatSession.findMany({
        where: { id: { in: sessionIds }, userId },
        select: { id: true },
      });

      const validSessionIds = new Set(validSessions.map(s => s.id));
      const validMessageIds = messages
        .filter(m => validSessionIds.has(m.sessionId))
        .map(m => m.id);

      if (validMessageIds.length === 0) {
        res.status(404).json({ error: "No valid messages found" });
        return;
      }

      const result = await prisma.chatMessage.deleteMany({
        where: { id: { in: validMessageIds } },
      });

      res.json({
        success: true,
        deleted: result.count,
        invalid: messageIds.length - validMessageIds.length,
      });
      return;
    }

    // 按会话 ID 删除（清空会话消息）
    if (sessionId) {
      // 验证会话所有权
      const session = await prisma.chatSession.findFirst({
        where: { id: sessionId, userId },
      });

      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      const result = await prisma.chatMessage.deleteMany({
        where: { sessionId },
      });

      res.json({
        success: true,
        deleted: result.count,
        message: `已清空会话 ${result.count} 条消息`,
      });
      return;
    }

    res.status(400).json({ error: "messageIds or sessionId is required" });
  } catch (error) {
    console.error("Batch delete messages error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/chat/sessions/batch-update - 批量更新会话
router.post("/sessions/batch-update", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId: string }).userId;
    const { sessionIds, updates } = req.body as {
      sessionIds: string[];
      updates: {
        title?: string;
        platform?: string;
        modelId?: string;
      };
    };

    if (!sessionIds || !Array.isArray(sessionIds) || sessionIds.length === 0) {
      res.status(400).json({ error: "sessionIds is required and must be a non-empty array" });
      return;
    }

    if (sessionIds.length > 100) {
      res.status(400).json({ error: "Cannot update more than 100 sessions at once" });
      return;
    }

    const prisma = getPrismaClient();

    // 验证所有会话都属于当前用户
    const validSessions = await prisma.chatSession.findMany({
      where: { id: { in: sessionIds }, userId },
      select: { id: true },
    });

    const validIds = validSessions.map(s => s.id);

    if (validIds.length === 0) {
      res.status(404).json({ error: "No valid sessions found" });
      return;
    }

    // 批量更新
    const result = await prisma.chatSession.updateMany({
      where: { id: { in: validIds } },
      data: {
        ...updates,
        updatedAt: new Date(),
      },
    });

    res.json({
      success: true,
      updated: result.count,
      invalid: sessionIds.length - validIds.length,
    });
  } catch (error) {
    console.error("Batch update sessions error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/chat/messages/batch-update - 批量更新消息
router.post("/messages/batch-update", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId: string }).userId;
    const { messageIds, updates } = req.body as {
      messageIds: string[];
      updates: {
        content?: string;
        metadata?: string;
      };
    };

    if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
      res.status(400).json({ error: "messageIds is required and must be a non-empty array" });
      return;
    }

    if (messageIds.length > 500) {
      res.status(400).json({ error: "Cannot update more than 500 messages at once" });
      return;
    }

    const prisma = getPrismaClient();

    // 验证消息所属会话属于当前用户
    const messages = await prisma.chatMessage.findMany({
      where: { id: { in: messageIds } },
      select: { id: true, sessionId: true },
    });

    const sessionIds = [...new Set(messages.map(m => m.sessionId))];
    const validSessions = await prisma.chatSession.findMany({
      where: { id: { in: sessionIds }, userId },
      select: { id: true },
    });

    const validSessionIds = new Set(validSessions.map(s => s.id));
    const validMessageIds = messages
      .filter(m => validSessionIds.has(m.sessionId))
      .map(m => m.id);

    if (validMessageIds.length === 0) {
      res.status(404).json({ error: "No valid messages found" });
      return;
    }

    const result = await prisma.chatMessage.updateMany({
      where: { id: { in: validMessageIds } },
      data: updates,
    });

    res.json({
      success: true,
      updated: result.count,
      invalid: messageIds.length - validMessageIds.length,
    });
  } catch (error) {
    console.error("Batch update messages error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
