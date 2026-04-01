<template>
  <div class="agents-page">
    <!-- 页面标题和操作栏 -->
    <div class="page-header">
      <h1>Agent 监控</h1>
      <div class="header-actions">
        <t-button theme="primary" @click="showCreateDialog = true">
          <template #icon><add-icon /></template>
          创建 Agent
        </t-button>
        <t-button variant="outline" @click="refreshAgents">
          <template #icon><refresh-icon /></template>
          刷新
        </t-button>
      </div>
    </div>

    <!-- 统计卡片 -->
    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-value">{{ stats.total }}</div>
        <div class="stat-label">总 Agent</div>
      </div>
      <div class="stat-card running">
        <div class="stat-value">{{ stats.running }}</div>
        <div class="stat-label">运行中</div>
      </div>
      <div class="stat-card ready">
        <div class="stat-value">{{ stats.ready }}</div>
        <div class="stat-label">就绪</div>
      </div>
      <div class="stat-card completed">
        <div class="stat-value">{{ stats.completed }}</div>
        <div class="stat-label">已完成</div>
      </div>
      <div class="stat-card failed">
        <div class="stat-value">{{ stats.failed }}</div>
        <div class="stat-label">失败</div>
      </div>
    </div>

    <!-- Agent 列表 -->
    <div class="agents-grid">
      <div
        v-for="agent in agents"
        :key="agent.agentId"
        class="agent-card"
        :class="agent.status"
        @click="viewAgent(agent)"
      >
        <div class="agent-header">
          <div class="agent-name">{{ agent.name || agent.agentId }}</div>
          <t-tag :theme="getStatusTheme(agent.status)" variant="light" size="small">
            {{ agent.status }}
          </t-tag>
        </div>

        <div class="agent-info">
          <div class="info-row">
            <span class="label">镜像:</span>
            <span class="value">{{ agent.image }}</span>
          </div>
          <div class="info-row">
            <span class="label">沙箱:</span>
            <span class="value">{{ agent.sandboxLevel }}</span>
          </div>
          <div class="info-row">
            <span class="label">创建:</span>
            <span class="value">{{ formatDate(agent.createdAt) }}</span>
          </div>
        </div>

        <!-- 资源使用进度条 -->
        <div v-if="agent.status === 'running' && agent.resourceUsage" class="resource-usage">
          <div class="usage-item">
            <span class="label">CPU</span>
            <t-progress
              :percentage="agent.resourceUsage.cpuPercent"
              :theme="agent.resourceUsage.cpuPercent > 80 ? 'danger' : 'default'"
              size="small"
            />
          </div>
          <div class="usage-item">
            <span class="label">内存</span>
            <t-progress
              :percentage="agent.resourceUsage.memoryPercent"
              :theme="agent.resourceUsage.memoryPercent > 80 ? 'danger' : 'default'"
              size="small"
            />
          </div>
        </div>

        <!-- 操作按钮 -->
        <div class="agent-actions" @click.stop>
          <t-button
            v-if="agent.status === 'running'"
            size="small"
            variant="text"
            theme="warning"
            @click="pauseAgent(agent)"
          >
            暂停
          </t-button>
          <t-button
            v-if="agent.status === 'paused'"
            size="small"
            variant="text"
            theme="success"
            @click="resumeAgent(agent)"
          >
            恢复
          </t-button>
          <t-button
            v-if="['running', 'paused'].includes(agent.status)"
            size="small"
            variant="text"
            theme="danger"
            @click="stopAgent(agent)"
          >
            停止
          </t-button>
          <t-button
            v-if="['completed', 'failed', 'stopped'].includes(agent.status)"
            size="small"
            variant="text"
            theme="danger"
            @click="removeAgent(agent)"
          >
            删除
          </t-button>
        </div>
      </div>
    </div>

    <!-- 创建 Agent 对话框 -->
    <t-dialog
      v-model:visible="showCreateDialog"
      header="创建 Agent"
      :width="600"
      :confirm-btn="{ content: '创建', loading: creating }"
      @confirm="createAgent"
    >
      <t-form :data="createForm" :rules="createRules" ref="createFormRef">
        <t-form-item label="Agent ID" name="agentId">
          <t-input v-model="createForm.agentId" placeholder="唯一标识符" />
        </t-form-item>
        <t-form-item label="名称">
          <t-input v-model="createForm.name" placeholder="可选显示名称" />
        </t-form-item>
        <t-form-item label="镜像">
          <t-input v-model="createForm.image" placeholder="默认 sacode/agent:latest" />
        </t-form-item>
        <t-form-item label="沙箱级别">
          <t-select v-model="createForm.sandboxLevel">
            <t-option value="strict" label="严格 - 最高安全，无网络" />
            <t-option value="moderate" label="适中 - 无网络，推荐" />
            <t-option value="permissive" label="宽松 - 有网络" />
          </t-select>
        </t-form-item>
        <t-form-item label="最大执行时间">
          <t-input-number v-model="createForm.maxExecutionTime" :min="10000" :max="3600000" :step="60000" />
          <span class="input-suffix">毫秒</span>
        </t-form-item>
        <t-form-item label="最大迭代次数">
          <t-input-number v-model="createForm.maxIterations" :min="1" :max="1000" />
        </t-form-item>
        <t-form-item label="允许的工具">
          <t-select v-model="createForm.allowedTools" multiple clearable placeholder="留空允许所有">
            <t-option value="read_file" label="读取文件" />
            <t-option value="write_file" label="写入文件" />
            <t-option value="execute_command" label="执行命令" />
            <t-option value="browser_navigate" label="浏览器导航" />
            <t-option value="http_request" label="HTTP 请求" />
          </t-select>
        </t-form-item>
      </t-form>
    </t-dialog>

    <!-- Agent 详情抽屉 -->
    <t-drawer
      v-model:visible="showDetailDrawer"
      :header="`Agent 详情 - ${selectedAgent?.name || selectedAgent?.agentId}`"
      size="large"
    >
      <div v-if="selectedAgent" class="agent-detail">
        <!-- 基本信息 -->
        <t-descriptions :column="2">
          <t-descriptions-item label="Agent ID">{{ selectedAgent.agentId }}</t-descriptions-item>
          <t-descriptions-item label="状态">
            <t-tag :theme="getStatusTheme(selectedAgent.status)">{{ selectedAgent.status }}</t-tag>
          </t-descriptions-item>
          <t-descriptions-item label="镜像">{{ selectedAgent.image }}</t-descriptions-item>
          <t-descriptions-item label="沙箱级别">{{ selectedAgent.sandboxLevel }}</t-descriptions-item>
          <t-descriptions-item label="创建时间">{{ formatDate(selectedAgent.createdAt) }}</t-descriptions-item>
          <t-descriptions-item label="最大迭代">{{ selectedAgent.maxIterations }}</t-descriptions-item>
        </t-descriptions>

        <!-- 资源监控 -->
        <div class="detail-section" v-if="selectedAgent.resourceUsage">
          <h3>资源使用</h3>
          <div class="resource-grid">
            <div class="resource-item">
              <div class="resource-label">CPU</div>
              <div class="resource-value">{{ selectedAgent.resourceUsage.cpuPercent.toFixed(1) }}%</div>
              <t-progress
                :percentage="selectedAgent.resourceUsage.cpuPercent"
                :theme="selectedAgent.resourceUsage.cpuPercent > 80 ? 'danger' : 'default'"
              />
            </div>
            <div class="resource-item">
              <div class="resource-label">内存</div>
              <div class="resource-value">
                {{ formatBytes(selectedAgent.resourceUsage.memoryUsage) }} / {{ formatBytes(selectedAgent.resourceUsage.memoryLimit) }}
              </div>
              <t-progress
                :percentage="selectedAgent.resourceUsage.memoryPercent"
                :theme="selectedAgent.resourceUsage.memoryPercent > 80 ? 'danger' : 'default'"
              />
            </div>
            <div class="resource-item">
              <div class="resource-label">网络 I/O</div>
              <div class="resource-value">
                ↓ {{ formatBytes(selectedAgent.resourceUsage.networkRx) }} /
                ↑ {{ formatBytes(selectedAgent.resourceUsage.networkTx) }}
              </div>
            </div>
            <div class="resource-item">
              <div class="resource-label">进程数</div>
              <div class="resource-value">{{ selectedAgent.resourceUsage.pids }}</div>
            </div>
          </div>
        </div>

        <!-- 执行历史 -->
        <div class="detail-section">
          <h3>执行历史</h3>
          <t-table
            :data="selectedAgent.executionHistory || []"
            :columns="historyColumns"
            row-key="executionId"
            size="small"
          >
            <template #duration="{ row }">
              {{ row.duration }}ms
            </template>
            <template #success="{ row }">
              <t-tag :theme="row.success ? 'success' : 'danger'" size="small">
                {{ row.success ? '成功' : '失败' }}
              </t-tag>
            </template>
          </t-table>
        </div>

        <!-- 执行任务 -->
        <div class="detail-section" v-if="['ready', 'paused'].includes(selectedAgent.status)">
          <h3>执行任务</h3>
          <t-textarea
            v-model="taskInput"
            placeholder="输入任务描述..."
            :autosize="{ minRows: 3, maxRows: 6 }"
          />
          <div class="task-actions">
            <t-button theme="primary" :loading="executing" @click="executeTask">
              执行
            </t-button>
          </div>
        </div>

        <!-- 执行结果 -->
        <div class="detail-section" v-if="executionResult">
          <h3>执行结果</h3>
          <div class="result-box">
            <div class="result-meta">
              <span>执行ID: {{ executionResult.executionId }}</span>
              <span>耗时: {{ executionResult.duration }}ms</span>
              <span>迭代: {{ executionResult.iterations }}</span>
              <t-tag :theme="executionResult.success ? 'success' : 'danger'" size="small">
                {{ executionResult.success ? '成功' : '失败' }}
              </t-tag>
            </div>
            <div class="result-output">
              <pre>{{ executionResult.output }}</pre>
            </div>
            <div v-if="executionResult.error" class="result-error">
              {{ executionResult.error }}
            </div>
          </div>
        </div>
      </div>
    </t-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import { AddIcon, RefreshIcon } from 'tdesign-icons-vue-next';
