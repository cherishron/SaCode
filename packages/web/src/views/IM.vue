<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import DashboardLayout from "./DashboardLayout.vue";
import { api } from "@/lib/api";
import { getWebSocketClient, type IMStatusMessage, type IMLogMessage } from "@/lib/websocket";

interface IMConnection {
  id: string;
  platform: string;
  name: string;
  status: "connected" | "disconnected" | "error";
  config: string;
  updatedAt: string;
}

interface IMLog {
  id: string;
  connectionId: string;
  type: "connect" | "disconnect" | "test" | "error" | "message";
  message: string;
  timestamp: string;
  details?: Record<string, unknown>;
}

const connections = ref<IMConnection[]>([]);
const loading = ref(true);
const dialogVisible = ref(false);
const editingConnection = ref<IMConnection | null>(null);
const saving = ref(false);

// 测试连接相关
const testingConnection = ref<string | null>(null);
const testResults = ref<Map<string, { success: boolean; latency: number; message: string }>>(new Map());

// 日志相关
const logsDialogVisible = ref(false);
const logs = ref<IMLog[]>([]);
const logsLoading = ref(false);
const selectedConnectionForLogs = ref<IMConnection | null>(null);

// WebSocket 相关
const wsClient = getWebSocketClient();
let unsubscribeIM: (() => void) | null = null;

const platforms = [
  { value: "wechat", label: "微信", icon: "chat" },
  { value: "qq", label: "QQ", icon: "message" },
  { value: "telegram", label: "Telegram", icon: "send" },
  { value: "discord", label: "Discord", icon: "game" },
  { value: "dingtalk", label: "钉钉", icon: "notification" },
  { value: "feishu", label: "飞书", icon: "email" },
  { value: "xiaoyi", label: "小艺", icon: "robot" },
  { value: "slack", label: "Slack", icon: "team" },
  { value: "whatsapp", label: "WhatsApp", icon: "phone" },
  { value: "email", label: "Email", icon: "mail" },
];

const form = ref({
  platform: "",
  name: "",
  config: {} as Record<string, string>,
});

onMounted(async () => {
  await loadConnections();
  setupWebSocket();
});

onUnmounted(() => {
  if (unsubscribeIM) {
    unsubscribeIM();
  }
});

async function loadConnections() {
  loading.value = true;
  try {
    const data = await api.get<IMConnection[]>("/im");
    connections.value = data;
  } catch (error) {
    console.error("加载连接列表失败:", error);
  } finally {
    loading.value = false;
  }
}

// 设置 WebSocket 监听
function setupWebSocket() {
  wsClient.connect().then(() => {
    wsClient.subscribeIM();
    
    // 监听 IM 状态变更
    unsubscribeIM = wsClient.onMessage((message) => {
      if (message.type === "im:status") {
        const statusMsg = message as IMStatusMessage;
        updateConnectionStatus(statusMsg.data.connectionId, statusMsg.data.status);
      } else if (message.type === "im:log") {
        const logMsg = message as IMLogMessage;
        // 如果日志对话框打开，添加新日志
        if (logsDialogVisible.value && selectedConnectionForLogs.value?.id === logMsg.data.connectionId) {
          logs.value.unshift(logMsg.data);
        }
      }
    });
  }).catch(console.error);
}

// 更新连接状态
function updateConnectionStatus(connectionId: string, status: string) {
  const connection = connections.value.find(c => c.id === connectionId);
  if (connection) {
    connection.status = status as IMConnection["status"];
    connection.updatedAt = new Date().toISOString();
  }
}

function openCreateDialog() {
  editingConnection.value = null;
  form.value = {
    platform: "",
    name: "",
    config: {},
  };
  dialogVisible.value = true;
}

function openEditDialog(connection: IMConnection) {
  editingConnection.value = connection;
  
  let config: Record<string, string> = {};
  try {
    config = JSON.parse(connection.config || "{}");
  } catch {
    config = {};
  }
  
  form.value = {
    platform: connection.platform,
    name: connection.name,
    config,
  };
  dialogVisible.value = true;
}

async function saveConnection() {
  saving.value = true;
  try {
    if (editingConnection.value) {
      // 更新连接
      await api.patch(`/im/${editingConnection.value.id}`, {
        name: form.value.name,
        config: form.value.config,
      });
    } else {
      // 创建连接
      await api.post("/im", {
        platform: form.value.platform,
        name: form.value.name,
        config: form.value.config,
      });
    }
    
    dialogVisible.value = false;
    await loadConnections();
  } catch (error) {
    console.error("保存连接失败:", error);
  } finally {
    saving.value = false;
  }
}

