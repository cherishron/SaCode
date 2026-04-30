import { Hono } from "hono";
import { SACODEClient } from "@sacode/core";
import { getPrismaClient } from "@sacode/database";
import { authMiddleware } from "../middleware/auth";

type Variables = {
  userId: string;
};

const router = new Hono<{ Variables: Variables }>();

const activeClients = new Map<string, SACODEClient>();

// POST /api/chat
router.post("/", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const { message, sessionId } = await c.req.json();

    if (!message) {
      return c.json({ error: "Message is required" }, 400);
    }

    let client = activeClients.get(userId);
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
        debug: process.env.NODE_ENV === "development",
      });
      await client.connect();
      activeClients.set(userId, client);
    }

    const responses: unknown[] = [];

    for await (const msg of client.chat(message, sessionId)) {
      responses.push(msg);
    }

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

    return c.json({ success: true, responses });
  } catch (error) {
    console.error("Chat error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /api/chat/agentic
router.post("/agentic", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const { message, sessionId, enablePlanning } = await c.req.json();

    if (!message) {
      return c.json({ error: "Message is required" }, 400);
    }

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

    const responses: unknown[] = [];
    const events: Array<{ type: string; data: unknown }> = [];

    for await (const msg of client.agenticChat(message, sessionId)) {
      if ("type" in msg && typeof msg.type === "string") {
        events.push({ type: msg.type, data: msg });
        responses.push(msg);
      } else {
        responses.push(msg);
      }
    }

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

    return c.json({ success: true, responses, events });
  } catch (error) {
    console.error("Agentic chat error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /api/chat/sessions
router.get("/sessions", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const prisma = getPrismaClient();

    const sessions = await prisma.chatSession.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 50,
    });

    return c.json(sessions);
  } catch (error) {
    console.error("Get sessions error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /api/chat/sessions/:id/messages
router.get("/sessions/:id/messages", authMiddleware, async (c) => {
  try {
    const { id } = c.req.param();
    const prisma = getPrismaClient();

    const messages = await prisma.chatMessage.findMany({
      where: { sessionId: id },
      orderBy: { createdAt: "asc" },
    });

    return c.json(messages);
  } catch (error) {
    console.error("Get messages error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /api/chat/sessions
router.post("/sessions", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const { title, channelId, platform } = await c.req.json();

    const prisma = getPrismaClient();
    const session = await prisma.chatSession.create({
      data: {
        userId,
        title,
        channelId,
        platform,
      },
    });

    return c.json(session, 201);
  } catch (error) {
    console.error("Create session error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /api/chat/sessions/:id
router.get("/sessions/:id", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const { id } = c.req.param();
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
      return c.json({ error: "Session not found" }, 404);
    }

    return c.json(session);
  } catch (error) {
    console.error("Get session error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// PATCH /api/chat/sessions/:id
router.patch("/sessions/:id", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const { id } = c.req.param();
    const { title, channelId, platform } = await c.req.json();
    const prisma = getPrismaClient();

    const existingSession = await prisma.chatSession.findFirst({
      where: { id, userId },
    });

    if (!existingSession) {
      return c.json({ error: "Session not found" }, 404);
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

    return c.json(session);
  } catch (error) {
    console.error("Update session error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// DELETE /api/chat/sessions/:id
router.delete("/sessions/:id", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const { id } = c.req.param();
    const prisma = getPrismaClient();

    const existingSession = await prisma.chatSession.findFirst({
      where: { id, userId },
    });

    if (!existingSession) {
      return c.json({ error: "Session not found" }, 404);
    }

    await prisma.$transaction([
      prisma.chatMessage.deleteMany({ where: { sessionId: id } }),
      prisma.chatSession.delete({ where: { id } }),
    ]);

    return c.body(null, 204);
  } catch (error) {
    console.error("Delete session error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /api/chat/search
router.get("/search", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const q = c.req.query("q");
    const sessionId = c.req.query("sessionId");
    const role = c.req.query("role");
    const startDate = c.req.query("startDate");
    const endDate = c.req.query("endDate");
    const limit = parseInt(c.req.query("limit") || "50", 10);
    const offset = parseInt(c.req.query("offset") || "0", 10);
    const highlight = c.req.query("highlight") === "true";
    const facets = c.req.query("facets") === "true";

    if (!q || q.trim().length === 0) {
      return c.json({ error: "Search query is required" }, 400);
    }

    const prisma = getPrismaClient();
    const searchQuery = q.trim();

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

    if (sessionId) {
      where.sessionId = sessionId;
    }

    if (role && (role === "user" || role === "assistant")) {
      where.role = role;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        where.createdAt.lte = new Date(endDate);
      }
    }

    const messages = await prisma.chatMessage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 100),
      skip: offset,
      include: {
        session: {
          select: {
            id: true,
            title: true,
          },
        },
      },
    });

    const total = await prisma.chatMessage.count({ where });

    function highlightText(text: string, query: string): string {
      if (!query) return text;
      const regex = new RegExp(
        `(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
        "gi"
      );
      return text.replace(regex, "<mark>$1</mark>");
    }

    const processedMessages = highlight
      ? messages.map((msg) => ({
          ...msg,
          contentHighlighted: highlightText(msg.content, searchQuery),
        }))
      : messages;

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

    if (facets) {
      const byRole = await prisma.chatMessage.groupBy({
        by: ["role"],
        where,
        _count: { id: true },
      });

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

    return c.json(response);
  } catch (error) {
    console.error("Search messages error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /api/chat/search/suggestions
router.get("/search/suggestions", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const q = c.req.query("q");
    const limit = parseInt(c.req.query("limit") || "5", 10);

    if (!q || q.trim().length < 2) {
      return c.json({ suggestions: [] });
    }

    const prisma = getPrismaClient();
    const searchQuery = q.trim();

    const sessions = await prisma.chatSession.findMany({
      where: {
        userId,
        title: { contains: searchQuery },
      },
      select: { id: true, title: true },
      take: limit,
    });

    const messages = await prisma.chatMessage.findMany({
      where: {
        content: { contains: searchQuery },
        session: { userId },
      },
      select: { content: true },
      take: limit,
    });

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

    return c.json({ suggestions: suggestions.slice(0, limit * 2) });
  } catch (error) {
    console.error("Search suggestions error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /api/chat/sessions/batch-delete
router.post("/sessions/batch-delete", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const { sessionIds } = await c.req.json() as { sessionIds: string[] };

    if (!sessionIds || !Array.isArray(sessionIds) || sessionIds.length === 0) {
      return c.json({ error: "sessionIds is required and must be a non-empty array" }, 400);
    }

    if (sessionIds.length > 100) {
      return c.json({ error: "Cannot delete more than 100 sessions at once" }, 400);
    }

    const prisma = getPrismaClient();

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
      return c.json({ error: "No valid sessions found" }, 404);
    }

    const result = await prisma.$transaction([
      prisma.chatMessage.deleteMany({
        where: { sessionId: { in: validIds } },
      }),
      prisma.chatSession.deleteMany({
        where: { id: { in: validIds } },
      }),
    ]);

    return c.json({
      success: true,
      deleted: result[1].count,
      invalid: invalidCount,
      message: `成功删除 ${result[1].count} 个会话${invalidCount > 0 ? `，${invalidCount} 个无效` : ""}`,
    });
  } catch (error) {
    console.error("Batch delete sessions error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /api/chat/messages/batch-delete
router.post("/messages/batch-delete", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const { messageIds, sessionId } = await c.req.json() as {
      messageIds?: string[];
      sessionId?: string;
    };

    const prisma = getPrismaClient();

    if (messageIds && Array.isArray(messageIds) && messageIds.length > 0) {
      if (messageIds.length > 500) {
        return c.json({ error: "Cannot delete more than 500 messages at once" }, 400);
      }

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
        return c.json({ error: "No valid messages found" }, 404);
      }

      const result = await prisma.chatMessage.deleteMany({
        where: { id: { in: validMessageIds } },
      });

      return c.json({
        success: true,
        deleted: result.count,
        invalid: messageIds.length - validMessageIds.length,
      });
    }

    if (sessionId) {
      const session = await prisma.chatSession.findFirst({
        where: { id: sessionId, userId },
      });

      if (!session) {
        return c.json({ error: "Session not found" }, 404);
      }

      const result = await prisma.chatMessage.deleteMany({
        where: { sessionId },
      });

      return c.json({
        success: true,
        deleted: result.count,
        message: `已清空会话 ${result.count} 条消息`,
      });
    }

    return c.json({ error: "messageIds or sessionId is required" }, 400);
  } catch (error) {
    console.error("Batch delete messages error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /api/chat/sessions/batch-update
router.post("/sessions/batch-update", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const { sessionIds, updates } = await c.req.json() as {
      sessionIds: string[];
      updates: {
        title?: string;
        platform?: string;
        modelId?: string;
      };
    };

    if (!sessionIds || !Array.isArray(sessionIds) || sessionIds.length === 0) {
      return c.json({ error: "sessionIds is required and must be a non-empty array" }, 400);
    }

    if (sessionIds.length > 100) {
      return c.json({ error: "Cannot update more than 100 sessions at once" }, 400);
    }

    const prisma = getPrismaClient();

    const validSessions = await prisma.chatSession.findMany({
      where: { id: { in: sessionIds }, userId },
      select: { id: true },
    });

    const validIds = validSessions.map(s => s.id);

    if (validIds.length === 0) {
      return c.json({ error: "No valid sessions found" }, 404);
    }

    const result = await prisma.chatSession.updateMany({
      where: { id: { in: validIds } },
      data: {
        ...updates,
        updatedAt: new Date(),
      },
    });

    return c.json({
      success: true,
      updated: result.count,
      invalid: sessionIds.length - validIds.length,
    });
  } catch (error) {
    console.error("Batch update sessions error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /api/chat/messages/batch-update
router.post("/messages/batch-update", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const { messageIds, updates } = await c.req.json() as {
      messageIds: string[];
      updates: {
        content?: string;
        metadata?: string;
      };
    };

    if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
      return c.json({ error: "messageIds is required and must be a non-empty array" }, 400);
    }

    if (messageIds.length > 500) {
      return c.json({ error: "Cannot update more than 500 messages at once" }, 400);
    }

    const prisma = getPrismaClient();

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
      return c.json({ error: "No valid messages found" }, 404);
    }

    const result = await prisma.chatMessage.updateMany({
      where: { id: { in: validMessageIds } },
      data: updates,
    });

    return c.json({
      success: true,
      updated: result.count,
      invalid: messageIds.length - validMessageIds.length,
    });
  } catch (error) {
    console.error("Batch update messages error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

export default router;
