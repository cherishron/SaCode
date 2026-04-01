<script setup lang="ts">
import { ref, nextTick, onMounted, onUnmounted, computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import DashboardLayout from "./DashboardLayout.vue";
import MessageRenderer from "@/components/MessageRenderer.vue";
import { api } from "@/lib/api";
import { getWebSocketClient, type WebSocketStatus, type ChatMessage, type IMStatusMessage, type IMLogMessage } from "@/lib/websocket";

interface Model {
  id: string;
  name: string;
  provider: string;
  modelId: string;
  capabilities?: string[];
  isDefault?: boolean;
  enabled?: boolean;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  isStreaming?: boolean;
}

interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

const route = useRoute();
const router = useRouter();

const sessions = ref<Session[]>([]);
const messages = ref<Message[]>([]);
const currentSessionId = ref<string | null>(null);
const inputMessage = ref("");
const loading = ref(false);
const sessionsLoading = ref(false);
const messagesContainer = ref<HTMLElement | null>(null);
const showSidebar = ref(true);
const wsStatus = ref<WebSocketStatus>("disconnected");
const useStreaming = ref(true);

// 模型相关
const models = ref<Model[]>([]);
const currentModel = ref<Model | null>(null);
const modelSelectorVisible = ref(false);

// 搜索相关
const searchDialogVisible = ref(false);
const searchQuery = ref("");
const searchResults = ref<Array<Message & { session?: { id: string; title: string } }>>([]);
const searchLoading = ref(false);
const searchTotal = ref(0);

// 流式消息 ID
let streamingMessageId: string | null = null;

const currentSession = computed(() =>
  sessions.value.find((s) => s.id === currentSessionId.value)
);

// WebSocket 客户端
const wsClient = getWebSocketClient();

// WebSocket 消息处理
let unsubscribeMessage: (() => void) | null = null;
let unsubscribeStatus: (() => void) | null = null;

onMounted(async () => {
  // 设置 WebSocket 监听
  unsubscribeMessage = wsClient.onMessage(handleWsMessage);
  unsubscribeStatus = wsClient.onStatusChange((status) => {
    wsStatus.value = status;
  });

  // 连接 WebSocket
  if (useStreaming.value) {
    try {
      await wsClient.connect();
      // 获取用户 ID 并订阅
      const userStr = localStorage.getItem("user");
      if (userStr) {
        const user = JSON.parse(userStr) as { id: string };
        wsClient.subscribe(user.id);
      }
    } catch (error) {
      console.error("WebSocket connection failed:", error);
      useStreaming.value = false;
    }
  }

  await Promise.all([loadSessions(), loadModels()]);

  const sessionId = route.query.id as string;
  if (sessionId) {
    await selectSession(sessionId);
  } else if (sessions.value.length > 0 && sessions.value[0]) {
    await selectSession(sessions.value[0].id);
  }
});

onUnmounted(() => {
  if (unsubscribeMessage) unsubscribeMessage();
  if (unsubscribeStatus) unsubscribeStatus();
  wsClient.disconnect();
});

// 监听路由变化
watch(
  () => route.query.id,
  async (newId) => {
    if (newId && typeof newId === "string" && newId !== currentSessionId.value) {
      await selectSession(newId);
    }
  }
);

function handleWsMessage(message: ChatMessage | IMStatusMessage | IMLogMessage): void {
  // 只处理 chat 类型消息
  if (!("type" in message) || !message.type.startsWith("chat:")) {
    return;
  }
  
  const chatMsg = message as ChatMessage;
  if (chatMsg.type === "chat:message" && streamingMessageId) {
    // 更新流式消息内容
    const msgIndex = messages.value.findIndex((m) => m.id === streamingMessageId);
    if (msgIndex !== -1 && messages.value[msgIndex]) {
      const content = chatMsg.content || chatMsg.message || "";
      messages.value[msgIndex].content += content;
    }
  } else if (chatMsg.type === "chat:complete") {
    // 流式消息完成
    if (streamingMessageId) {
      const msgIndex = messages.value.findIndex((m) => m.id === streamingMessageId);
      if (msgIndex !== -1 && messages.value[msgIndex]) {
        messages.value[msgIndex].isStreaming = false;
      }
    }
    streamingMessageId = null;
    loading.value = false;
  } else if (chatMsg.type === "chat:error") {
    console.error("Chat error:", chatMsg.error);
    loading.value = false;
    streamingMessageId = null;
  }

  nextTick(scrollToBottom);
}

async function loadSessions() {
  sessionsLoading.value = true;
  try {
    const data = await api.get<Session[]>("/chat/sessions");
    sessions.value = data;
  } catch (error) {
    console.error("加载会话列表失败:", error);
  } finally {
    sessionsLoading.value = false;
  }
}

async function loadModels() {
  try {
    const data = await api.get<Model[]>("/models");
    models.value = data;
    
    // 设置默认模型
    const defaultModel = data.find(m => m.isDefault) || data[0];
    if (defaultModel) {
      currentModel.value = defaultModel;
    }
  } catch (error) {
    console.error("加载模型列表失败:", error);
  }
}

async function selectModel(modelId: string) {
  const model = models.value.find(m => m.id === modelId);
  if (!model) return;
  
  try {
    await api.post("/models/switch", {
      modelId,
      sessionId: currentSessionId.value,
    });
    currentModel.value = model;
    modelSelectorVisible.value = false;
  } catch (error) {
    console.error("切换模型失败:", error);
  }
}

async function loadSessionModel(sessionId: string) {
  try {
    const model = await api.get<Model>(`/models/session/${sessionId}`);
    currentModel.value = model;
  } catch {
    // 使用默认模型
    const defaultModel = models.value.find(m => m.isDefault) || models.value[0];
    if (defaultModel) {
      currentModel.value = defaultModel;
    }
  }
}

async function selectSession(sessionId: string) {
  currentSessionId.value = sessionId;
  messages.value = [];

  try {
    const data = await api.get<Message[]>(`/chat/sessions/${sessionId}/messages`);
    messages.value = data;

    // 加载会话关联的模型
    await loadSessionModel(sessionId);

    router.replace({ query: { id: sessionId } });

    await nextTick();
    scrollToBottom();
  } catch (error) {
    console.error("加载消息失败:", error);
  }
}

async function createSession() {
  try {
    const session = await api.post<Session>("/chat/sessions", {
      title: "新对话",
    });
    sessions.value.unshift(session);
    await selectSession(session.id);
  } catch (error) {
    console.error("创建会话失败:", error);
  }
}

async function deleteSession(sessionId: string) {
  try {
    await api.delete(`/chat/sessions/${sessionId}`);
    sessions.value = sessions.value.filter((s) => s.id !== sessionId);

    if (currentSessionId.value === sessionId) {
      currentSessionId.value = null;
      messages.value = [];
      router.replace({ query: {} });

      if (sessions.value.length > 0 && sessions.value[0]) {
        await selectSession(sessions.value[0].id);
      }
    }
  } catch (error) {
    console.error("删除会话失败:", error);
  }
}

// 导出会话
function exportSession(format: "markdown" | "json") {
  if (!currentSession.value || messages.value.length === 0) return;
  
  const session = currentSession.value;
  const sessionMessages = messages.value;
  
  if (format === "markdown") {
    exportAsMarkdown(session, sessionMessages);
  } else {
    exportAsJSON(session, sessionMessages);
  }
}

function exportAsMarkdown(session: Session, msgs: Message[]) {
  const lines: string[] = [
    `# ${session.title || "未命名会话"}`,
    "",
    `> 导出时间: ${new Date().toLocaleString()}`,
    `> 会话 ID: ${session.id}`,
    "",
    "---",
    "",
  ];
  
  for (const msg of msgs) {
    const role = msg.role === "user" ? "**用户**" : "**AI 助手**";
    const time = new Date(msg.createdAt).toLocaleString();
    
    lines.push(`### ${role}`);
    lines.push(`> ${time}`);
    lines.push("");
    lines.push(msg.content);
    lines.push("");
    lines.push("---");
    lines.push("");
  }
  
  const content = lines.join("\n");
  downloadFile(content, `${session.title || "会话"}.md`, "text/markdown");
}

function exportAsJSON(session: Session, msgs: Message[]) {
  const exportData = {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    session: {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    },
    messages: msgs.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
    })),
  };
  
  const content = JSON.stringify(exportData, null, 2);
  downloadFile(content, `${session.title || "会话"}.json`, "application/json");
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// 停止生成
function stopGeneration() {
  loading.value = false;
  streamingMessageId = null;
  
  // 标记最后一条 AI 消息为非流式
  const lastAssistantMessage = [...messages.value].reverse().find(m => m.role === "assistant");
  if (lastAssistantMessage) {
    lastAssistantMessage.isStreaming = false;
    if (!lastAssistantMessage.content) {
      lastAssistantMessage.content = "[生成已停止]";
    }
  }
  
  // 断开并重新连接 WebSocket 以中断流式输出
  if (wsClient.isConnected()) {
    wsClient.disconnect();
    wsClient.connect().catch(console.error);
  }
}

