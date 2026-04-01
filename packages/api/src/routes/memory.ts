/**
 * 会话记忆管理 API 路由
 *
 * 提供会话记忆的存储、检索和管理功能
 */

import { Router, type Request, type Response } from "express";
import { EnhancedMemoryManager, type MemoryEntry } from "@sacode/core";
import { getPrismaClient } from "@sacode/database";
import { authMiddleware } from "../middleware/auth";

const router = Router();

// 记忆管理器实例缓存
const memoryManagers = new Map<string, EnhancedMemoryManager>();

/**
 * 获取或创建会话的记忆管理器
 */
async function getMemoryManager(sessionId: string): Promise<EnhancedMemoryManager> {
  if (!memoryManagers.has(sessionId)) {
    const manager = new EnhancedMemoryManager({
      dbPath: `./data/memory/${sessionId}.db`,
      embeddingModel: process.env.OPENAI_API_KEY ? "text-embedding-3-small" : undefined,
    });
    await manager.initialize();
    memoryManagers.set(sessionId, manager);
  }
  return memoryManagers.get(sessionId)!;
}

/**
 * GET /api/memory/:sessionId
 * 获取会话记忆
 */
router.get("/:sessionId", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId: string }).userId;
    const { sessionId } = req.params;
    const prisma = getPrismaClient();

    // 验证会话所有权
    const session = await prisma.chatSession.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    // 返回会话中的记忆内容
    res.json({
      sessionId,
      memory: session.memory ?? "",
      context: session.context ? JSON.parse(session.context) : null,
      settings: session.settings ? JSON.parse(session.settings) : null,
    });
  } catch (error) {
    console.error("Get memory error:", error);
    res.status(500).json({ error: "Failed to get memory" });
  }
});

/**
 * PUT /api/memory/:sessionId
 * 更新会话记忆
 */
router.put("/:sessionId", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId: string }).userId;
    const { sessionId } = req.params;
    const { memory, context, settings } = req.body;
    const prisma = getPrismaClient();

    // 验证会话所有权
    const session = await prisma.chatSession.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    // 更新会话记忆
    const updated = await prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        ...(memory !== undefined && { memory }),
        ...(context !== undefined && { context: JSON.stringify(context) }),
        ...(settings !== undefined && { settings: JSON.stringify(settings) }),
        updatedAt: new Date(),
      },
    });

    res.json({
      success: true,
      sessionId,
      memory: updated.memory,
      context: updated.context ? JSON.parse(updated.context) : null,
      settings: updated.settings ? JSON.parse(updated.settings) : null,
    });
  } catch (error) {
    console.error("Update memory error:", error);
    res.status(500).json({ error: "Failed to update memory" });
  }
});

/**
 * GET /api/memory/:sessionId/search
 * 搜索会话记忆
 */
router.get("/:sessionId/search", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId: string }).userId;
    const { sessionId } = req.params;
    const { query, limit = 10 } = req.query;

    if (!query || typeof query !== "string") {
      res.status(400).json({ error: "Query is required" });
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

    // 使用增强记忆管理器进行向量搜索
    const manager = await getMemoryManager(sessionId);
    const results = await manager.search(query, Number(limit));

    res.json({
      query,
      results: results.map((r: MemoryEntry) => ({
        id: r.id,
        content: r.content,
        role: r.role,
        timestamp: r.timestamp,
        relevance: r.metadata?.relevance ?? 0,
      })),
    });
  } catch (error) {
    console.error("Search memory error:", error);
    res.status(500).json({ error: "Failed to search memory" });
  }
});

/**
 * POST /api/memory/:sessionId/entries
 * 添加记忆条目
 */
router.post("/:sessionId/entries", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId: string }).userId;
    const { sessionId } = req.params;
    const { content, role, metadata } = req.body;
    const prisma = getPrismaClient();

    // 验证会话所有权
    const session = await prisma.chatSession.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    // 使用增强记忆管理器添加记忆
    const manager = await getMemoryManager(sessionId);
    const entry = await manager.addEntry(content, role, metadata);

    res.status(201).json({
      success: true,
      entry: {
        id: entry.id,
        content: entry.content,
        role: entry.role,
        timestamp: entry.timestamp,
      },
    });
  } catch (error) {
    console.error("Add memory entry error:", error);
    res.status(500).json({ error: "Failed to add memory entry" });
  }
});

