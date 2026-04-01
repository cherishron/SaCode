import { Router, type Response } from "express";
import { getPrismaClient } from "@SACODE/database";

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

const router = Router();

// Health check
router.get("/health", (_req, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// API info
router.get("/", (_req, res: Response) => {
  res.json({
    name: "SACODE API",
    version: "0.1.0",
    endpoints: ["/auth", "/chat", "/im", "/capabilities", "/plugins", "/tasks", "/routing", "/models", "/memory", "/im-chat", "/media", "/settings", "/notifications", "/stats"],
  });
});

// Stats endpoint for dashboard
router.get("/stats", async (_req, res: Response) => {
  try {
    const prisma = getPrismaClient();

    // 当前统计数据
    const [totalSessions, totalMessages, activeConnections, pluginsCount] = await Promise.all([
      prisma.chatSession.count(),
      prisma.chatMessage.count(),
      prisma.iMConnection.count({ where: { status: "connected" } }),
      prisma.plugin.count({ where: { enabled: true } }),
    ]);

    // 趋势计算：与上周对比
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

    // 计算趋势百分比
    const sessionsTrend = previousWeekSessions > 0
      ? Math.round(((lastWeekSessions - previousWeekSessions) / previousWeekSessions) * 100)
      : lastWeekSessions > 0 ? 100 : 0;

    const messagesTrend = previousWeekMessages > 0
      ? Math.round(((lastWeekMessages - previousWeekMessages) / previousWeekMessages) * 100)
      : lastWeekMessages > 0 ? 100 : 0;

    // 获取最近会话
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

    // 活动流：整合会话、连接、任务等活动记录
    const activities: Array<{
      id: string;
      type: "session" | "connection" | "task" | "message";
      title: string;
      description: string;
      timestamp: Date;
      icon: string;
    }> = [];

    // 会话活动
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

    // 连接活动
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

    // 任务活动
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

    // 按时间排序活动流
    activities.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // AI 服务状态（模拟）
    const aiStatus = {
      status: "online" as const,
      model: process.env.DEFAULT_MODEL || "GPT-4",
      latency: Math.floor(Math.random() * 100) + 50, // 模拟延迟
    };

    res.json({
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
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// Mount routes
router.use("/auth", authRoutes);
router.use("/chat", chatRoutes);
router.use("/im", imRoutes);
router.use("/capabilities", capabilitiesRoutes);
router.use("/plugins", pluginsRoutes);
router.use("/tasks", tasksRoutes);
router.use("/routing", routingRoutes);
router.use("/models", modelsRoutes);
router.use("/memory", memoryRoutes);
router.use("/im-chat", imChatRoutes);
router.use("/media", mediaRoutes);
router.use("/settings", settingsRoutes);
router.use("/notifications", notificationsRoutes);

export default router;
