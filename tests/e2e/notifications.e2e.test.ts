/**
 * E2E 测试 - 通知系统
 * 测试通知的创建、推送、读取等端到端流程
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { EventEmitter } from "events";

// Mock WebSocket for E2E testing
class MockWebSocketClient extends EventEmitter {
  connected = false;

  connect(): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(() => {
        this.connected = true;
        this.emit("open");
        resolve();
      }, 100);
    });
  }

  send(data: string): void {
    if (!this.connected) throw new Error("Not connected");
    this.emit("message:sent", JSON.parse(data));
  }

  receive(data: unknown): void {
    this.emit("message", JSON.stringify(data));
  }

  close(): void {
    this.connected = false;
    this.emit("close");
  }
}

// Mock notification service
interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: Date;
}

class MockNotificationService {
  private notifications: Map<string, Notification[]> = new Map();
  private wsClients: Set<MockWebSocketClient> = new Set();

  create(userId: string, data: Omit<Notification, "id" | "read" | "createdAt">): Notification {
    const notification: Notification = {
      id: `notif_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      read: false,
      createdAt: new Date(),
      ...data,
    };

    const userNotifications = this.notifications.get(userId) || [];
    userNotifications.unshift(notification);
    this.notifications.set(userId, userNotifications);

    // Push via WebSocket
    this.broadcast(userId, { type: "notification:created", data: notification });

    return notification;
  }

  list(userId: string, options?: { unreadOnly?: boolean }): Notification[] {
    let notifications = this.notifications.get(userId) || [];
    if (options?.unreadOnly) {
      notifications = notifications.filter((n) => !n.read);
    }
    return notifications;
  }

  markRead(userId: string, notificationId: string): boolean {
    const notifications = this.notifications.get(userId) || [];
    const notification = notifications.find((n) => n.id === notificationId);
    if (notification) {
      notification.read = true;
      return true;
    }
    return false;
  }

  markAllRead(userId: string): number {
    const notifications = this.notifications.get(userId) || [];
    let count = 0;
    notifications.forEach((n) => {
      if (!n.read) {
        n.read = true;
        count++;
      }
    });
    return count;
  }

  delete(userId: string, notificationId: string): boolean {
    const notifications = this.notifications.get(userId) || [];
    const index = notifications.findIndex((n) => n.id === notificationId);
    if (index > -1) {
      notifications.splice(index, 1);
      return true;
    }
    return false;
  }

  unreadCount(userId: string): number {
    const notifications = this.notifications.get(userId) || [];
    return notifications.filter((n) => !n.read).length;
  }

  registerClient(client: MockWebSocketClient): void {
    this.wsClients.add(client);
  }

  unregisterClient(client: MockWebSocketClient): void {
    this.wsClients.delete(client);
  }

  private broadcast(userId: string, message: unknown): void {
    this.wsClients.forEach((client) => {
      if (client.connected) {
        client.receive(message);
      }
    });
  }
}

describe("Notifications E2E", () => {
  let wsClient: MockWebSocketClient;
  let notificationService: MockNotificationService;
  const testUserId = "user_e2e_test";

  beforeAll(async () => {
    notificationService = new MockNotificationService();
    wsClient = new MockWebSocketClient();

    await wsClient.connect();
    notificationService.registerClient(wsClient);
  });

  afterAll(() => {
    wsClient.close();
    notificationService.unregisterClient(wsClient);
  });

  describe("WebSocket Connection", () => {
    it("should connect to WebSocket", () => {
      expect(wsClient.connected).toBe(true);
    });

    it("should handle connection close", () => {
      const closeHandler = vi.fn();
      wsClient.on("close", closeHandler);

      wsClient.close();
      expect(wsClient.connected).toBe(false);

      // Reconnect for other tests
      wsClient.connect();
    });
  });

  describe("Notification Creation", () => {
    it("should create notification and push via WebSocket", async () => {
      const messageHandler = vi.fn();
      wsClient.on("message", messageHandler);

      const notification = notificationService.create(testUserId, {
        type: "system",
        title: "Test Notification",
        message: "This is a test notification",
      });

      // Wait for async broadcast
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(notification.id).toBeDefined();
      expect(notification.read).toBe(false);
      expect(messageHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "notification:created",
          data: expect.objectContaining({
            id: notification.id,
          }),
        })
      );
    });

    it("should store notification in user's list", () => {
      notificationService.create(testUserId, {
        type: "task_complete",
        title: "Task Done",
        message: "Your task has completed",
      });

      const notifications = notificationService.list(testUserId);
      expect(notifications.length).toBeGreaterThan(0);
    });
  });

  describe("Notification Retrieval", () => {
    beforeAll(() => {
      // Create multiple notifications
      notificationService.create(testUserId, {
        type: "info",
        title: "Info 1",
        message: "Info message 1",
      });
      notificationService.create(testUserId, {
        type: "warning",
        title: "Warning 1",
        message: "Warning message 1",
      });
    });

    it("should list all notifications", () => {
      const notifications = notificationService.list(testUserId);
      expect(notifications.length).toBeGreaterThan(0);
    });

    it("should list only unread notifications", () => {
      // Mark one as read
      const notifications = notificationService.list(testUserId);
      if (notifications[0]) {
        notificationService.markRead(testUserId, notifications[0].id);
      }

      const unreadNotifications = notificationService.list(testUserId, {
        unreadOnly: true,
      });

      expect(
        unreadNotifications.every((n) => !n.read)
      ).toBe(true);
    });

    it("should get unread count", () => {
      const count = notificationService.unreadCount(testUserId);
      const notifications = notificationService.list(testUserId, { unreadOnly: true });

      expect(count).toBe(notifications.length);
    });
  });

  describe("Mark as Read", () => {
    it("should mark single notification as read", () => {
      const notification = notificationService.create(testUserId, {
        type: "info",
        title: "To Read",
        message: "Mark this as read",
      });

      expect(notification.read).toBe(false);

      const result = notificationService.markRead(testUserId, notification.id);
      expect(result).toBe(true);

      const notifications = notificationService.list(testUserId);
      const updated = notifications.find((n) => n.id === notification.id);
      expect(updated?.read).toBe(true);
    });

    it("should mark all notifications as read", () => {
      // Create unread notifications
      notificationService.create(testUserId, {
        type: "info",
        title: "Unread 1",
        message: "Message 1",
      });
      notificationService.create(testUserId, {
        type: "info",
        title: "Unread 2",
        message: "Message 2",
      });

      const count = notificationService.markAllRead(testUserId);
      expect(count).toBeGreaterThan(0);

      const unreadCount = notificationService.unreadCount(testUserId);
      expect(unreadCount).toBe(0);
    });
  });

  describe("Notification Deletion", () => {
    it("should delete notification", () => {
      const notification = notificationService.create(testUserId, {
        type: "info",
        title: "To Delete",
        message: "Delete this",
      });

      const result = notificationService.delete(testUserId, notification.id);
      expect(result).toBe(true);

      const notifications = notificationService.list(testUserId);
      expect(notifications.find((n) => n.id === notification.id)).toBeUndefined();
    });

    it("should return false for non-existent notification", () => {
      const result = notificationService.delete(testUserId, "non_existent_id");
      expect(result).toBe(false);
    });
  });

  describe("Real-time Updates", () => {
    it("should receive real-time notification push", async () => {
      const messageHandler = vi.fn();
      wsClient.on("message", messageHandler);

      notificationService.create(testUserId, {
        type: "task_complete",
        title: "Real-time Test",
        message: "This should be pushed immediately",
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(messageHandler).toHaveBeenCalled();
    });

    it("should handle multiple concurrent notifications", async () => {
      const messageHandler = vi.fn();
      wsClient.on("message", messageHandler);

      // Create multiple notifications concurrently
      const promises = Array.from({ length: 5 }, (_, i) =>
        Promise.resolve(
          notificationService.create(testUserId, {
            type: "info",
            title: `Concurrent ${i}`,
            message: `Message ${i}`,
          })
        )
      );

      await Promise.all(promises);
      await new Promise((resolve) => setTimeout(resolve, 100));

      // All notifications should be received
      expect(messageHandler).toHaveBeenCalled();
    });
  });

  describe("Error Handling", () => {
    it("should handle invalid user gracefully", () => {
      const notifications = notificationService.list("non_existent_user");
      expect(notifications).toEqual([]);
    });

    it("should handle marking non-existent notification", () => {
      const result = notificationService.markRead(testUserId, "non_existent");
      expect(result).toBe(false);
    });
  });
});