import { MessagePlugin } from 'tdesign-vue-next';

// 类型定义
interface AgentResourceUsage {
  cpuPercent: number;
  memoryUsage: number;
  memoryLimit: number;
  memoryPercent: number;
  networkRx: number;
  networkTx: number;
  pids: number;
}

interface ExecutionHistory {
  executionId: string;
  task: string;
  success: boolean;
  duration: number;
  iterations: number;
  timestamp: string;
}

interface Agent {
  agentId: string;
  name?: string;
  image: string;
  status: string;
  sandboxLevel: string;
  maxIterations: number;
  createdAt: string;
  resourceUsage?: AgentResourceUsage;
  executionHistory?: ExecutionHistory[];
}

interface ExecutionResult {
  executionId: string;
  agentId: string;
  exitCode: number;
  output: string;
  error?: string;
  duration: number;
  iterations: number;
  success: boolean;
}

// 状态
const agents = ref<Agent[]>([]);
const selectedAgent = ref<Agent | null>(null);
const loading = ref(false);

// 统计
const stats = computed(() => ({
  total: agents.value.length,
  running: agents.value.filter(a => a.status === 'running').length,
  ready: agents.value.filter(a => a.status === 'ready').length,
  completed: agents.value.filter(a => a.status === 'completed').length,
  failed: agents.value.filter(a => a.status === 'failed').length,
}));

