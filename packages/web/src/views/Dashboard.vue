<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useAuthStore } from "@/stores/auth";
import DashboardLayout from "./DashboardLayout.vue";
import { api } from "@/lib/api";

interface TrendData {
  value: number;
  direction: "up" | "down";
  lastWeek: number;
  previousWeek: number;
}

interface RecentSession {
  id: string;
  title: string;
  platform: string | null;
  messageCount: number;
  updatedAt: string;
}

interface Activity {
  id: string;
  type: "session" | "connection" | "task" | "message";
  title: string;
  description: string;
  timestamp: string;
  icon: string;
}

interface AIStatus {
  status: "online" | "offline" | "error";
  model: string;
  latency: number;
}

interface Stats {
  totalSessions: number;
  totalMessages: number;
  activeConnections: number;
  pluginsCount: number;
  trends: {
    sessions: TrendData;
    messages: TrendData;
  };
  recentSessions: RecentSession[];
  activities: Activity[];
  aiStatus: AIStatus;
}

const authStore = useAuthStore();
const stats = ref<Stats>({
  totalSessions: 0,
  totalMessages: 0,
  activeConnections: 0,
  pluginsCount: 0,
  trends: {
    sessions: { value: 0, direction: "up", lastWeek: 0, previousWeek: 0 },
    messages: { value: 0, direction: "up", lastWeek: 0, previousWeek: 0 },
  },
  recentSessions: [],
  activities: [],
  aiStatus: { status: "online", model: "GPT-4", latency: 0 },
});

const loading = ref(true);
const error = ref<string | null>(null);

// 问候语
const greeting = computed(() => {
  const hour = new Date().getHours();
  if (hour < 6) return "夜深了";
  if (hour < 12) return "早上好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
});

const userName = computed(() => authStore.user?.username || "用户");

onMounted(async () => {
  try {
    const data = await api.get<Stats>("/stats");
    stats.value = data;
  } catch (err) {
    console.error("加载统计数据失败:", err);
    error.value = "加载统计数据失败，请稍后重试";
  } finally {
    loading.value = false;
  }
});

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  if (days < 7) return `${days} 天前`;
  return date.toLocaleDateString();
}

function formatTrendValue(value: number): string {
  if (value === 0) return "持平";
  return `${value > 0 ? "+" : ""}${value}%`;
}

function getActivityIcon(type: string): string {
  const icons: Record<string, string> = {
    session: "chat",
    connection: "link",
    task: "time",
    message: "message",
  };
  return icons[type] || "info";
}

function getActivityColor(type: string): string {
  const colors: Record<string, string> = {
    session: "#3b82f6",
    connection: "#10b981",
    task: "#f59e0b",
    message: "#8b5cf6",
  };
  return colors[type] || "#6b7280";
}
</script>

