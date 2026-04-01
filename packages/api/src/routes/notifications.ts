/**
 * 通知系统 API 路由
 *
 * 提供用户通知的 CRUD、已读标记、实时推送等功能
 */

import { Router, type Request, type Response } from "express";
import { getPrismaClient } from "@sacode/database";
import { wsEvents } from "../websocket/index.js";
import { authMiddleware } from "../middleware/auth";

const router = Router();

// 通知类型定义
export type NotificationType =
  | "system" // 系统通知
  | "task_complete" // 任务完成
  | "task_failed" // 任务失败
  | "message" // 消息通知
  | "im_status" // IM 状态变更
  | "warning" // 警告
  | "info"; // 信息

// 通知优先级
export type NotificationPriority = "low" | "normal" | "high" | "urgent";

// 内存存储通知（简单实现，生产环境应使用数据库）
interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  read: boolean;
  createdAt: Date;
  expiresAt?: Date;
}

// 通知存储（按用户分组）
const notificationStore = new Map<string, Notification[]>();

// 通知计数器
let notificationIdCounter = 0;

/**
 * 创建通知
 */
function createNotification(
  userId: string,
  type: NotificationType,
  title: string,
  message: string,
  options?: {
    priority?: NotificationPriority;
    data?: Record<string, unknown>;
    expiresAt?: Date;
  }
): Notification {
  const notification: Notification = {
    id: `notif-${++notificationIdCounter}`,
    userId,
    type,
    priority: options?.priority || "normal",
    title,
    message,
    data: options?.data,
    read: false,
    createdAt: new Date(),
    expiresAt: options?.expiresAt,
  };

  // 存储通知
  const userNotifications = notificationStore.get(userId) || [];
  userNotifications.unshift(notification);

  // 限制每个用户最多 100 条通知
  if (userNotifications.length > 100) {
    userNotifications.splice(100);
  }

  notificationStore.set(userId, userNotifications);

  // 通过 WebSocket 推送
  wsEvents.emit("notification:created", {
    userId,
    notification,
  });

  return notification;
}

/**
 * 批量创建通知（给所有用户或特定用户组）
 */
function broadcastNotification(
  type: NotificationType,
  title: string,
  message: string,
  options?: {
    priority?: NotificationPriority;
    data?: Record<string, unknown>;
    userIds?: string[];
  }
): void {
  const userIds = options?.userIds || Array.from(notificationStore.keys());

  for (const userId of userIds) {
    createNotification(userId, type, title, message, options);
  }
}

/**
 * GET /api/notifications
 * 获取用户通知列表
 */