// 创建表单
const showCreateDialog = ref(false);
const creating = ref(false);
const createFormRef = ref();
const createForm = reactive({
  agentId: '',
  name: '',
  image: 'sacode/agent:latest',
  sandboxLevel: 'moderate',
  maxExecutionTime: 300000,
  maxIterations: 100,
  allowedTools: [] as string[],
});

const createRules = {
  agentId: [{ required: true, message: '请输入 Agent ID' }],
};

// 详情抽屉
const showDetailDrawer = ref(false);
const taskInput = ref('');
const executing = ref(false);
const executionResult = ref<ExecutionResult | null>(null);

// 历史表格列
const historyColumns = [
  { colKey: 'executionId', title: '执行ID', ellipsis: true },
  { colKey: 'task', title: '任务', ellipsis: true },
  { colKey: 'duration', title: '耗时', width: 100 },
  { colKey: 'iterations', title: '迭代', width: 80 },
  { colKey: 'success', title: '结果', width: 80 },
];

// 刷新定时器
let refreshTimer: ReturnType<typeof setInterval> | null = null;

// 方法
const fetchAgents = async () => {
  loading.value = true;
  try {
    const response = await fetch('/api/agents');
    const data = await response.json();
    if (data.success) {
      agents.value = data.data;
    }
  } catch (error) {
    console.error('Failed to fetch agents:', error);
  } finally {
    loading.value = false;
  }
};