async function sendMessage() {
  if (!inputMessage.value.trim() || loading.value) return;

  const userInput = inputMessage.value.trim();
  inputMessage.value = "";

  // 添加用户消息
  const userMessage: Message = {
    id: `temp-${Date.now()}`,
    role: "user",
    content: userInput,
    createdAt: new Date().toISOString(),
  };
  messages.value.push(userMessage);

  loading.value = true;
  await nextTick();
  scrollToBottom();

  // 创建 AI 响应消息（流式）
  const aiMessageId = `ai-${Date.now()}`;
  streamingMessageId = aiMessageId;
  const aiMessage: Message = {
    id: aiMessageId,
    role: "assistant",
    content: "",
    createdAt: new Date().toISOString(),
    isStreaming: true,
  };
  messages.value.push(aiMessage);

  if (useStreaming.value && wsClient.isConnected()) {
    // 流式发送
    wsClient.sendChatMessage(userInput, currentSessionId.value ?? undefined);
  } else {
    // HTTP 回退
    try {
      const response = await api.post<{ success: boolean; responses: unknown[] }>("/chat", {
        message: userInput,
        sessionId: currentSessionId.value,
      });

      if (response.success && response.responses) {
        const lastResponse = response.responses[response.responses.length - 1];
        const msgIndex = messages.value.findIndex((m) => m.id === aiMessageId);
        if (msgIndex !== -1 && messages.value[msgIndex]) {
          messages.value[msgIndex].content =
            typeof lastResponse === "string" ? lastResponse : JSON.stringify(lastResponse, null, 2);
          messages.value[msgIndex].isStreaming = false;
        }
      }
    } catch (error) {
      console.error("发送消息失败:", error);
      const msgIndex = messages.value.findIndex((m) => m.id === aiMessageId);
      if (msgIndex !== -1 && messages.value[msgIndex]) {
        messages.value[msgIndex].content = "抱歉，发送消息时出现错误。请稍后重试。";
        messages.value[msgIndex].isStreaming = false;
      }
    } finally {
      loading.value = false;
      streamingMessageId = null;
    }

    await nextTick();
    scrollToBottom();
  }
}

