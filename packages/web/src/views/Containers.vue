<template>
  <div class="containers-page">
    <!-- 页面标题和操作栏 -->
    <div class="page-header">
      <h1>容器管理</h1>
      <div class="header-actions">
        <t-button theme="primary" @click="showCreateDialog = true">
          <template #icon><add-icon /></template>
          创建容器
        </t-button>
        <t-button variant="outline" @click="refreshContainers">
          <template #icon><refresh-icon /></template>
          刷新
        </t-button>
      </div>
    </div>

    <!-- 统计卡片 -->
    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-value">{{ stats.total }}</div>
        <div class="stat-label">总容器</div>
      </div>
      <div class="stat-card running">
        <div class="stat-value">{{ stats.running }}</div>
        <div class="stat-label">运行中</div>
      </div>
      <div class="stat-card stopped">
        <div class="stat-value">{{ stats.stopped }}</div>
        <div class="stat-label">已停止</div>
      </div>
      <div class="stat-card paused">
        <div class="stat-value">{{ stats.paused }}</div>
        <div class="stat-label">已暂停</div>
      </div>
    </div>

    <!-- 容器列表 -->
    <div class="containers-table">
      <t-table
        :data="containers"
        :columns="columns"
        row-key="id"
        :loading="loading"
        hover
        stripe
      >
        <template #status="{ row }">
          <t-tag :theme="getStatusTheme(row.status)" variant="light">
            {{ row.status }}
          </t-tag>
        </template>
        <template #image="{ row }">
          <span class="image-cell">{{ row.image }}</span>
        </template>
        <template #created="{ row }">
          {{ formatDate(row.created) }}
        </template>
        <template #actions="{ row }">
          <div class="action-buttons">
            <t-popup content="查看详情">
              <t-button size="small" variant="text" @click="viewContainer(row)">
                <browse-icon />
              </t-button>
            </t-popup>
            <t-popup v-if="row.status === 'running'" content="停止">
              <t-button size="small" variant="text" theme="warning" @click="stopContainer(row)">
                <stop-icon />
              </t-button>
            </t-popup>
            <t-popup v-else-if="row.status === 'exited'" content="启动">
              <t-button size="small" variant="text" theme="success" @click="startContainer(row)">
                <play-icon />
              </t-button>
            </t-popup>
            <t-popup v-if="row.status === 'running'" content="暂停">
              <t-button size="small" variant="text" @click="pauseContainer(row)">
                <pause-icon />
              </t-button>
            </t-popup>
            <t-popup v-else-if="row.status === 'paused'" content="恢复">
              <t-button size="small" variant="text" theme="success" @click="resumeContainer(row)">
                <play-icon />
              </t-button>
            </t-popup>
            <t-popup content="执行命令">
              <t-button size="small" variant="text" @click="openExecDialog(row)">
                <code-icon />
              </t-button>
            </t-popup>
            <t-popup content="查看日志">
              <t-button size="small" variant="text" @click="viewLogs(row)">
                <file-icon />
              </t-button>
            </t-popup>
            <t-popup content="删除">
              <t-button size="small" variant="text" theme="danger" @click="confirmDelete(row)">
                <delete-icon />
              </t-button>
            </t-popup>
          </div>
        </template>
      </t-table>
    </div>

    <!-- 创建容器对话框 -->
    <t-dialog
      v-model:visible="showCreateDialog"
      header="创建容器"
      :width="600"
      :confirm-btn="{ content: '创建', loading: creating }"
      @confirm="createContainer"
    >
      <t-form :data="createForm" :rules="createRules" ref="createFormRef">
        <t-form-item label="容器名称" name="name">
          <t-input v-model="createForm.name" placeholder="可选，自动生成" />
        </t-form-item>
        <t-form-item label="镜像" name="image">
          <t-input v-model="createForm.image" placeholder="如 node:22-alpine" />
        </t-form-item>
        <t-form-item label="沙箱级别" name="sandboxLevel">
          <t-select v-model="createForm.sandboxLevel">
            <t-option value="strict" label="严格 (最高安全)" />
            <t-option value="moderate" label="适中 (推荐)" />
            <t-option value="permissive" label="宽松" />
            <t-option value="custom" label="自定义" />
          </t-select>
        </t-form-item>
        <t-form-item label="内存限制">
          <t-input v-model="createForm.memory" placeholder="如 512m" />
        </t-form-item>
        <t-form-item label="CPU 限制">
          <t-input-number v-model="createForm.cpuQuota" :min="0.1" :max="16" :step="0.5" />
          <span class="input-suffix">核</span>
        </t-form-item>
        <t-form-item label="环境变量">
          <div class="env-editor">
            <div v-for="(env, index) in createForm.envList" :key="index" class="env-row">
              <t-input v-model="env.key" placeholder="KEY" class="env-key" />
              <span>=</span>
              <t-input v-model="env.value" placeholder="VALUE" class="env-value" />
              <t-button variant="text" theme="danger" @click="createForm.envList.splice(index, 1)">
                <delete-icon />
              </t-button>
            </div>
            <t-button variant="dashed" block @click="createForm.envList.push({ key: '', value: '' })">
              添加环境变量
            </t-button>
          </div>
        </t-form-item>
      </t-form>
    </t-dialog>

    <!-- 执行命令对话框 -->
    <t-dialog
      v-model:visible="showExecDialog"
      :header="`执行命令 - ${selectedContainer?.name}`"
      :width="700"
      :confirm-btn="{ content: '执行', loading: executing }"
      @confirm="execCommand"
    >
      <t-form :data="execForm">
        <t-form-item label="命令">
          <t-input v-model="execForm.command" placeholder="如 ls -la" />
        </t-form-item>
        <t-form-item label="工作目录">
          <t-input v-model="execForm.workdir" placeholder="默认 /workspace" />
        </t-form-item>
        <t-form-item label="超时 (秒)">
          <t-input-number v-model="execForm.timeout" :min="1" :max="300" />
        </t-form-item>
      </t-form>
      <div v-if="execResult" class="exec-result">
        <div class="result-header">
          <span>退出码: {{ execResult.exitCode }}</span>
          <span>耗时: {{ execResult.duration }}ms</span>
        </div>
        <div class="result-output">
          <pre>{{ execResult.stdout }}</pre>
          <pre v-if="execResult.stderr" class="stderr">{{ execResult.stderr }}</pre>
        </div>
      </div>
    </t-dialog>

    <!-- 日志对话框 -->
    <t-dialog
      v-model:visible="showLogsDialog"
      :header="`日志 - ${selectedContainer?.name}`"
      :width="800"
      :footer="false"
    >
      <div class="logs-container">
        <div class="logs-toolbar">
          <t-button size="small" @click="refreshLogs">
            <refresh-icon /> 刷新
          </t-button>
          <t-checkbox v-model="logsFollow">实时跟踪</t-checkbox>
          <t-input-number v-model="logsTail" :min="10" :max="1000" placeholder="行数" />
        </div>
        <div class="logs-content">
          <pre>{{ containerLogs }}</pre>
        </div>
      </div>
    </t-dialog>

    <!-- 容器详情抽屉 -->
    <t-drawer
      v-model:visible="showDetailDrawer"
      :header="`容器详情 - ${selectedContainer?.name}`"
      size="large"
    >
      <div v-if="selectedContainer" class="container-detail">
        <t-descriptions :column="2">
          <t-descriptions-item label="ID">{{ selectedContainer.id }}</t-descriptions-item>
          <t-descriptions-item label="状态">
            <t-tag :theme="getStatusTheme(selectedContainer.status)">{{ selectedContainer.status }}</t-tag>
          </t-descriptions-item>
          <t-descriptions-item label="镜像">{{ selectedContainer.image }}</t-descriptions-item>
          <t-descriptions-item label="创建时间">{{ formatDate(selectedContainer.created) }}</t-descriptions-item>
        </t-descriptions>

        <div class="detail-section">
          <h3>资源使用</h3>
          <div v-if="containerStats" class="stats-grid">
            <div class="stat-item">
              <span class="label">CPU</span>
              <t-progress :percentage="containerStats.cpuPercent" :theme="containerStats.cpuPercent > 80 ? 'danger' : 'default'" />
            </div>
            <div class="stat-item">
              <span class="label">内存</span>
              <t-progress :percentage="containerStats.memoryPercent" :theme="containerStats.memoryPercent > 80 ? 'danger' : 'default'" />
              <span class="value">{{ formatBytes(containerStats.memoryUsage) }} / {{ formatBytes(containerStats.memoryLimit) }}</span>
            </div>
            <div class="stat-item">
              <span class="label">网络 I/O</span>
              <span class="value">↓ {{ formatBytes(containerStats.networkRx) }} / ↑ {{ formatBytes(containerStats.networkTx) }}</span>
            </div>
            <div class="stat-item">
              <span class="label">磁盘 I/O</span>
              <span class="value">读 {{ formatBytes(containerStats.blockRead) }} / 写 {{ formatBytes(containerStats.blockWrite) }}</span>
            </div>
          </div>
          <div v-else class="no-stats">容器未运行</div>
        </div>
      </div>
    </t-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import {
  AddIcon,
  RefreshIcon,
  BrowseIcon,
  PlayIcon,
  StopIcon,
  PauseIcon,
  DeleteIcon,
  CodeIcon,
  FileIcon,
} from 'tdesign-icons-vue-next';
import { MessagePlugin } from 'tdesign-vue-next';