const refreshAgents = () => {
  fetchAgents();
};

const getStatusTheme = (status: string) => {
  const themes: Record<string, string> = {
    created: 'default',
    initializing: 'warning',
    ready: 'primary',
    running: 'success',
    paused: 'warning',
    completed: 'success',
    failed: 'danger',
    timeout: 'danger',
    stopped: 'default',
  };
  return themes[status] || 'default';
};

const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleString('zh-CN');
};

const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const viewAgent = async (agent: Agent) => {
  selectedAgent.value = agent;
  executionResult.value = null;
  showDetailDrawer.value = true;

  // 获取资源使用
  if (agent.status === 'running') {
    try {
      const response = await fetch(`/api/agents/${agent.agentId}/stats`);
      const data = await response.json();
      if (data.success) {
        selectedAgent.value = { ...agent, resourceUsage: data.data };
      }
    } catch (error) {
      console.error('Failed to fetch agent stats:', error);
    }
  }
};

const createAgent = async () => {
  const valid = await createFormRef.value?.validate();
  if (valid !== true) return;

  creating.value = true;
  try {
    const response = await fetch('/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createForm),
    });

    const data = await response.json();
    if (data.success) {
      MessagePlugin.success('Agent 创建成功');
      showCreateDialog.value = false;
      fetchAgents();
      // 重置表单
      createForm.agentId = '';
      createForm.name = '';
      createForm.allowedTools = [];
    } else {
      MessagePlugin.error(data.error || '创建失败');
    }
  } finally {
    creating.value = false;
  }
};

const pauseAgent = async (agent: Agent) => {
  try {
    const response = await fetch(`/api/agents/${agent.agentId}/pause`, { method: 'POST' });
    const data = await response.json();
    if (data.success) {
      MessagePlugin.success('Agent 已暂停');
      fetchAgents();
    }
  } catch (error) {
    MessagePlugin.error('暂停失败');
  }
};

const resumeAgent = async (agent: Agent) => {
  try {
    const response = await fetch(`/api/agents/${agent.agentId}/resume`, { method: 'POST' });
    const data = await response.json();
    if (data.success) {
      MessagePlugin.success('Agent 已恢复');
      fetchAgents();
    }
  } catch (error) {
    MessagePlugin.error('恢复失败');
  }
};

const stopAgent = async (agent: Agent) => {
  if (!confirm(`确定要停止 Agent ${agent.name || agent.agentId} 吗？`)) return;

  try {
    const response = await fetch(`/api/agents/${agent.agentId}/stop`, { method: 'POST' });
    const data = await response.json();
    if (data.success) {
      MessagePlugin.success('Agent 已停止');
      fetchAgents();
    }
  } catch (error) {
    MessagePlugin.error('停止失败');
  }
};

const removeAgent = async (agent: Agent) => {
  if (!confirm(`确定要删除 Agent ${agent.name || agent.agentId} 吗？`)) return;

  try {
    const response = await fetch(`/api/agents/${agent.agentId}`, { method: 'DELETE' });
    const data = await response.json();
    if (data.success) {
      MessagePlugin.success('Agent 已删除');
      showDetailDrawer.value = false;
      fetchAgents();
    }
  } catch (error) {
    MessagePlugin.error('删除失败');
  }
};