function scrollToBottom() {
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  }
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString();
}

function formatDate(dateStr: string) {
  const date = new Date(dateStr);
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();

  if (isToday) {
    return date.toLocaleTimeString();
  }
  return date.toLocaleDateString();
}

async function updateSessionTitle(sessionId: string) {
  const session = sessions.value.find((s) => s.id === sessionId);
  if (!session) return;

  const newTitle = prompt("输入新标题:", session.title);
  if (newTitle && newTitle !== session.title) {
    try {
      await api.patch(`/chat/sessions/${sessionId}`, { title: newTitle });
      session.title = newTitle;
    } catch (error) {
      console.error("更新标题失败:", error);
    }
  }
}

function handleKeydown(event: KeyboardEvent) {
  // Ctrl/Cmd + F 打开搜索
  if ((event.ctrlKey || event.metaKey) && event.key === "f") {
    event.preventDefault();
    openSearch();
    return;
  }
  
  // Ctrl/Cmd + N 新建会话
  if ((event.ctrlKey || event.metaKey) && event.key === "n") {
    event.preventDefault();
    createSession();
    return;
  }
  
  // Escape 关闭搜索对话框
  if (event.key === "Escape" && searchDialogVisible.value) {
    event.preventDefault();
    searchDialogVisible.value = false;
    return;
  }
  
  // Enter 发送消息（非搜索模式下）
  if (event.key === "Enter" && !event.shiftKey && !searchDialogVisible.value) {
    event.preventDefault();
    sendMessage();
  }
}

// 搜索相关函数
function openSearch() {
  searchDialogVisible.value = true;
  searchQuery.value = "";
  searchResults.value = [];
}

async function performSearch() {
  if (!searchQuery.value.trim()) {
    searchResults.value = [];
    return;
  }
  
  searchLoading.value = true;
  try {
    const params = new URLSearchParams({
      q: searchQuery.value,
      limit: "50",
    });
    const response = await api.get<{
      messages: Array<Message & { session?: { id: string; title: string } }>;
      total: number;
      query: string;
    }>(`/chat/search?${params.toString()}`);
    
    searchResults.value = response.messages;
    searchTotal.value = response.total;
  } catch (error) {
    console.error("搜索失败:", error);
  } finally {
    searchLoading.value = false;
  }
}