// 类型定义
interface Container {
  id: string;
  name: string;
  image: string;
  status: string;
  created: string;
  ports: string[];
  labels: Record<string, string>;
}

interface ContainerStats {
  cpuPercent: number;
  memoryUsage: number;
  memoryLimit: number;
  memoryPercent: number;
  networkRx: number;
  networkTx: number;
  blockRead: number;
  blockWrite: number;
}

interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
}

// 状态
const loading = ref(false);
const containers = ref<Container[]>([]);
const selectedContainer = ref<Container | null>(null);
const containerStats = ref<ContainerStats | null>(null);
const containerLogs = ref('');

// 统计
const stats = computed(() => ({
  total: containers.value.length,
  running: containers.value.filter(c => c.status === 'running').length,
  stopped: containers.value.filter(c => c.status === 'exited' || c.status === 'created').length,
  paused: containers.value.filter(c => c.status === 'paused').length,
}));

// 表格列
const columns = [
  { colKey: 'name', title: '名称', ellipsis: true },
  { colKey: 'image', title: '镜像', ellipsis: true },
  { colKey: 'status', title: '状态', width: 100 },
  { colKey: 'created', title: '创建时间', width: 180 },
  { colKey: 'actions', title: '操作', width: 200 },
];

// 创建表单
const showCreateDialog = ref(false);
const creating = ref(false);
const createFormRef = ref();
const createForm = reactive({
  name: '',
  image: '',
  sandboxLevel: 'moderate',
  memory: '512m',
  cpuQuota: 1.0,
  envList: [] as { key: string; value: string }[],
});