const executeTask = async () => {
  if (!taskInput.value || !selectedAgent.value) return;

  executing.value = true;
  try {
    const response = await fetch(`/api/agents/${selectedAgent.value.agentId}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: taskInput.value }),
    });

    const data = await response.json();
    if (data.success) {
      executionResult.value = data.data;
      MessagePlugin.success('任务执行完成');
      fetchAgents();
    } else {
      MessagePlugin.error(data.error || '执行失败');
    }
  } finally {
    executing.value = false;
  }
};

// 生命周期
onMounted(() => {
  fetchAgents();
  refreshTimer = setInterval(fetchAgents, 5000);
});

onUnmounted(() => {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
});
</script>

<style scoped>
.agents-page {
  padding: 24px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.page-header h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
}

.header-actions {
  display: flex;
  gap: 12px;
}

.stats-row {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}

.stat-card {
  background: var(--td-bg-color-container);
  border-radius: 8px;
  padding: 20px;
  text-align: center;
}

.stat-value {
  font-size: 32px;
  font-weight: 600;
}

.stat-label {
  color: var(--td-text-color-secondary);
  margin-top: 4px;
}

.stat-card.running .stat-value { color: var(--td-success-color); }
.stat-card.ready .stat-value { color: var(--td-brand-color); }
.stat-card.completed .stat-value { color: var(--td-success-color); }
.stat-card.failed .stat-value { color: var(--td-error-color); }

.agents-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.agent-card {
  background: var(--td-bg-color-container);
  border-radius: 8px;
  padding: 16px;
  cursor: pointer;
  transition: box-shadow 0.2s;
  border-left: 4px solid transparent;
}

.agent-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.agent-card.running { border-left-color: var(--td-success-color); }
.agent-card.ready { border-left-color: var(--td-brand-color); }
.agent-card.paused { border-left-color: var(--td-warning-color); }
.agent-card.failed { border-left-color: var(--td-error-color); }
.agent-card.completed { border-left-color: var(--td-success-color); }

.agent-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.agent-name {
  font-weight: 600;
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-info {
  margin-bottom: 12px;
}

.info-row {
  display: flex;
  font-size: 13px;
  margin-bottom: 4px;
}

.info-row .label {
  color: var(--td-text-color-secondary);
  width: 50px;
  flex-shrink: 0;
}

.info-row .value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.resource-usage {
  margin-bottom: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--td-component-border);
}

.usage-item {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.usage-item .label {
  font-size: 12px;
  color: var(--td-text-color-secondary);
  width: 40px;
}

.usage-item :deep(.t-progress) {
  flex: 1;
}

.agent-actions {
  display: flex;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--td-component-border);
}

.input-suffix {
  margin-left: 8px;
  color: var(--td-text-color-secondary);
}

.agent-detail {
  padding: 16px 0;
}

.detail-section {
  margin-top: 24px;
}

.detail-section h3 {
  margin: 0 0 16px;
  font-size: 16px;
  font-weight: 500;
}

.resource-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

.resource-item {
  padding: 12px;
  background: var(--td-bg-color-container-hover);
  border-radius: 4px;
}

.resource-label {
  font-size: 12px;
  color: var(--td-text-color-secondary);
  margin-bottom: 4px;
}

.resource-value {
  font-size: 14px;
  font-family: monospace;
  margin-bottom: 8px;
}

.task-actions {
  margin-top: 12px;
}

.result-box {
  border: 1px solid var(--td-component-border);
  border-radius: 4px;
}

.result-meta {
  display: flex;
  gap: 16px;
  padding: 8px 12px;
  background: var(--td-bg-color-container-hover);
  font-size: 13px;
  color: var(--td-text-color-secondary);
}

.result-output {
  padding: 12px;
  max-height: 300px;
  overflow: auto;
}

.result-output pre {
  margin: 0;
  font-family: monospace;
  font-size: 13px;
  white-space: pre-wrap;
}

.result-error {
  padding: 12px;
  background: var(--td-error-color-1);
  color: var(--td-error-color);
  font-size: 13px;
}
</style>