async function goToSearchResult(result: Message & { session?: { id: string; title: string } }) {
  searchDialogVisible.value = false;
  
  // 如果消息不在当前会话，切换到对应会话
  if (result.session?.id && result.session.id !== currentSessionId.value) {
    await selectSession(result.session.id);
  }
  
  // 滚动到消息位置（简单实现：滚动到底部）
  await nextTick();
  scrollToBottom();
}

function highlightText(text: string, query: string): string {
  if (!query) return text;
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  return text.replace(regex, '<mark class="highlight">$1</mark>');
}
</script>

<template>
  <DashboardLayout>
    <div class="chat-page">
      <div class="chat-container">
        <!-- 侧边栏 - 会话列表 -->
        <div v-if="showSidebar" class="sidebar">
          <div class="sidebar-header">
            <h3>对话列表</h3>
            <tiny-button type="primary" size="small" icon="plus" @click="createSession">
              新对话
            </tiny-button>
          </div>

          <div class="sessions-list">
            <tiny-skeleton v-if="sessionsLoading" :rows="3" animated />

            <div
              v-for="session in sessions"
              :key="session.id"
              class="session-item"
              :class="{ active: session.id === currentSessionId }"
              @click="selectSession(session.id)"
            >
              <div class="session-info" @dblclick="updateSessionTitle(session.id)">
                <div class="session-title">{{ session.title || "新对话" }}</div>
                <div class="session-time">{{ formatDate(session.updatedAt) }}</div>
              </div>
              <tiny-button
                size="mini"
                type="text"
                icon="delete"
                @click.stop="deleteSession(session.id)"
              />
            </div>

            <tiny-empty v-if="!sessionsLoading && sessions.length === 0" description="暂无对话" />
          </div>
        </div>

        <!-- 主聊天区域 -->
        <div class="chat-main">
          <div class="chat-header">
            <tiny-button
              size="small"
              :icon="showSidebar ? 'chevron-left' : 'chevron-right'"
              @click="showSidebar = !showSidebar"
            />
            <h3>{{ currentSession?.title || "新对话" }}</h3>
            
            <!-- 模型选择器 -->
            <div class="model-selector">
              <tiny-dropdown trigger="click" @command="selectModel">
                <tiny-button size="small" type="text">
                  <tiny-icon name="robot" />
                  <span class="model-name">{{ currentModel?.name || '选择模型' }}</span>
                  <tiny-icon name="chevron-down" />
                </tiny-button>
                <template #dropdown>
                  <tiny-dropdown-menu>
                    <tiny-dropdown-item
                      v-for="model in models"
                      :key="model.id"
                      :command="model.id"
                      :class="{ 'is-active': model.id === currentModel?.id }"
                    >
                      <div class="model-option">
                        <span class="model-label">{{ model.name }}</span>
                        <tiny-tag v-if="model.isDefault" size="small" type="success">默认</tiny-tag>
                      </div>
                    </tiny-dropdown-item>
                  </tiny-dropdown-menu>
                </template>
              </tiny-dropdown>
            </div>
            
            <!-- 搜索按钮 -->
            <tiny-button size="small" type="text" @click="openSearch" title="搜索 (Ctrl+F)">
              <tiny-icon name="search" />
            </tiny-button>
            
            <!-- 导出按钮 -->
            <tiny-dropdown trigger="click" @command="exportSession">
              <tiny-button size="small" type="text" title="导出会话">
                <tiny-icon name="download" />
              </tiny-button>
              <template #dropdown>
                <tiny-dropdown-menu>
                  <tiny-dropdown-item command="markdown">
                    <tiny-icon name="document" />
                    导出为 Markdown
                  </tiny-dropdown-item>
                  <tiny-dropdown-item command="json">
                    <tiny-icon name="code" />
                    导出为 JSON
                  </tiny-dropdown-item>
                </tiny-dropdown-menu>
              </template>
            </tiny-dropdown>
            
            <div class="header-status">
              <span
                class="status-dot"
                :class="{
                  connected: wsStatus === 'connected',
                  disconnected: wsStatus !== 'connected',
                }"
              />
              <span class="status-text">
                {{ wsStatus === "connected" ? "已连接" : "离线" }}
              </span>
            </div>
          </div>

          <!-- 消息列表 -->
          <div ref="messagesContainer" class="messages">
            <div v-if="messages.length === 0" class="empty-state">
              <tiny-empty description="开始新的对话" />
              <p class="hint">输入消息开始与 AI 助手对话</p>
            </div>

            <div v-for="message in messages" :key="message.id" class="message" :class="message.role">
              <div class="message-avatar">
                <tiny-avatar v-if="message.role === 'user'" icon="user" size="small" />
                <tiny-avatar v-else icon="robot" size="small" style="background: #f97316" />
              </div>
              <div class="message-content">
                <div class="message-header">
                  <span class="message-role">
                    {{ message.role === "user" ? "你" : "AI 助手" }}
                  </span>
                  <span class="message-time">
                    {{ formatTime(message.createdAt) }}
                  </span>
                </div>
                <div class="message-text">
                  <MessageRenderer
                    v-if="message.content"
                    :content="message.content"
                    :role="message.role"
                  />
                  <div v-if="message.isStreaming" class="typing-indicator">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                </div>
              </div>
            </div>

            <div v-if="loading && !streamingMessageId" class="message assistant">
              <div class="message-avatar">
                <tiny-avatar icon="robot" size="small" style="background: #f97316" />
              </div>
              <div class="message-content">
                <div class="typing-indicator">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>
            </div>
          </div>

          <!-- 输入区域 -->
          <div class="input-area">
            <div class="input-wrapper">
              <tiny-input
                v-model="inputMessage"
                type="textarea"
                :rows="1"
                :autosize="{ minRows: 1, maxRows: 4 }"
                placeholder="输入消息... (Shift+Enter 换行，Enter 发送)"
                @keydown="handleKeydown"
              />
              <div class="input-actions">
                <!-- 停止生成按钮 -->
                <tiny-button
                  v-if="loading"
                  type="danger"
                  @click="stopGeneration"
                >
                  <tiny-icon name="close" />
                  停止生成
                </tiny-button>
                <!-- 发送按钮 -->
                <tiny-button
                  v-else
                  type="primary"
                  :disabled="!inputMessage.trim()"
                  @click="sendMessage"
                >
                  发送
                </tiny-button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 搜索对话框 -->
    <tiny-dialog
      v-model="searchDialogVisible"
      title="搜索消息"
      width="600px"
      :close-on-click-modal="false"
    >
      <div class="search-container">
        <tiny-input
          v-model="searchQuery"
          placeholder="输入搜索关键词..."
          size="large"
          clearable
          @keyup.enter="performSearch"
        >
          <template #prefix>
            <tiny-icon name="search" />
          </template>
        </tiny-input>
        
        <div class="search-tip">
          <tiny-icon name="info" />
          <span>按 Enter 搜索，Ctrl+F 打开搜索</span>
        </div>
        
        <tiny-divider />
        
        <div v-if="searchLoading" class="search-loading">
          <tiny-skeleton :rows="3" animated />
        </div>
        
        <div v-else-if="searchResults.length > 0" class="search-results">
          <div class="search-meta">
            找到 {{ searchTotal }} 条结果
          </div>
          
          <div
            v-for="result in searchResults"
            :key="result.id"
            class="search-result-item"
            @click="goToSearchResult(result)"
          >
            <div class="result-header">
              <tiny-tag :type="result.role === 'user' ? 'info' : 'success'" size="small">
                {{ result.role === 'user' ? '用户' : 'AI' }}
              </tiny-tag>
              <span class="result-session">{{ result.session?.title || '未知会话' }}</span>
              <span class="result-time">{{ formatTime(result.createdAt) }}</span>
            </div>
            <div class="result-content" v-html="highlightText(result.content.slice(0, 200), searchQuery)"></div>
          </div>
        </div>
        
        <tiny-empty
          v-else-if="searchQuery && !searchLoading"
          description="未找到匹配的消息"
        />
      </div>

      <template #footer>
        <tiny-button @click="searchDialogVisible = false">关闭</tiny-button>
        <tiny-button type="primary" :loading="searchLoading" @click="performSearch">
          搜索
        </tiny-button>
      </template>
    </tiny-dialog>
  </DashboardLayout>