/**
 * GET /api/memory/:sessionId/context
 * 获取上下文摘要
 */
router.get("/:sessionId/context", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId: string }).userId;
    const { sessionId } = req.params;
    const prisma = getPrismaClient();

    // 验证会话所有权
    const session = await prisma.chatSession.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    // 使用增强记忆管理器获取上下文
    const manager = await getMemoryManager(sessionId);
    const context = await manager.getContext();

    res.json({
      sessionId,
      context,
      memory: session.memory,
    });
  } catch (error) {
    console.error("Get context error:", error);
    res.status(500).json({ error: "Failed to get context" });
  }
});

/**
 * POST /api/memory/:sessionId/compact
 * 压缩记忆
 */
router.post("/:sessionId/compact", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId: string }).userId;
    const { sessionId } = req.params;
    const prisma = getPrismaClient();

    // 验证会话所有权
    const session = await prisma.chatSession.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    // 使用增强记忆管理器压缩记忆
    const manager = await getMemoryManager(sessionId);
    await manager.compact();

    // 更新会话中的记忆内容
    const context = await manager.getContext();
    await prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        memory: context,
        updatedAt: new Date(),
      },
    });

    res.json({
      success: true,
      message: "Memory compacted successfully",
    });
  } catch (error) {
    console.error("Compact memory error:", error);
    res.status(500).json({ error: "Failed to compact memory" });
  }
});

/**
 * DELETE /api/memory/:sessionId/entries/:entryId
 * 删除记忆条目
 */
router.delete(
  "/:sessionId/entries/:entryId",
  authMiddleware,
  async (req: Request, res: Response) => {
    try {
      const userId = (req as Request & { userId: string }).userId;
      const { sessionId, entryId } = req.params;
      const prisma = getPrismaClient();

      // 验证会话所有权
      const session = await prisma.chatSession.findFirst({
        where: { id: sessionId, userId },
      });

      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      // 使用增强记忆管理器删除条目
      const manager = await getMemoryManager(sessionId);
      const deleted = await manager.deleteEntry(entryId);

      if (!deleted) {
        res.status(404).json({ error: "Entry not found" });
        return;
      }

      res.status(204).send();
    } catch (error) {
      console.error("Delete memory entry error:", error);
      res.status(500).json({ error: "Failed to delete memory entry" });
    }
  }
);

/**
 * POST /api/memory/:sessionId/export
 * 导出会话记忆
 */
router.post("/:sessionId/export", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId: string }).userId;
    const { sessionId } = req.params;
    const prisma = getPrismaClient();

    // 验证会话所有权
    const session = await prisma.chatSession.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    // 使用增强记忆管理器导出
    const manager = await getMemoryManager(sessionId);
    const exported = await manager.export();

    res.json({
      sessionId,
      exported,
      memory: session.memory,
      context: session.context,
      settings: session.settings,
    });
  } catch (error) {
    console.error("Export memory error:", error);
    res.status(500).json({ error: "Failed to export memory" });
  }
});

/**
 * POST /api/memory/:sessionId/import
 * 导入会话记忆
 */
router.post("/:sessionId/import", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId: string }).userId;
    const { sessionId } = req.params;
    const { entries } = req.body;
    const prisma = getPrismaClient();

    // 验证会话所有权
    const session = await prisma.chatSession.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    // 使用增强记忆管理器导入
    const manager = await getMemoryManager(sessionId);
    await manager.import(entries);

    res.json({
      success: true,
      message: `Imported ${entries.length} entries`,
    });
  } catch (error) {
    console.error("Import memory error:", error);
    res.status(500).json({ error: "Failed to import memory" });
  }
});

export default router;
