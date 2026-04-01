<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import {
  useNotificationsStore,
  type Notification,
  type NotificationType,
} from "@/stores/notifications";

const store = useNotificationsStore();

const drawerVisible = ref(false);
const activeTab = ref<"all" | "unread">("all");
const selectedType = ref<NotificationType | "">("");

// 过滤后的通知列表
const filteredNotifications = computed(() => {
  let list = store.notifications;

  if (activeTab.value === "unread") {
    list = list.filter((n) => !n.read);
  }

  if (selectedType.value) {
    list = list.filter((n) => n.type === selectedType.value);
  }

  return list;
});

// 获取通知图标
function getNotificationIcon(type: NotificationType): string {
  switch (type) {
    case "system":
      return "setting";
    case "task_complete":
      return "success";
    case "task_failed":
      return "error";
    case "message":
      return "chat";
    case "im_status":
      return "link";
    case "warning":
      return "warning";
    case "info":
    default:
      return "info";
  }
}

// 获取通知类型标签样式
function getTypeTagType(type: NotificationType): string {
  switch (type) {
    case "system":
      return "primary";
    case "task_complete":
      return "success";
    case "task_failed":
      return "danger";
    case "message":
      return "info";
    case "im_status":
      return "warning";
    case "warning":
      return "warning";
    case "info":
    default:
      return "";
  }
}

// 获取通知类型文本
function getTypeText(type: NotificationType): string {
  switch (type) {
    case "system":
      return "系统";
    case "task_complete":
      return "任务完成";
    case "task_failed":
      return "任务失败";
    case "message":
      return "消息";
    case "im_status":
      return "IM 状态";
    case "warning":
      return "警告";
    case "info":
      return "信息";
    default:
      return type;
  }
}

// 获取优先级样式
function getPriorityClass(priority: string): string {
  switch (priority) {
    case "urgent":
      return "priority-urgent";
    case "high":
      return "priority-high";
    case "normal":
      return "priority-normal";
    case "low":
      return "priority-low";
    default:
      return "";
  }
}

// 格式化时间
function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  // 小于 1 分钟
  if (diff < 60 * 1000) {
    return "刚刚";
  }

  // 小于 1 小时
  if (diff < 60 * 60 * 1000) {
    const minutes = Math.floor(diff / (60 * 1000));
    return `${minutes} 分钟前`;
  }

  // 小于 1 天
  if (diff < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(diff / (60 * 60 * 1000));
    return `${hours} 小时前`;
  }

  // 小于 7 天
  if (diff < 7 * 24 * 60 * 60 * 1000) {
    const days = Math.floor(diff / (24 * 60 * 60 * 1000));
    return `${days} 天前`;
  }

  return date.toLocaleDateString();
}

// 打开通知中心
function openDrawer() {
  drawerVisible.value = true;
}

// 关闭通知中心
function closeDrawer() {
  drawerVisible.value = false;
}

// 点击通知
async function handleClick(notification: Notification) {
  // 标记为已读
  if (!notification.read) {
    await store.markAsRead(notification.id);
  }

  // 如果有链接，跳转
  if (notification.data?.link) {
    window.location.href = notification.data.link as string;
  }
}

// 删除通知
async function handleDelete(notification: Notification, event: Event) {
  event.stopPropagation();
  await store.deleteNotification(notification.id);
}

// 全部标记已读
async function markAllRead() {
  await store.markAllAsRead(selectedType.value || undefined);
}

// 清除已读
async function clearRead() {
  await store.clearAll({ readOnly: true });
}

// 切换标签
function switchTab(tab: "all" | "unread") {
  activeTab.value = tab;
}

onMounted(() => {
  store.init();
});

// 暴露方法供外部调用
defineExpose({
  openDrawer,
  closeDrawer,
});
</script>