</template>

<style scoped>
.chat-page {
  height: calc(100vh - 64px - 48px);
  display: flex;
  flex-direction: column;
}

.chat-container {
  flex: 1;
  display: flex;
  background: white;
  border-radius: 12px;
  overflow: hidden;
}

.dark .chat-container {
  background: #1f2937;
}

.sidebar {
  width: 280px;
  border-right: 1px solid #e5e7eb;
  display: flex;
  flex-direction: column;
}

.dark .sidebar {
  border-right-color: #374151;
}

.sidebar-header {
  padding: 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #e5e7eb;
}

.dark .sidebar-header {
  border-bottom-color: #374151;
}

.sidebar-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.sessions-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.session-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s;
}

.session-item:hover {
  background: #f3f4f6;
}

.dark .session-item:hover {
  background: #374151;
}

.session-item.active {
  background: #fff7ed;
}

.dark .session-item.active {
  background: #431407;
}

.session-info {
  flex: 1;
  min-width: 0;
}

.session-title {
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-time {
  font-size: 12px;
  color: #9ca3af;
  margin-top: 4px;
}

.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.chat-header {
  padding: 12px 16px;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  align-items: center;
  gap: 12px;
}

.dark .chat-header {
  border-bottom-color: #374151;
}

.chat-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  flex: 1;
}