<template>
  <DashboardLayout>
    <div class="dashboard">
      <!-- 欢迎卡片 -->
      <tiny-card class="welcome-card">
        <div class="welcome-content">
          <div class="welcome-text">
            <h2 class="welcome-greeting">{{ greeting }}，{{ userName }}！</h2>
            <p class="welcome-message">欢迎回来，今天想聊点什么？</p>
          </div>
          <div class="ai-status" :class="stats.aiStatus.status">
            <div class="status-indicator"></div>
            <div class="status-info">
              <span class="status-label">AI 助手</span>
              <span class="status-model">{{ stats.aiStatus.model }}</span>
              <span class="status-latency">{{ stats.aiStatus.latency }}ms</span>
            </div>
          </div>
        </div>
        <div class="quick-actions-inline">
          <tiny-button type="primary" icon="chat" @click="$router.push('/chat')">
            开始对话
          </tiny-button>
          <tiny-button icon="link" @click="$router.push('/im')">
            连接 IM
          </tiny-button>
        </div>
      </tiny-card>

      <!-- 统计卡片 -->
      <div class="stats-grid">
        <tiny-card class="stat-card">
          <div class="stat-content">
            <div class="stat-icon sessions">
              <tiny-icon name="chat" />
            </div>
            <div class="stat-info">
              <span class="stat-value">{{ stats.totalSessions }}</span>
              <span class="stat-label">对话会话</span>
              <div class="stat-trend" :class="stats.trends.sessions.direction">
                <tiny-icon :name="stats.trends.sessions.direction === 'up' ? 'arrow-up' : 'arrow-down'" />
                <span>{{ formatTrendValue(stats.trends.sessions.value) }}</span>
              </div>
            </div>
          </div>
        </tiny-card>

        <tiny-card class="stat-card">
          <div class="stat-content">
            <div class="stat-icon messages">
              <tiny-icon name="message" />
            </div>
            <div class="stat-info">
              <span class="stat-value">{{ stats.totalMessages }}</span>
              <span class="stat-label">消息总数</span>
              <div class="stat-trend" :class="stats.trends.messages.direction">
                <tiny-icon :name="stats.trends.messages.direction === 'up' ? 'arrow-up' : 'arrow-down'" />
                <span>{{ formatTrendValue(stats.trends.messages.value) }}</span>
              </div>
            </div>
          </div>
        </tiny-card>

        <tiny-card class="stat-card">
          <div class="stat-content">
            <div class="stat-icon connections">
              <tiny-icon name="link" />
            </div>
            <div class="stat-info">
              <span class="stat-value">{{ stats.activeConnections }}</span>
              <span class="stat-label">活跃连接</span>
            </div>
          </div>
        </tiny-card>

        <tiny-card class="stat-card">
          <div class="stat-content">
            <div class="stat-icon plugins">
              <tiny-icon name="plugin" />
            </div>
            <div class="stat-info">
              <span class="stat-value">{{ stats.pluginsCount }}</span>
              <span class="stat-label">已安装插件</span>
            </div>
          </div>
        </tiny-card>
      </div>

      <!-- 两栏布局：活动流 + 最近会话 -->
      <div class="content-grid">
        <!-- 活动流 -->
        <tiny-card class="activity-card">
          <template #header>
            <div class="card-header">
              <h3>活动流</h3>
              <tiny-tag size="small" type="info">{{ stats.activities.length }} 条记录</tiny-tag>
            </div>
          </template>

          <div v-if="loading" class="loading-placeholder">加载中...</div>
          <div v-else-if="stats.activities.length === 0" class="empty-placeholder">
            暂无活动记录
          </div>
          <div v-else class="activity-list">
            <div
              v-for="activity in stats.activities"
              :key="activity.id"
              class="activity-item"
            >
              <div
                class="activity-icon"
                :style="{ backgroundColor: getActivityColor(activity.type) + '20', color: getActivityColor(activity.type) }"
              >
                <tiny-icon :name="getActivityIcon(activity.type)" />
              </div>
              <div class="activity-content">
                <div class="activity-title">{{ activity.title }}</div>
                <div class="activity-description">{{ activity.description }}</div>
              </div>
              <div class="activity-time">{{ formatDate(activity.timestamp) }}</div>
            </div>
          </div>
        </tiny-card>

        <!-- 最近会话 -->
        <tiny-card class="recent-sessions">
          <template #header>
            <div class="card-header">
              <h3>最近会话</h3>
              <tiny-button size="small" text @click="$router.push('/chat')">
                查看全部
              </tiny-button>
            </div>
          </template>

          <tiny-alert v-if="error" type="error" :title="error" />

          <div v-if="loading" class="loading-placeholder">加载中...</div>
          <tiny-grid
            v-else-if="stats.recentSessions.length > 0"
            :data="stats.recentSessions"
            auto-resize
          >
            <tiny-grid-column field="title" title="标题" />
            <tiny-grid-column field="platform" title="平台" width="80">
              <template #default="{ row }">
                <tiny-tag size="small">{{ row.platform || 'Web' }}</tiny-tag>
              </template>
            </tiny-grid-column>
            <tiny-grid-column field="messageCount" title="消息" width="60" />
            <tiny-grid-column title="操作" width="80">
              <template #default="{ row }">
                <tiny-button size="mini" type="primary" text @click="$router.push(`/chat?id=${row.id}`)">
                  继续
                </tiny-button>
              </template>
            </tiny-grid-column>
          </tiny-grid>
          <tiny-empty v-else description="暂无会话记录" />
        </tiny-card>
      </div>

      <!-- 快速操作 -->
      <tiny-card class="quick-actions">
        <template #header>
          <h3>快速操作</h3>
        </template>
        <div class="actions-grid">
          <tiny-button type="primary" icon="chat" @click="$router.push('/chat')">
            新对话
          </tiny-button>
          <tiny-button icon="link" @click="$router.push('/im')">
            连接 IM
          </tiny-button>
          <tiny-button icon="plugin" @click="$router.push('/settings')">
            管理插件
          </tiny-button>
          <tiny-button icon="setting" @click="$router.push('/settings')">
            系统设置
          </tiny-button>
        </div>
      </tiny-card>
    </div>
  </DashboardLayout>