router.get("/", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { userId: string }).userId;
    const { unreadOnly, type, limit = 20, offset = 0 } = req.query;

    let notifications = notificationStore.get(userId) || [];

    // 过滤已过期通知
    const now = new Date();
    notifications = notifications.filter(
      (n) => !n.expiresAt || n.expiresAt > now
    );

    // 只看未读
    if (unreadOnly === "true") {
      notifications = notifications.filter((n) => !n.read);
    }

    // 按类型过滤
    if (type && typeof type === "string") {
      notifications = notifications.filter((n) => n.type === type);
    }

    // 分页
    const total = notifications.length;
    const paginatedNotifications = notifications.slice(
      parseInt(offset as string, 10),
      parseInt(offset as string, 10) + parseInt(limit as string, 10)
    );

    // 统计
    const allNotifications = notificationStore.get(userId) || [];
    const unreadCount = allNotifications.filter((n) => !n.read).length;

    res.json({
      notifications: paginatedNotifications.map((n) => ({
        ...n,
        createdAt: n.createdAt.toISOString(),
        expiresAt: n.expiresAt?.toISOString(),
      })),
      total,
      unreadCount,
    });
  } catch (error) {
    console.error("Get notifications error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/notifications/unread-count
 * 获取未读通知数量
 */
router.get("/unread-count", authMiddleware, (req: Request, res: Response) => {
  const userId = (req as Request & { userId: string }).userId;
  const notifications = notificationStore.get(userId) || [];
  const unreadCount = notifications.filter((n) => !n.read).length;

  res.json({ unreadCount });
});

/**
 * POST /api/notifications/:id/read
 * 标记单条通知为已读
 */
router.post("/:id/read", authMiddleware, (req: Request, res: Response) => {
  const userId = (req as Request & { userId: string }).userId;
  const { id } = req.params;

  const notifications = notificationStore.get(userId) || [];
  const notification = notifications.find((n) => n.id === id);

  if (!notification) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }

  notification.read = true;

  res.json({ success: true, notification });
});

/**
 * POST /api/notifications/read-all
 * 标记所有通知为已读
 */
router.post("/read-all", authMiddleware, (req: Request, res: Response) => {
  const userId = (req as Request & { userId: string }).userId;
  const { type } = req.body as { type?: NotificationType };

  const notifications = notificationStore.get(userId) || [];
  let count = 0;

  for (const notification of notifications) {
    if (!type || notification.type === type) {
      notification.read = true;
      count++;
    }
  }

  res.json({ success: true, markedRead: count });
});

/**
 * DELETE /api/notifications/:id
 * 删除单条通知
 */
router.delete("/:id", authMiddleware, (req: Request, res: Response) => {
  const userId = (req as Request & { userId: string }).userId;
  const { id } = req.params;

  const notifications = notificationStore.get(userId) || [];
  const index = notifications.findIndex((n) => n.id === id);

  if (index === -1) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }

  notifications.splice(index, 1);
  notificationStore.set(userId, notifications);

  res.status(204).send();
});

/**
 * DELETE /api/notifications/clear
 * 清除所有通知（可按类型）
 */
router.delete("/clear", authMiddleware, (req: Request, res: Response) => {
  const userId = (req as Request & { userId: string }).userId;
  const { type, readOnly } = req.query;

  let notifications = notificationStore.get(userId) || [];

  if (type && typeof type === "string") {
    // 只清除特定类型
    notifications = notifications.filter((n) => n.type !== type);
  } else if (readOnly === "true") {
    // 只清除已读
    notifications = notifications.filter((n) => !n.read);
  } else {
    // 清除全部
    notifications = [];
  }

  notificationStore.set(userId, notifications);

  res.json({ success: true });
});

/**
 * POST /api/notifications/create
 * 创建通知（内部使用）
 */
router.post("/create", authMiddleware, (req: Request, res: Response) => {
  const userId = (req as Request & { userId: string }).userId;
  const { type, title, message, priority, data, expiresAt } = req.body as {
    type: NotificationType;
    title: string;
    message: string;
    priority?: NotificationPriority;
    data?: Record<string, unknown>;
    expiresAt?: string;
  };

  if (!type || !title || !message) {
    res.status(400).json({ error: "type, title, and message are required" });
    return;
  }

  const notification = createNotification(userId, type, title, message, {
    priority,
    data,
    expiresAt: expiresAt ? new Date(expiresAt) : undefined,
  });

  res.status(201).json(notification);
});

/**
 * POST /api/notifications/broadcast
 * 广播通知（管理员使用）
 */
router.post(
  "/broadcast",
  authMiddleware,
  (req: Request, res: Response) => {
    const { type, title, message, priority, data, userIds } = req.body as {
      type: NotificationType;
      title: string;
      message: string;
      priority?: NotificationPriority;
      data?: Record<string, unknown>;
      userIds?: string[];
    };

    if (!type || !title || !message) {
      res.status(400).json({ error: "type, title, and message are required" });
      return;
    }

    broadcastNotification(type, title, message, {
      priority,
      data,
      userIds,
    });

    res.json({
      success: true,
      message: `Notification broadcasted to ${userIds?.length || "all"} users`,
    });
  }
);

// 导出通知创建函数供其他模块使用
export { createNotification, broadcastNotification };
export default router;