.model-selector {
  display: flex;
  align-items: center;
  margin-left: 12px;
}

.model-selector .model-name {
  margin: 0 4px;
  font-size: 14px;
}

.model-option {
  display: flex;
  align-items: center;
  gap: 8px;
}

.model-label {
  font-size: 14px;
}

.header-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #6b7280;
  margin-left: 12px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.status-dot.connected {
  background: #22c55e;
}

.status-dot.disconnected {
  background: #9ca3af;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.hint {
  color: #6b7280;
  font-size: 14px;
  margin-top: 8px;
}

.message {
  display: flex;
  gap: 12px;
  margin-bottom: 24px;
}

.message.user {
  flex-direction: row-reverse;
}

.message-avatar {
  flex-shrink: 0;
}

.message-content {
  max-width: 70%;
}

.message.user .message-content {
  align-items: flex-end;
}

.message-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.message.user .message-header {
  flex-direction: row-reverse;
}

.message-role {
  font-size: 12px;
  font-weight: 500;
  color: #374151;
}

.dark .message-role {
  color: #e5e7eb;
}

.message-time {
  font-size: 11px;
  color: #9ca3af;
}

.message-text {
  padding: 12px 16px;
  border-radius: 12px;
  background: #f3f4f6;
  line-height: 1.6;
}

.dark .message-text {
  background: #374151;
}

.message.user .message-text {
  background: #f97316;
  color: white;
}

.typing-indicator {
  display: flex;
  gap: 4px;
  padding: 4px 0;
}

.typing-indicator span {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #9ca3af;
  animation: typing 1.4s infinite ease-in-out both;
}

.typing-indicator span:nth-child(1) {
  animation-delay: -0.32s;
}

.typing-indicator span:nth-child(2) {
  animation-delay: -0.16s;
}

@keyframes typing {
  0%,
  80%,
  100% {
    transform: scale(0);
  }
  40% {
    transform: scale(1);
  }
}

.input-area {
  border-top: 1px solid #e5e7eb;
  padding: 16px 24px;
  background: #fafafa;
}

.dark .input-area {
  border-top-color: #374151;
  background: #111827;
}

.input-wrapper {
  display: flex;
  gap: 12px;
  align-items: flex-end;
}

.input-wrapper :deep(.tiny-textarea) {
  flex: 1;
}

.input-actions {
  display: flex;
  gap: 8px;
}

/* 搜索对话框样式 */
.search-container {
  padding: 8px 0;
}

.search-tip {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 12px;
  color: #6b7280;
}

.search-loading {
  padding: 16px 0;
}

.search-results {
  max-height: 400px;
  overflow-y: auto;
}

.search-meta {
  font-size: 13px;
  color: #6b7280;
  margin-bottom: 12px;
}

.search-result-item {
  padding: 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.2s;
  margin-bottom: 8px;
  background: #f9fafb;
}

.dark .search-result-item {
  background: #374151;
}

.search-result-item:hover {
  background: #f3f4f6;
}

.dark .search-result-item:hover {
  background: #4b5563;
}

.result-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.result-session {
  font-size: 13px;
  color: #374151;
  font-weight: 500;
}

.dark .result-session {
  color: #e5e7eb;
}

.result-time {
  font-size: 12px;
  color: #9ca3af;
  margin-left: auto;
}

.result-content {
  font-size: 14px;
  color: #4b5563;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dark .result-content {
  color: #d1d5db;
}

.result-content :deep(.highlight) {
  background: #fef08a;
  padding: 0 2px;
  border-radius: 2px;
}

.dark .result-content :deep(.highlight) {
  background: #854d0e;
}
</style>
