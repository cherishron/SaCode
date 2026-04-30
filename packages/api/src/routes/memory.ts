import { Hono } from "hono";
import { EnhancedMemoryManager, type MemoryEntry } from "@sacode/core";
import { getPrismaClient } from "@sacode/database";
import { authMiddleware } from "../middleware/auth";

type Variables = {
  userId: string;
};

const router = new Hono<{ Variables: Variables }>();

const memoryManagers = new Map<string, EnhancedMemoryManager>();

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

// GET /api/memory/:sessionId
router.get("/:sessionId", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const sessionId = c.req.param("sessionId");
    const prisma = getPrismaClient();

    const session = await prisma.chatSession.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    return c.json({
      sessionId,
      memory: session.memory ?? "",
      context: session.context ? JSON.parse(session.context) : null,
      settings: session.settings ? JSON.parse(session.settings) : null,
    });
  } catch (error) {
    console.error("Get memory error:", error);
    return c.json({ error: "Failed to get memory" }, 500);
  }
});

// PUT /api/memory/:sessionId
router.put("/:sessionId", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const sessionId = c.req.param("sessionId");
    const { memory, context, settings } = await c.req.json();
    const prisma = getPrismaClient();

    const session = await prisma.chatSession.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    const updated = await prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        ...(memory !== undefined && { memory }),
        ...(context !== undefined && { context: JSON.stringify(context) }),
        ...(settings !== undefined && { settings: JSON.stringify(settings) }),
        updatedAt: new Date(),
      },
    });

    return c.json({
      success: true,
      sessionId,
      memory: updated.memory,
      context: updated.context ? JSON.parse(updated.context) : null,
      settings: updated.settings ? JSON.parse(updated.settings) : null,
    });
  } catch (error) {
    console.error("Update memory error:", error);
    return c.json({ error: "Failed to update memory" }, 500);
  }
});

// GET /api/memory/:sessionId/search
router.get("/:sessionId/search", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const sessionId = c.req.param("sessionId");
    const query = c.req.query("query");
    const limit = c.req.query("limit") || "10";

    if (!query || typeof query !== "string") {
      return c.json({ error: "Query is required" }, 400);
    }

    const prisma = getPrismaClient();

    const session = await prisma.chatSession.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    const manager = await getMemoryManager(sessionId);
    const results = await manager.search(query, Number(limit));

    return c.json({
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
    return c.json({ error: "Failed to search memory" }, 500);
  }
});

// POST /api/memory/:sessionId/entries
router.post("/:sessionId/entries", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const sessionId = c.req.param("sessionId");
    const { content, role, metadata } = await c.req.json();
    const prisma = getPrismaClient();

    const session = await prisma.chatSession.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    const manager = await getMemoryManager(sessionId);
    const entry = await manager.addEntry(content, role, metadata);

    return c.json({
      success: true,
      entry: {
        id: entry.id,
        content: entry.content,
        role: entry.role,
        timestamp: entry.timestamp,
      },
    }, 201);
  } catch (error) {
    console.error("Add memory entry error:", error);
    return c.json({ error: "Failed to add memory entry" }, 500);
  }
});

// GET /api/memory/:sessionId/context
router.get("/:sessionId/context", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const sessionId = c.req.param("sessionId");
    const prisma = getPrismaClient();

    const session = await prisma.chatSession.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    const manager = await getMemoryManager(sessionId);
    const context = await manager.getContext();

    return c.json({
      sessionId,
      context,
      memory: session.memory,
    });
  } catch (error) {
    console.error("Get context error:", error);
    return c.json({ error: "Failed to get context" }, 500);
  }
});

// POST /api/memory/:sessionId/compact
router.post("/:sessionId/compact", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const sessionId = c.req.param("sessionId");
    const prisma = getPrismaClient();

    const session = await prisma.chatSession.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    const manager = await getMemoryManager(sessionId);
    await manager.compact();

    const context = await manager.getContext();
    await prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        memory: context,
        updatedAt: new Date(),
      },
    });

    return c.json({
      success: true,
      message: "Memory compacted successfully",
    });
  } catch (error) {
    console.error("Compact memory error:", error);
    return c.json({ error: "Failed to compact memory" }, 500);
  }
});

// DELETE /api/memory/:sessionId/entries/:entryId
router.delete("/:sessionId/entries/:entryId", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const sessionId = c.req.param("sessionId");
    const entryId = c.req.param("entryId");
    const prisma = getPrismaClient();

    const session = await prisma.chatSession.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    const manager = await getMemoryManager(sessionId);
    const deleted = await manager.deleteEntry(entryId);

    if (!deleted) {
      return c.json({ error: "Entry not found" }, 404);
    }

    return c.body(null, 204);
  } catch (error) {
    console.error("Delete memory entry error:", error);
    return c.json({ error: "Failed to delete memory entry" }, 500);
  }
});

// POST /api/memory/:sessionId/export
router.post("/:sessionId/export", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const sessionId = c.req.param("sessionId");
    const prisma = getPrismaClient();

    const session = await prisma.chatSession.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    const manager = await getMemoryManager(sessionId);
    const exported = await manager.export();

    return c.json({
      sessionId,
      exported,
      memory: session.memory,
      context: session.context,
      settings: session.settings,
    });
  } catch (error) {
    console.error("Export memory error:", error);
    return c.json({ error: "Failed to export memory" }, 500);
  }
});

// POST /api/memory/:sessionId/import
router.post("/:sessionId/import", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const sessionId = c.req.param("sessionId");
    const { entries } = await c.req.json();
    const prisma = getPrismaClient();

    const session = await prisma.chatSession.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    const manager = await getMemoryManager(sessionId);
    await manager.import(entries);

    return c.json({
      success: true,
      message: `Imported ${entries.length} entries`,
    });
  } catch (error) {
    console.error("Import memory error:", error);
    return c.json({ error: "Failed to import memory" }, 500);
  }
});

export default router;