async function connectIM(connection: IMConnection) {
  try {
    await api.post(`/im/${connection.id}/connect`);
    await loadConnections();
  } catch (error) {
    console.error("连接失败:", error);
  }
}

async function disconnectIM(connection: IMConnection) {
  try {
    await api.post(`/im/${connection.id}/disconnect`);
    await loadConnections();
  } catch (error) {
    console.error("断开连接失败:", error);
  }
}

async function deleteConnection(id: string) {
  if (!confirm("确定要删除此连接吗？")) return;
  
  try {
    await api.delete(`/im/${id}`);
    await loadConnections();
  } catch (error) {
    console.error("删除连接失败:", error);
  }
}

// 测试连接
async function testConnection(connection: IMConnection) {
  testingConnection.value = connection.id;
  testResults.value.delete(connection.id);
  
  try {
    const result = await api.post<{
      success: boolean;
      latency: number;
      platform: string;
      error?: string;
    }>(`/im/${connection.id}/test`);
    
    testResults.value.set(connection.id, {
      success: result.success,
      latency: result.latency,
      message: result.success 
        ? `连接成功 (${result.latency}ms)` 
        : result.error || "连接失败",
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "测试失败";
    testResults.value.set(connection.id, {
      success: false,
      latency: 0,
      message: errorMsg,
    });
  } finally {
    testingConnection.value = null;
  }
}

// 查看日志
async function viewLogs(connection: IMConnection) {
  selectedConnectionForLogs.value = connection;
  logsDialogVisible.value = true;
  logsLoading.value = true;
  logs.value = [];
  
  try {
    const data = await api.get<IMLog[]>(`/im/${connection.id}/logs?limit=50`);
    logs.value = data;
  } catch (error) {
    console.error("加载日志失败:", error);
  } finally {
    logsLoading.value = false;
  }
}

// 清除日志
async function clearLogs() {
  if (!selectedConnectionForLogs.value) return;
  if (!confirm("确定要清除此连接的所有日志吗？")) return;
  
  try {
    await api.delete(`/im/${selectedConnectionForLogs.value.id}/logs`);
    logs.value = [];
  } catch (error) {
    console.error("清除日志失败:", error);
  }
}

// 获取日志类型样式
function getLogTypeStyle(type: string) {
  switch (type) {
    case "connect":
      return "success";
    case "disconnect":
      return "warning";
    case "test":
      return "info";
    case "error":
      return "danger";
    default:
      return "";
  }
}

// 获取日志类型文本
function getLogTypeText(type: string) {
  switch (type) {
    case "connect":
      return "连接";
    case "disconnect":
      return "断开";
    case "test":
      return "测试";
    case "error":
      return "错误";
    case "message":
      return "消息";
    default:
      return type;
  }
}

function getStatusType(status: string) {
  switch (status) {
    case "connected":
      return "success";
    case "error":
      return "danger";
    default:
      return "info";
  }
}

function getStatusText(status: string) {
  switch (status) {
    case "connected":
      return "已连接";
    case "error":
      return "连接错误";
    default:
      return "未连接";
  }
}

function getPlatformLabel(platform: string) {
  return platforms.find(p => p.value === platform)?.label || platform;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleString();
}
</script>

<template>
  <DashboardLayout>
    <div class="im-page">
      <div class="page-header">
        <h2>IM 平台管理</h2>
        <tiny-button type="primary" icon="plus" @click="openCreateDialog">
          添加连接
        </tiny-button>
      </div>

      <!-- 平台支持 -->
      <tiny-card class="platforms-card">
        <template #header>
          <h3>支持的平台</h3>
        </template>
        <div class="platforms-grid">
          <div v-for="platform in platforms" :key="platform.value" class="platform-item">
            <tiny-icon :name="platform.icon" />
            <span>{{ platform.label }}</span>
          </div>
        </div>
      </tiny-card>

      <!-- 连接列表 -->
      <tiny-card class="connections-card">
        <template #header>
          <h3>已配置连接</h3>
        </template>
        <tiny-grid :data="connections" :loading="loading" auto-resize>
          <tiny-grid-column field="name" title="名称" />
          <tiny-grid-column field="platform" title="平台" width="100">
            <template #default="{ row }">
              <tiny-tag>{{ getPlatformLabel(row.platform) }}</tiny-tag>
            </template>
          </tiny-grid-column>
          <tiny-grid-column field="status" title="状态" width="100">
            <template #default="{ row }">
              <tiny-tag :type="getStatusType(row.status)">
                {{ getStatusText(row.status) }}
              </tiny-tag>
            </template>
          </tiny-grid-column>
          <tiny-grid-column field="updatedAt" title="最后更新" width="180">
            <template #default="{ row }">
              {{ formatDate(row.updatedAt) }}
            </template>
          </tiny-grid-column>
          <tiny-grid-column title="操作" width="300">
            <template #default="{ row }">
              <div class="action-buttons">
                <!-- 测试按钮 -->
                <tiny-button
                  size="mini"
                  :loading="testingConnection === row.id"
                  @click="testConnection(row)"
                >
                  测试
                </tiny-button>
                <!-- 测试结果提示 -->
                <tiny-tooltip v-if="testResults.get(row.id)" :content="testResults.get(row.id)?.message">
                  <tiny-tag
                    :type="testResults.get(row.id)?.success ? 'success' : 'danger'"
                    size="small"
                  >
                    {{ testResults.get(row.id)?.latency }}ms
                  </tiny-tag>
                </tiny-tooltip>
                <!-- 连接/断开按钮 -->
                <tiny-button
                  v-if="row.status !== 'connected'"
                  size="mini"
                  type="primary"
                  @click="connectIM(row)"
                >
                  连接
                </tiny-button>
                <tiny-button
                  v-else
                  size="mini"
                  type="warning"
                  @click="disconnectIM(row)"
                >
                  断开
                </tiny-button>
                <!-- 日志按钮 -->
                <tiny-button size="mini" @click="viewLogs(row)">日志</tiny-button>
                <!-- 编辑按钮 -->
                <tiny-button size="mini" @click="openEditDialog(row)">编辑</tiny-button>
                <!-- 删除按钮 -->
                <tiny-button size="mini" type="danger" @click="deleteConnection(row.id)">
                  删除
                </tiny-button>
              </div>
            </template>
          </tiny-grid-column>
        </tiny-grid>

        <tiny-empty v-if="!loading && connections.length === 0" description="暂无连接配置" />
      </tiny-card>

      <!-- 添加/编辑对话框 -->
      <tiny-dialog
        v-model="dialogVisible"
        :title="editingConnection ? '编辑连接' : '添加连接'"
        width="500px"
      >
        <tiny-form label-width="80px">
          <tiny-form-item label="平台">
            <tiny-select 
              v-model="form.platform" 
              placeholder="选择平台"
              :disabled="!!editingConnection"
            >
              <tiny-option
                v-for="platform in platforms"
                :key="platform.value"
                :label="platform.label"
                :value="platform.value"
              />
            </tiny-select>
          </tiny-form-item>
          <tiny-form-item label="名称">
            <tiny-input v-model="form.name" placeholder="连接名称" />
          </tiny-form-item>

          <!-- 根据平台显示不同配置项 -->
          <template v-if="form.platform === 'telegram'">
            <tiny-form-item label="Bot Token">
              <tiny-input v-model="form.config.botToken" placeholder="Telegram Bot Token" />
            </tiny-form-item>
          </template>

          <template v-else-if="form.platform === 'discord'">
            <tiny-form-item label="Bot Token">
              <tiny-input v-model="form.config.botToken" placeholder="Discord Bot Token" />
            </tiny-form-item>
          </template>

          <template v-else-if="form.platform === 'slack'">
            <tiny-form-item label="Bot Token">
              <tiny-input v-model="form.config.botToken" placeholder="Slack Bot Token" />
            </tiny-form-item>
            <tiny-form-item label="App Token">
              <tiny-input v-model="form.config.appToken" placeholder="Slack App Token" />
            </tiny-form-item>
          </template>

          <template v-else-if="form.platform === 'dingtalk'">
            <tiny-form-item label="Webhook URL">
              <tiny-input v-model="form.config.webhookUrl" placeholder="钉钉 Webhook URL" />
            </tiny-form-item>
            <tiny-form-item label="Secret">
              <tiny-input v-model="form.config.secret" placeholder="钉钉签名密钥" />
            </tiny-form-item>
          </template>

          <template v-else-if="form.platform === 'feishu'">
            <tiny-form-item label="App ID">
              <tiny-input v-model="form.config.appId" placeholder="飞书 App ID" />
            </tiny-form-item>
            <tiny-form-item label="App Secret">
              <tiny-input v-model="form.config.appSecret" placeholder="飞书 App Secret" />
            </tiny-form-item>
          </template>

          <template v-else-if="form.platform === 'xiaoyi'">
            <tiny-form-item label="Access Key">
              <tiny-input v-model="form.config.ak" placeholder="华为小艺 Access Key" />
            </tiny-form-item>
            <tiny-form-item label="Secret Key">
              <tiny-input v-model="form.config.sk" placeholder="华为小艺 Secret Key" />
            </tiny-form-item>
            <tiny-form-item label="Agent ID">
              <tiny-input v-model="form.config.agentId" placeholder="Agent ID" />
            </tiny-form-item>
          </template>

          <template v-else-if="form.platform === 'qq'">
            <tiny-form-item label="HTTP URL">
              <tiny-input v-model="form.config.httpUrl" placeholder="OneBot HTTP URL" />
            </tiny-form-item>
            <tiny-form-item label="WS URL">
              <tiny-input v-model="form.config.wsUrl" placeholder="OneBot WebSocket URL" />
            </tiny-form-item>
          </template>

          <template v-else-if="form.platform === 'email'">
            <tiny-form-item label="IMAP Host">
              <tiny-input v-model="form.config.imapHost" placeholder="IMAP 服务器地址" />
            </tiny-form-item>
            <tiny-form-item label="IMAP Port">
              <tiny-input v-model="form.config.imapPort" placeholder="IMAP 端口" />
            </tiny-form-item>
            <tiny-form-item label="SMTP Host">
              <tiny-input v-model="form.config.smtpHost" placeholder="SMTP 服务器地址" />
            </tiny-form-item>
            <tiny-form-item label="SMTP Port">
              <tiny-input v-model="form.config.smtpPort" placeholder="SMTP 端口" />
            </tiny-form-item>
            <tiny-form-item label="Username">
              <tiny-input v-model="form.config.username" placeholder="邮箱账号" />
            </tiny-form-item>
            <tiny-form-item label="Password">
              <tiny-input v-model="form.config.password" type="password" placeholder="邮箱密码/授权码" />
            </tiny-form-item>
          </template>

          <template v-else-if="form.platform === 'wechat'">
            <tiny-form-item label="WS URL">
              <tiny-input v-model="form.config.wsUrl" placeholder="WebSocket 服务地址" />
            </tiny-form-item>
          </template>

          <template v-else-if="form.platform === 'whatsapp'">
            <tiny-form-item label="API URL">
              <tiny-input v-model="form.config.apiUrl" placeholder="WhatsApp API 地址" />
            </tiny-form-item>
          </template>
        </tiny-form>

        <template #footer>
          <tiny-button @click="dialogVisible = false">取消</tiny-button>
          <tiny-button type="primary" :loading="saving" @click="saveConnection">保存</tiny-button>
        </template>
      </tiny-dialog>

      <!-- 日志对话框 -->
      <tiny-dialog
        v-model="logsDialogVisible"
        :title="`${selectedConnectionForLogs?.name || '连接'} - 日志`"
        width="800px"
      >
        <div class="logs-header">
          <span class="logs-count">共 {{ logs.length }} 条日志</span>
          <tiny-button size="mini" type="danger" @click="clearLogs">清除日志</tiny-button>
        </div>
        
        <tiny-grid :data="logs" :loading="logsLoading" max-height="400px">
          <tiny-grid-column field="type" title="类型" width="80">
            <template #default="{ row }">
              <tiny-tag :type="getLogTypeStyle(row.type)" size="small">
                {{ getLogTypeText(row.type) }}
              </tiny-tag>
            </template>
          </tiny-grid-column>
          <tiny-grid-column field="message" title="消息" />
          <tiny-grid-column field="timestamp" title="时间" width="180">
            <template #default="{ row }">
              {{ formatDate(row.timestamp) }}
            </template>
          </tiny-grid-column>
        </tiny-grid>

        <tiny-empty v-if="!logsLoading && logs.length === 0" description="暂无日志" />

        <template #footer>
          <tiny-button @click="logsDialogVisible = false">关闭</tiny-button>
        </template>
      </tiny-dialog>
    </div>
  </DashboardLayout>
</template>

<style scoped>
.im-page {
  max-width: 1200px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.page-header h2 {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
}

.platforms-card {
  margin-bottom: 24px;
  border-radius: 12px;
}

.platforms-card h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.platforms-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 16px;
}

.platform-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 16px;
  background: #f9fafb;
  border-radius: 8px;
  font-size: 14px;
}

.dark .platform-item {
  background: #374151;
}

.connections-card {
  border-radius: 12px;
}

.connections-card h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.action-buttons {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.logs-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.logs-count {
  color: #6b7280;
  font-size: 14px;
}
</style>
