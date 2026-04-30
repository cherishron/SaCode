import { Hono } from "hono";
import { getPrismaClient } from "@sacode/database";

import authRoutes from "./auth";
import chatRoutes from "./chat";
import imRoutes from "./im";
import capabilitiesRoutes from "./capabilities";
import pluginsRoutes from "./plugins";
import tasksRoutes from "./tasks";
import routingRoutes from "./routing";
import modelsRoutes from "./models";
import memoryRoutes from "./memory";
import imChatRoutes from "./im-chat";
import mediaRoutes from "./media";
import settingsRoutes from "./settings";
import notificationsRoutes from "./notifications";
import containersRoutes from "./containers";

type Variables = {
  userId: string;
};

const router = new Hono<{ Variables: Variables }>();

// Health check
router.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// API info
router.get("/", (c) => {
  return c.json({
    name: "SACODE API",
    version: "0.1.0",
    endpoints: ["/auth", "/chat", "/im", "/capabilities", "/plugins", "/tasks", "/routing", "/models", "/memory", "/im-chat", "/media", "/settings", "/notifications", "/stats"],
  });
});

// Stats endpoint for dashboard
router.get("/stats", async (c) => {
  try {
    const prisma = getPrismaClient();

    const [totalSessions, totalMessages, activeConnections, pluginsCount] = await Promise.all([
      prisma.chatSession.count(),
      prisma.chatMessage.count(),
      prisma.iMConnection.count({ where: { status: "connected" } }),
      prisma.plugin.count({ where: { enabled: true } }),
    ]);

    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    const [
      lastWeekSessions,
      previousWeekSessions,
      lastWeekMessages,
      previousWeekMessages,
    ] = await Promise.all([
      prisma.chatSession.count({ where: { createdAt: { gte: oneWeekAgo } } }),
      prisma.chatSession.count({ where: { createdAt: { gte: twoWeeksAgo, lt: oneWeekAgo } } }),
      prisma.chatMessage.count({ where: { createdAt: { gte: oneWeekAgo } } }),
      prisma.chatMessage.count({ where: { createdAt: { gte: twoWeeksAgo, lt: oneWeekAgo } } }),
    ]);

    const sessionsTrend = previousWeekSessions > 0
      ? Math.round(((lastWeekSessions - previousWeekSessions) / previousWeekSessions) * 100)
      : lastWeekSessions > 0 ? 100 : 0;

    const messagesTrend = previousWeekMessages > 0
      ? Math.round(((lastWeekMessages - previousWeekMessages) / previousWeekMessages) * 100)
      : lastWeekMessages > 0 ? 100 : 0;

    const recentSessions = await prisma.chatSession.findMany({
      take: 5,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        platform: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { messages: true },
        },
      },
    });

    const activities: Array<{
      id: string;
      type: "session" | "connection" | "task" | "message";
      title: string;
      description: string;
      timestamp: Date;
      icon: string;
    }> = [];

    const sessionActivities = await prisma.chatSession.findMany({
      take: 3,
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, updatedAt: true, platform: true },
    });

    for (const session of sessionActivities) {
      activities.push({
        id: `session-${session.id}`,
        type: "session",
        title: session.title || "新对话",
        description: session.platform ? `在 ${session.platform} 平台` : "Web 端对话",
        timestamp: session.updatedAt,
        icon: "chat",
      });
    }

    const connectionActivities = await prisma.iMConnection.findMany({
      take: 3,
      orderBy: { updatedAt: "desc" },
      select: { id: true, platform: true, name: true, status: true, updatedAt: true },
    });

    for (const conn of connectionActivities) {
      activities.push({
        id: `connection-${conn.id}`,
        type: "connection",
        title: conn.name || conn.platform,
        description: conn.status === "connected" ? "已连接" : "已断开",
        timestamp: conn.updatedAt,
        icon: "link",
      });
    }

    const taskActivities = await prisma.cronTask.findMany({
      take: 3,
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, enabled: true, lastRunAt: true, updatedAt: true },
    });

    for (const task of taskActivities) {
      activities.push({
        id: `task-${task.id}`,
        type: "task",
        title: task.name,
        description: task.enabled ? "定时任务运行中" : "定时任务已暂停",
        timestamp: task.lastRunAt || task.updatedAt,
        icon: "time",
      });
    }

    activities.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    const aiStatus = {
      status: "online" as const,
      model: process.env.DEFAULT_MODEL || "GPT-4",
      latency: Math.floor(Math.random() * 100) + 50,
    };

    return c.json({
      totalSessions,
      totalMessages,
      activeConnections,
      pluginsCount,
      trends: {
        sessions: {
          value: sessionsTrend,
          direction: sessionsTrend >= 0 ? "up" as const : "down" as const,
          lastWeek: lastWeekSessions,
          previousWeek: previousWeekSessions,
        },
        messages: {
          value: messagesTrend,
          direction: messagesTrend >= 0 ? "up" as const : "down" as const,
          lastWeek: lastWeekMessages,
          previousWeek: previousWeekMessages,
        },
      },
      recentSessions: recentSessions.map((s) => ({
        id: s.id,
        title: s.title,
        platform: s.platform,
        messageCount: s._count.messages,
        updatedAt: s.updatedAt.toISOString(),
      })),
      activities: activities.slice(0, 10).map((a) => ({
        ...a,
        timestamp: a.timestamp.toISOString(),
      })),
      aiStatus,
    });
  } catch (error) {
    console.error("Stats error:", error);
    return c.json({ error: "Failed to fetch stats" }, 500);
  }
});

// 挂载子路由
router.route("/auth", authRoutes);
router.route("/chat", chatRoutes);
router.route("/im", imRoutes);
router.route("/capabilities", capabilitiesRoutes);
router.route("/plugins", pluginsRoutes);
router.route("/tasks", tasksRoutes);
router.route("/routing", routingRoutes);
router.route("/models", modelsRoutes);
router.route("/memory", memoryRoutes);
router.route("/im-chat", imChatRoutes);
router.route("/media", mediaRoutes);
router.route("/settings", settingsRoutes);
router.route("/notifications", notificationsRoutes);
router.route("/containers", containersRoutes);

export default router;