<template>
  <!-- 通知铃铛按钮 -->
  <div class="notification-bell" @click="openDrawer">
    <tiny-icon name="notification" />
    <span v-if="store.hasUnread" class="badge">
      {{ store.unreadCount > 99 ? "99+" : store.unreadCount }}
    </span>
  </div>

  <!-- 通知抽屉 -->
  <tiny-drawer
    v-model="drawerVisible"
    title="通知中心"
    :show-footer="false"
    width="400px"
    direction="rtl"
  >
    <div class="notification-center">
      <!-- 顶部操作栏 -->
      <div class="header-actions">
        <div class="tabs">
          <span
            class="tab"
            :class="{ active: activeTab === 'all' }"
            @click="switchTab('all')"
          >
            全部
          </span>
          <span
            class="tab"
            :class="{ active: activeTab === 'unread' }"
            @click="switchTab('unread')"
          >
            未读
            <span v-if="store.unreadCount > 0" class="unread-badge">
              {{ store.unreadCount }}
            </span>
          </span>
        </div>
        <div class="actions">
          <tiny-button
            v-if="store.hasUnread"
            size="mini"
            type="text"
            @click="markAllRead"
          >
            全部已读
          </tiny-button>
          <tiny-button size="mini" type="text" @click="clearRead">
            清除已读
          </tiny-button>
        </div>
      </div>

      <!-- 类型过滤 -->
      <div class="type-filter">
        <tiny-select
          v-model="selectedType"
          placeholder="全部类型"
          size="small"
          clearable
        >
          <tiny-option label="系统通知" value="system" />
          <tiny-option label="任务完成" value="task_complete" />
          <tiny-option label="任务失败" value="task_failed" />
          <tiny-option label="消息" value="message" />
          <tiny-option label="IM 状态" value="im_status" />
          <tiny-option label="警告" value="warning" />
          <tiny-option label="信息" value="info" />
        </tiny-select>
      </div>

      <!-- 通知列表 -->
      <div class="notification-list">
        <div v-if="store.loading" class="loading-state">
          <tiny-skeleton :rows="3" animated />
        </div>

        <tiny-empty
          v-else-if="filteredNotifications.length === 0"
          description="暂无通知"
        />

        <div
          v-else
          v-for="notification in filteredNotifications"
          :key="notification.id"
          class="notification-item"
          :class="[
            { unread: !notification.read },
            getPriorityClass(notification.priority),
          ]"
          @click="handleClick(notification)"
        >
          <div class="notification-icon">
            <tiny-icon :name="getNotificationIcon(notification.type)" />
          </div>
          <div class="notification-content">
            <div class="notification-header">
              <span class="notification-title">{{ notification.title }}</span>
              <tiny-tag
                :type="getTypeTagType(notification.type)"
                size="small"
              >
                {{ getTypeText(notification.type) }}
              </tiny-tag>
            </div>
            <div class="notification-message">
              {{ notification.message }}
            </div>
            <div class="notification-footer">
              <span class="notification-time">
                {{ formatTime(notification.createdAt) }}
              </span>
            </div>
          </div>
          <div class="notification-actions">
            <tiny-button
              size="mini"
              type="text"
              icon="close"
              @click="handleDelete(notification, $event)"
            />
          </div>
        </div>
      </div>
    </div>
  </tiny-drawer>
</template>

<style scoped>
.notification-bell {
  position: relative;
  cursor: pointer;
  padding: 8px;
  border-radius: 8px;
  transition: background-color 0.2s;
}

.notification-bell:hover {
  background-color: #f3f4f6;
}

.dark .notification-bell:hover {
  background-color: #374151;
}

.notification-bell .badge {
  position: absolute;
  top: 2px;
  right: 2px;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  font-size: 11px;
  font-weight: 600;
  line-height: 18px;
  text-align: center;
  color: white;
  background: #ef4444;
  border-radius: 9px;
}

.notification-center {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.header-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #e5e7eb;
}

.dark .header-actions {
  border-bottom-color: #374151;
}

.tabs {
  display: flex;
  gap: 16px;
}

.tab {
  font-size: 14px;
  color: #6b7280;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.2s;
}

.tab:hover {
  color: #374151;
  background-color: #f3f4f6;
}

.dark .tab:hover {
  color: #e5e7eb;
  background-color: #374151;
}

.tab.active {
  color: #f97316;
  font-weight: 500;
}

.unread-badge {
  margin-left: 4px;
  padding: 1px 6px;
  font-size: 11px;
  background: #f97316;
  color: white;
  border-radius: 10px;
}

.actions {
  display: flex;
  gap: 8px;
}

.type-filter {
  padding: 8px 16px;
  border-bottom: 1px solid #e5e7eb;
}

.dark .type-filter {
  border-bottom-color: #374151;
}

.notification-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.loading-state {
  padding: 16px;
}

.notification-item {
  display: flex;
  gap: 12px;
  padding: 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.2s;
  margin-bottom: 8px;
  background: #f9fafb;
  border-left: 3px solid transparent;
}

.dark .notification-item {
  background: #374151;
}

.notification-item:hover {
  background: #f3f4f6;
}

.dark .notification-item:hover {
  background: #4b5563;
}

.notification-item.unread {
  background: #fff7ed;
  border-left-color: #f97316;
}

.dark .notification-item.unread {
  background: #431407;
}

.notification-item.priority-urgent {
  border-left-color: #ef4444;
}

.notification-item.priority-high {
  border-left-color: #f97316;
}

.notification-icon {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #e5e7eb;
  border-radius: 8px;
  font-size: 18px;
}

.dark .notification-icon {
  background: #4b5563;
}

.notification-content {
  flex: 1;
  min-width: 0;
}

.notification-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.notification-title {
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.notification-message {
  font-size: 13px;
  color: #6b7280;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.dark .notification-message {
  color: #9ca3af;
}

.notification-footer {
  margin-top: 4px;
}

.notification-time {
  font-size: 12px;
  color: #9ca3af;
}

.notification-actions {
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.2s;
}

.notification-item:hover .notification-actions {
  opacity: 1;
}
</style>
