import { defineStore } from "pinia";
import { ref, computed, onScopeDispose } from "vue";
import { api } from "@/lib/api";
import {
  getWebSocketClient,
  type WebSocketStatus,
} from "@/lib/websocket";

export type NotificationType =
  | "system"
  | "task_complete"
  | "task_failed"
  | "message"
  | "im_status"
  | "warning"
  | "info";

export type NotificationPriority = "low" | "normal" | "high" | "urgent";

export interface Notification {
  id: string;
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  read: boolean;
  createdAt: string;
  expiresAt?: string;
}

export const useNotificationsStore = defineStore("notifications", () => {
  const notifications = ref<Notification[]>([]);
  const unreadCount = ref(0);
  const loading = ref(false);
  const initialized = ref(false);

  // WebSocket 相关
  const wsClient = getWebSocketClient();
  const wsStatus = ref<WebSocketStatus>("disconnected");
  let unsubscribeMessage: (() => void) | null = null;
  let unsubscribeStatus: (() => void) | null = null;

  // 计算属性
  const hasUnread = computed(() => unreadCount.value > 0);

  const recentNotifications = computed(() =>
    notifications.value.slice(0, 5)
  );

  const unreadNotifications = computed(() =>
    notifications.value.filter((n) => !n.read)
  );

  // 获取通知列表
  async function fetchNotifications(options?: {
    unreadOnly?: boolean;
    type?: NotificationType;
    limit?: number;
    offset?: number;
  }) {
    loading.value = true;
    try {
      const params = new URLSearchParams();
      if (options?.unreadOnly) params.set("unreadOnly", "true");
      if (options?.type) params.set("type", options.type);
      if (options?.limit) params.set("limit", options.limit.toString());
      if (options?.offset) params.set("offset", options.offset.toString());

      const response = await api.get<{
        notifications: Notification[];
        total: number;
        unreadCount: number;
      }>(`/notifications?${params.toString()}`);

      notifications.value = response.notifications;
      unreadCount.value = response.unreadCount;
    } catch (error) {
      console.error("[Notifications] Fetch failed:", error);
    } finally {
      loading.value = false;
    }
  }

  // 获取未读数量
  async function fetchUnreadCount() {
    try {
      const response = await api.get<{ unreadCount: number }>(
        "/notifications/unread-count"
      );
      unreadCount.value = response.unreadCount;
    } catch (error) {
      console.error("[Notifications] Fetch unread count failed:", error);
    }
  }

  // 标记单条通知为已读
  async function markAsRead(notificationId: string) {
    try {
      await api.post(`/notifications/${notificationId}/read`);

      const notification = notifications.value.find(
        (n) => n.id === notificationId
      );
      if (notification && !notification.read) {
        notification.read = true;
        unreadCount.value = Math.max(0, unreadCount.value - 1);
      }
    } catch (error) {
      console.error("[Notifications] Mark as read failed:", error);
    }
  }

  // 标记所有通知为已读
  async function markAllAsRead(type?: NotificationType) {
    try {
      await api.post("/notifications/read-all", { type });

      for (const notification of notifications.value) {
        if (!type || notification.type === type) {
          notification.read = true;
        }
      }

      unreadCount.value = 0;
    } catch (error) {
      console.error("[Notifications] Mark all as read failed:", error);
    }
  }

  // 删除通知
  async function deleteNotification(notificationId: string) {
    try {
      await api.delete(`/notifications/${notificationId}`);

      const index = notifications.value.findIndex(
        (n) => n.id === notificationId
      );
      if (index > -1) {
        const notification = notifications.value[index]!;
        if (!notification.read) {
          unreadCount.value = Math.max(0, unreadCount.value - 1);
        }
        notifications.value.splice(index, 1);
      }
    } catch (error) {
      console.error("[Notifications] Delete failed:", error);
    }
  }

  // 清除所有通知
  async function clearAll(options?: {
    type?: NotificationType;
    readOnly?: boolean;
  }) {
    try {
      const params = new URLSearchParams();
      if (options?.type) params.set("type", options.type);
      if (options?.readOnly) params.set("readOnly", "true");

      await api.delete(`/notifications/clear?${params.toString()}`);
      await fetchNotifications();
    } catch (error) {
      console.error("[Notifications] Clear all failed:", error);
    }
  }

  // 处理 WebSocket 消息
  function handleWsMessage(message: { type: string; data?: unknown }) {
    if (message.type === "notification:created" && message.data) {
      const notification = message.data as Notification;
      notifications.value.unshift(notification);
      if (!notification.read) {
        unreadCount.value++;
      }

      // 显示浏览器通知（如果启用）
      showBrowserNotification(notification);
    }
  }

  // 显示浏览器通知
  function showBrowserNotification(notification: Notification) {
    if (!("Notification" in window)) return;

    if (Notification.permission === "granted") {
      new Notification(notification.title, {
        body: notification.message,
        icon: "/favicon.ico",
        tag: notification.id,
      });
    } else if (Notification.permission !== "denied") {
      Notification.requestPermission().then((permission) => {
        if (permission === "granted") {
          new Notification(notification.title, {
            body: notification.message,
            icon: "/favicon.ico",
            tag: notification.id,
          });
        }
      });
    }
  }

  // 请求浏览器通知权限
  async function requestNotificationPermission() {
    if (!("Notification" in window)) {
      return "unsupported" as const;
    }

    const permission = await Notification.requestPermission();
    return permission as "granted" | "denied" | "default";
  }

  // 初始化 WebSocket 连接
  function setupWebSocket() {
    unsubscribeMessage = wsClient.onMessage(handleWsMessage);
    unsubscribeStatus = wsClient.onStatusChange((status) => {
      wsStatus.value = status;
    });

    if (!wsClient.isConnected()) {
      wsClient.connect().catch(console.error);
    }
  }

  // 清理 WebSocket
  function cleanupWebSocket() {
    if (unsubscribeMessage) {
      unsubscribeMessage();
      unsubscribeMessage = null;
    }
    if (unsubscribeStatus) {
      unsubscribeStatus();
      unsubscribeStatus = null;
    }
  }

  // 初始化
  async function init() {
    if (initialized.value) return;

    await fetchNotifications();
    setupWebSocket();
    initialized.value = true;

    // 自动清理
    onScopeDispose(() => {
      cleanupWebSocket();
    });
  }

  return {
    // 状态
    notifications,
    unreadCount,
    loading,
    initialized,
    wsStatus,

    // 计算属性
    hasUnread,
    recentNotifications,
    unreadNotifications,

    // 方法
    init,
    fetchNotifications,
    fetchUnreadCount,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    clearAll,
    requestNotificationPermission,
  };
});