</template>

<style scoped>
.dashboard {
  max-width: 1200px;
}

/* 欢迎卡片 */
.welcome-card {
  border-radius: 16px;
  margin-bottom: 24px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.welcome-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.welcome-greeting {
  font-size: 28px;
  font-weight: 700;
  margin: 0 0 8px 0;
}

.welcome-message {
  font-size: 16px;
  margin: 0;
  opacity: 0.9;
}

.ai-status {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 12px;
  backdrop-filter: blur(10px);
}

.ai-status.online .status-indicator {
  background: #10b981;
  box-shadow: 0 0 8px #10b981;
}

.ai-status.offline .status-indicator {
  background: #ef4444;
}

.ai-status.error .status-indicator {
  background: #f59e0b;
}

.status-indicator {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.status-info {
  display: flex;
  flex-direction: column;
}

.status-label {
  font-size: 12px;
  opacity: 0.8;
}

.status-model {
  font-size: 14px;
  font-weight: 600;
}

.status-latency {
  font-size: 11px;
  opacity: 0.7;
}

.quick-actions-inline {
  display: flex;
  gap: 12px;
}

/* 统计卡片 */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.stat-card {
  border-radius: 12px;
}

.stat-content {
  display: flex;
  align-items: center;
  gap: 16px;
}

.stat-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
}

.stat-icon.sessions {
  background: #fef3c7;
  color: #f59e0b;
}

.stat-icon.messages {
  background: #dbeafe;
  color: #3b82f6;
}

.stat-icon.connections {
  background: #d1fae5;
  color: #10b981;
}

.stat-icon.plugins {
  background: #ede9fe;
  color: #8b5cf6;
}

.stat-info {
  display: flex;
  flex-direction: column;
}

.stat-value {
  font-size: 28px;
  font-weight: 700;
  line-height: 1;
}

.stat-label {
  font-size: 14px;
  color: #6b7280;
  margin-top: 4px;
}

/* 趋势指示器 */
.stat-trend {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 12px;
  margin-top: 4px;
}

.stat-trend.up {
  color: #10b981;
}

.stat-trend.down {
  color: #ef4444;
}

/* 两栏布局 */
.content-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  margin-bottom: 24px;
}

@media (max-width: 900px) {
  .content-grid {
    grid-template-columns: 1fr;
  }

  .welcome-content {
    flex-direction: column;
    align-items: flex-start;
    gap: 16px;
  }
}

/* 活动流 */
.activity-card {
  border-radius: 12px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.activity-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.activity-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: #f9fafb;
  border-radius: 8px;
  transition: all 0.2s;
}

.dark .activity-item {
  background: #374151;
}

.activity-item:hover {
  background: #f3f4f6;
  transform: translateX(4px);
}

.dark .activity-item:hover {
  background: #4b5563;
}

.activity-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.activity-content {
  flex: 1;
  min-width: 0;
}

.activity-title {
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.activity-description {
  font-size: 12px;
  color: #6b7280;
}

.activity-time {
  font-size: 12px;
  color: #9ca3af;
  white-space: nowrap;
}

/* 最近会话 */
.recent-sessions {
  border-radius: 12px;
}

/* 快速操作 */
.quick-actions {
  border-radius: 12px;
}

.quick-actions h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.actions-grid {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

/* 加载和空状态 */
.loading-placeholder,
.empty-placeholder {
  padding: 24px;
  text-align: center;
  color: #6b7280;
}
</style>