const createRules = {
  image: [{ required: true, message: '请输入镜像名称' }],
};

// 执行命令
const showExecDialog = ref(false);
const executing = ref(false);
const execForm = reactive({
  command: '',
  workdir: '',
  timeout: 30,
});
const execResult = ref<ExecResult | null>(null);

// 日志
const showLogsDialog = ref(false);
const logsFollow = ref(false);
const logsTail = ref(100);

// 详情抽屉
const showDetailDrawer = ref(false);

// 刷新定时器
let refreshTimer: ReturnType<typeof setInterval> | null = null;

// 方法
const fetchContainers = async () => {
  loading.value = true;
  try {
    const response = await fetch('/api/containers');
    const data = await response.json();
    if (data.success) {
      containers.value = data.data;
    }
  } catch (error) {
    console.error('Failed to fetch containers:', error);
  } finally {
    loading.value = false;
  }
};

const refreshContainers = () => {
  fetchContainers();
};

const getStatusTheme = (status: string) => {
  const themes: Record<string, string> = {
    running: 'success',
    exited: 'default',
    created: 'warning',
    paused: 'warning',
    dead: 'danger',
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

const viewContainer = async (container: Container) => {
  selectedContainer.value = container;
  showDetailDrawer.value = true;
  
  // 获取资源统计
  try {
    const response = await fetch(`/api/containers/${container.id}/stats`);
    const data = await response.json();
    if (data.success) {
      containerStats.value = data.data;
    }
  } catch (error) {
    console.error('Failed to fetch stats:', error);
  }
};

const startContainer = async (container: Container) => {
  try {
    const response = await fetch(`/api/containers/${container.id}/start`, { method: 'POST' });
    const data = await response.json();
    if (data.success) {
      MessagePlugin.success('容器已启动');
      fetchContainers();
    } else {
      MessagePlugin.error(data.error || '启动失败');
    }
  } catch (error) {
    MessagePlugin.error('启动失败');
  }
};

const stopContainer = async (container: Container) => {
  try {
    const response = await fetch(`/api/containers/${container.id}/stop`, { method: 'POST' });
    const data = await response.json();
    if (data.success) {
      MessagePlugin.success('容器已停止');
      fetchContainers();
    } else {
      MessagePlugin.error(data.error || '停止失败');
    }
  } catch (error) {
    MessagePlugin.error('停止失败');
  }
};

const pauseContainer = async (container: Container) => {
  try {
    const response = await fetch(`/api/containers/${container.id}/pause`, { method: 'POST' });
    const data = await response.json();
    if (data.success) {
      MessagePlugin.success('容器已暂停');
      fetchContainers();
    }
  } catch (error) {
    MessagePlugin.error('暂停失败');
  }
};

const resumeContainer = async (container: Container) => {
  try {
    const response = await fetch(`/api/containers/${container.id}/unpause`, { method: 'POST' });
    const data = await response.json();
    if (data.success) {
      MessagePlugin.success('容器已恢复');
      fetchContainers();
    }
  } catch (error) {
    MessagePlugin.error('恢复失败');
  }
};

const confirmDelete = async (container: Container) => {
  if (confirm(`确定要删除容器 ${container.name} 吗？`)) {
    try {
      const response = await fetch(`/api/containers/${container.id}`, { method: 'DELETE' });
      const data = await response.json();
      if (data.success) {
        MessagePlugin.success('容器已删除');
        fetchContainers();
      }
    } catch (error) {
      MessagePlugin.error('删除失败');
    }
  }
};

const createContainer = async () => {
  const valid = await createFormRef.value?.validate();
  if (valid !== true) return;

  creating.value = true;
  try {
    const env: Record<string, string> = {};
    for (const item of createForm.envList) {
      if (item.key) env[item.key] = item.value;
    }

    const response = await fetch('/api/containers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: createForm.name || undefined,
        image: createForm.image,
        sandbox: {
          level: createForm.sandboxLevel,
          memory: createForm.memory,
          cpuQuota: createForm.cpuQuota,
        },
        env,
      }),
    });

    const data = await response.json();
    if (data.success) {
      MessagePlugin.success('容器创建成功');
      showCreateDialog.value = false;
      fetchContainers();
      // 重置表单
      createForm.name = '';
      createForm.image = '';
      createForm.envList = [];
    } else {
      MessagePlugin.error(data.error || '创建失败');
    }
  } finally {
    creating.value = false;
  }
};

