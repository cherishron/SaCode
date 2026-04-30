import { Hono } from "hono";
import { getPrismaClient } from "@sacode/database";
import { wsEvents } from "../websocket/index.js";
import { authMiddleware } from "../middleware/auth";

type Variables = {
  userId: string;
};

const router = new Hono<{ Variables: Variables }>();

export type NotificationType =
  | "system"
  | "task_complete"
  | "task_failed"
  | "message"
  | "im_status"
  | "warning"
  | "info";

export type NotificationPriority = "low" | "normal" | "high" | "urgent";

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

const notificationStore = new Map<string, Notification[]>();
let notificationIdCounter = 0;

function createNotification(
  userId: string,
  type: NotificationType,
  title: string,
  message: string,
  options?: {
    priority?: NotificationPriority;
    data?: Record<string, unknown>;
    expiresAt?: Date;
  },
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

  const userNotifications = notificationStore.get(userId) || [];
  userNotifications.unshift(notification);

  if (userNotifications.length > 100) {
    userNotifications.splice(100);
  }

  notificationStore.set(userId, userNotifications);

  wsEvents.emit("notification:created", {
    userId,
    notification,
  });

  return notification;
}

function broadcastNotification(
  type: NotificationType,
  title: string,
  message: string,
  options?: {
    priority?: NotificationPriority;
    data?: Record<string, unknown>;
    userIds?: string[];
  },
): void {
  const userIds = options?.userIds || Array.from(notificationStore.keys());

  for (const userId of userIds) {
    createNotification(userId, type, title, message, options);
  }
}

// GET /api/notifications
router.get("/", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const unreadOnly = c.req.query("unreadOnly");
    const type = c.req.query("type");
    const limit = parseInt(c.req.query("limit") || "20", 10);
    const offset = parseInt(c.req.query("offset") || "0", 10);

    let notifications = notificationStore.get(userId) || [];

    const now = new Date();
    notifications = notifications.filter(
      (n) => !n.expiresAt || n.expiresAt > now,
    );

    if (unreadOnly === "true") {
      notifications = notifications.filter((n) => !n.read);
    }

    if (type && typeof type === "string") {
      notifications = notifications.filter((n) => n.type === type);
    }

    const total = notifications.length;
    const paginatedNotifications = notifications.slice(offset, offset + limit);

    const allNotifications = notificationStore.get(userId) || [];
    const unreadCount = allNotifications.filter((n) => !n.read).length;

    return c.json({
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
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /api/notifications/unread-count
router.get("/unread-count", authMiddleware, (c) => {
  const userId = c.get("userId");
  const notifications = notificationStore.get(userId) || [];
  const unreadCount = notifications.filter((n) => !n.read).length;

  return c.json({ unreadCount });
});

// POST /api/notifications/:id/read
router.post("/:id/read", authMiddleware, (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const notifications = notificationStore.get(userId) || [];
  const notification = notifications.find((n) => n.id === id);

  if (!notification) {
    return c.json({ error: "Notification not found" }, 404);
  }

  notification.read = true;

  return c.json({ success: true, notification });
});

// POST /api/notifications/read-all
router.post("/read-all", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const { type } = await c.req.json() as { type?: NotificationType };

  const notifications = notificationStore.get(userId) || [];
  let count = 0;

  for (const notification of notifications) {
    if (!type || notification.type === type) {
      notification.read = true;
      count++;
    }
  }

  return c.json({ success: true, markedRead: count });
});

// DELETE /api/notifications/:id
router.delete("/:id", authMiddleware, (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const notifications = notificationStore.get(userId) || [];
  const index = notifications.findIndex((n) => n.id === id);

  if (index === -1) {
    return c.json({ error: "Notification not found" }, 404);
  }

  notifications.splice(index, 1);
  notificationStore.set(userId, notifications);

  return c.body(null, 204);
});

// DELETE /api/notifications/clear
router.delete("/clear", authMiddleware, (c) => {
  const userId = c.get("userId");
  const type = c.req.query("type");
  const readOnly = c.req.query("readOnly");

  let notifications = notificationStore.get(userId) || [];

  if (type && typeof type === "string") {
    notifications = notifications.filter((n) => n.type !== type);
  } else if (readOnly === "true") {
    notifications = notifications.filter((n) => !n.read);
  } else {
    notifications = [];
  }

  notificationStore.set(userId, notifications);

  return c.json({ success: true });
});

// POST /api/notifications/create
router.post("/create", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const { type, title, message, priority, data, expiresAt } = await c.req.json() as {
    type: NotificationType;
    title: string;
    message: string;
    priority?: NotificationPriority;
    data?: Record<string, unknown>;
    expiresAt?: string;
  };

  if (!type || !title || !message) {
    return c.json({ error: "type, title, and message are required" }, 400);
  }

  const notification = createNotification(userId, type, title, message, {
    priority,
    data,
    expiresAt: expiresAt ? new Date(expiresAt) : undefined,
  });

  return c.json(notification, 201);
});

// POST /api/notifications/broadcast
router.post("/broadcast", authMiddleware, async (c) => {
  const { type, title, message, priority, data, userIds } = await c.req.json() as {
    type: NotificationType;
    title: string;
    message: string;
    priority?: NotificationPriority;
    data?: Record<string, unknown>;
    userIds?: string[];
  };

  if (!type || !title || !message) {
    return c.json({ error: "type, title, and message are required" }, 400);
  }

  broadcastNotification(type, title, message, {
    priority,
    data,
    userIds,
  });

  return c.json({
    success: true,
    message: `Notification broadcasted to ${userIds?.length || "all"} users`,
  });
});

export { createNotification, broadcastNotification };
export default router;
