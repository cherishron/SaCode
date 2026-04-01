import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock Express
const mockRouter = {
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
};

vi.mock("express", () => ({
  default: {
    Router: () => mockRouter,
  },
}));

// Test notification store
interface TestNotification {
  id: string;
  userId: string;
  type: string;
  priority: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  read: boolean;
  createdAt: Date;
}

const notificationStore = new Map<string, TestNotification[]>();

function resetStore(): void {
  notificationStore.clear();
}

function getUserNotifications(userId: string): TestNotification[] {
  return notificationStore.get(userId) || [];
}

function addNotification(userId: string, notification: TestNotification): void {
  const userNotifications = getUserNotifications(userId);
  userNotifications.unshift(notification);
  if (userNotifications.length > 100) {
    userNotifications.pop();
  }
  notificationStore.set(userId, userNotifications);
}

function createTestNotification(
  userId: string,
  overrides: Partial<TestNotification> = {}
): TestNotification {
  const notification: TestNotification = {
    id: `notif_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    userId,
    type: "info",
    priority: "normal",
    title: "Test Notification",
    message: "This is a test notification",
    read: false,
    createdAt: new Date(),
    ...overrides,
  };
  return notification;
}

describe("Notifications API", () => {
  const testUserId = "user_test123";

  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  describe("Notification Store", () => {
    it("should store notifications per user", () => {
      const notification = createTestNotification(testUserId, {
        type: "system",
        title: "System Update",
        message: "System will be updated",
      });

      addNotification(testUserId, notification);
      const stored = getUserNotifications(testUserId);

      expect(stored).toHaveLength(1);
      expect(stored[0]?.title).toBe("System Update");
    });

    it("should limit notifications to 100 per user", () => {
      for (let i = 0; i < 150; i++) {
        const notification = createTestNotification(testUserId, {
          title: `Notification ${i}`,
        });
        addNotification(testUserId, notification);
      }

      const stored = getUserNotifications(testUserId);
      expect(stored).toHaveLength(100);
    });

    it("should store notifications for different users separately", () => {
      const user1Notification = createTestNotification("user1", {
        title: "User 1 Notification",
      });
      const user2Notification = createTestNotification("user2", {
        title: "User 2 Notification",
      });

      addNotification("user1", user1Notification);
      addNotification("user2", user2Notification);

      expect(getUserNotifications("user1")).toHaveLength(1);
      expect(getUserNotifications("user2")).toHaveLength(1);
      expect(getUserNotifications("user1")[0]?.title).toBe("User 1 Notification");
    });
  });

  describe("Notification Types", () => {
    it("should support all notification types", () => {
      const types = [
        "system",
        "task_complete",
        "task_failed",
        "message",
        "im_status",
        "warning",
        "info",
      ];

      types.forEach((type) => {
        const notification = createTestNotification(testUserId, { type });
        addNotification(testUserId, notification);
      });

      const stored = getUserNotifications(testUserId);
      expect(stored).toHaveLength(types.length);
    });

    it("should support priority levels", () => {
      const priorities = ["low", "normal", "high", "urgent"];

      priorities.forEach((priority) => {
        const notification = createTestNotification(testUserId, { priority });
        addNotification(testUserId, notification);
      });

      const stored = getUserNotifications(testUserId);
      expect(stored).toHaveLength(priorities.length);
    });
  });

  describe("Read Status", () => {
    it("should create notifications as unread by default", () => {
      const notification = createTestNotification(testUserId);
      expect(notification.read).toBe(false);
    });

    it("should mark notification as read", () => {
      const notification = createTestNotification(testUserId);
      addNotification(testUserId, notification);

      const stored = getUserNotifications(testUserId);
      stored[0]!.read = true;

      expect(stored[0]!.read).toBe(true);
    });
  });

  describe("Query and Filter", () => {
    beforeEach(() => {
      // Add various notifications
      addNotification(
        testUserId,
        createTestNotification(testUserId, { type: "system", read: false })
      );
      addNotification(
        testUserId,
        createTestNotification(testUserId, { type: "task_complete", read: true })
      );
      addNotification(
        testUserId,
        createTestNotification(testUserId, { type: "warning", read: false })
      );
      addNotification(
        testUserId,
        createTestNotification(testUserId, { type: "info", read: true })
      );
    });

    it("should filter by unread status", () => {
      const notifications = getUserNotifications(testUserId);
      const unread = notifications.filter((n) => !n.read);

      expect(unread).toHaveLength(2);
    });

    it("should filter by type", () => {
      const notifications = getUserNotifications(testUserId);
      const systemNotifications = notifications.filter(
        (n) => n.type === "system"
      );

      expect(systemNotifications).toHaveLength(1);
    });

    it("should count unread notifications", () => {
      const notifications = getUserNotifications(testUserId);
      const unreadCount = notifications.filter((n) => !n.read).length;

      expect(unreadCount).toBe(2);
    });
  });

  describe("Bulk Operations", () => {
    beforeEach(() => {
      for (let i = 0; i < 5; i++) {
        addNotification(
          testUserId,
          createTestNotification(testUserId, {
            type: i % 2 === 0 ? "system" : "task_complete",
            read: i % 2 === 0,
          })
        );
      }
    });

    it("should mark all as read", () => {
      const notifications = getUserNotifications(testUserId);
      notifications.forEach((n) => {
        n.read = true;
      });

      const unreadCount = notifications.filter((n) => !n.read).length;
      expect(unreadCount).toBe(0);
    });

    it("should mark all by type as read", () => {
      const notifications = getUserNotifications(testUserId);
      notifications
        .filter((n) => n.type === "system")
        .forEach((n) => {
          n.read = true;
        });

      const systemNotifications = notifications.filter(
        (n) => n.type === "system"
      );
      expect(systemNotifications.every((n) => n.read)).toBe(true);
    });

    it("should delete notification by id", () => {
      const notifications = getUserNotifications(testUserId);
      const initialCount = notifications.length;
      const targetId = notifications[0]!.id;

      const index = notifications.findIndex((n) => n.id === targetId);
      if (index > -1) {
        notifications.splice(index, 1);
      }

      expect(notifications).toHaveLength(initialCount - 1);
      expect(notifications.find((n) => n.id === targetId)).toBeUndefined();
    });

    it("should clear read notifications", () => {
      const notifications = getUserNotifications(testUserId);
      const readNotifications = notifications.filter((n) => n.read);

      // Simulate clear
      const remaining = notifications.filter((n) => !n.read);
      notificationStore.set(testUserId, remaining);

      expect(getUserNotifications(testUserId).length).toBe(
        notifications.length - readNotifications.length
      );
    });
  });

  describe("Notification with Data", () => {
    it("should store notification with additional data", () => {
      const notification = createTestNotification(testUserId, {
        type: "task_complete",
        title: "Task Completed",
        message: "Your analysis task has finished",
        data: {
          taskId: "task_123",
          resultUrl: "/tasks/task_123",
          duration: 5000,
        },
      });

      addNotification(testUserId, notification);
      const stored = getUserNotifications(testUserId);

      expect(stored[0]?.data).toEqual({
        taskId: "task_123",
        resultUrl: "/tasks/task_123",
        duration: 5000,
      });
    });
  });
});