const openExecDialog = (container: Container) => {
  selectedContainer.value = container;
  execForm.command = '';
  execForm.workdir = '';
  execForm.timeout = 30;
  execResult.value = null;
  showExecDialog.value = true;
};

const execCommand = async () => {
  if (!execForm.command || !selectedContainer.value) return;

  executing.value = true;
  try {
    const response = await fetch(`/api/containers/${selectedContainer.value.id}/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cmd: execForm.command.split(' '),
        workdir: execForm.workdir || undefined,
        timeout: execForm.timeout * 1000,
      }),
    });

    const data = await response.json();
    if (data.success) {
      execResult.value = data.data;
    } else {
      MessagePlugin.error(data.error || '执行失败');
    }
  } finally {
    executing.value = false;
  }
};

const viewLogs = async (container: Container) => {
  selectedContainer.value = container;
  showLogsDialog.value = true;
  await refreshLogs();
};

const refreshLogs = async () => {
  if (!selectedContainer.value) return;
  
  try {
    const response = await fetch(`/api/containers/${selectedContainer.value.id}/logs?tail=${logsTail.value}`);
    const data = await response.json();
    if (data.success) {
      containerLogs.value = data.data.logs;
    }
  } catch (error) {
    console.error('Failed to fetch logs:', error);
  }
};

// 生命周期
onMounted(() => {
  fetchContainers();
  // 每 10 秒刷新一次
  refreshTimer = setInterval(fetchContainers, 10000);
});

onUnmounted(() => {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
});
</script>

<style scoped>
.containers-page {
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
  grid-template-columns: repeat(4, 1fr);
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
  color: var(--td-text-color-primary);
}

.stat-label {
  color: var(--td-text-color-secondary);
  margin-top: 4px;
}

.stat-card.running .stat-value { color: var(--td-success-color); }
.stat-card.stopped .stat-value { color: var(--td-text-color-secondary); }
.stat-card.paused .stat-value { color: var(--td-warning-color); }

.containers-table {
  background: var(--td-bg-color-container);
  border-radius: 8px;
  padding: 16px;
}

.image-cell {
  font-family: monospace;
  font-size: 13px;
}

.action-buttons {
  display: flex;
  gap: 4px;
}

.env-editor {
  width: 100%;
}

.env-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.env-key {
  width: 150px;
}

.env-value {
  flex: 1;
}

.input-suffix {
  margin-left: 8px;
  color: var(--td-text-color-secondary);
}

.exec-result {
  margin-top: 16px;
  border: 1px solid var(--td-component-border);
  border-radius: 4px;
}

.result-header {
  display: flex;
  justify-content: space-between;
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

.result-output .stderr {
  color: var(--td-error-color);
  margin-top: 8px;
}

.logs-container {
  height: 500px;
  display: flex;
  flex-direction: column;
}

.logs-toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 12px;
}

.logs-content {
  flex: 1;
  overflow: auto;
  background: #1e1e1e;
  border-radius: 4px;
  padding: 12px;
}

.logs-content pre {
  margin: 0;
  color: #d4d4d4;
  font-family: 'Consolas', monospace;
  font-size: 13px;
}

.container-detail {
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

.stats-grid {
  display: grid;
  gap: 16px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.stat-item .label {
  font-size: 13px;
  color: var(--td-text-color-secondary);
}

.stat-item .value {
  font-size: 13px;
  font-family: monospace;
}

.no-stats {
  color: var(--td-text-color-secondary);
  text-align: center;
  padding: 24px;
}
</style>
