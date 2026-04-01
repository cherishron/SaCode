<script setup lang="ts">
import { ref, reactive, computed, onMounted } from "vue";
import { Modal as TinyModal, Notify } from "@opentiny/vue";
import { api } from "@/lib/api";
import DashboardLayout from "./DashboardLayout.vue";

// ============ 类型定义 ============
interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  author?: string;
  main: string;
  config?: Record<string, ConfigField>;
  defaultConfig?: Record<string, unknown>;
  tags?: string[];
  keywords?: string[];
}

interface ConfigField {
  type: "string" | "number" | "boolean" | "array" | "object";
  description?: string;
  default?: unknown;
  required?: boolean;
  enum?: unknown[];
  min?: number;
  max?: number;
  pattern?: string;
}

interface Plugin {
  name: string;
  version: string;
  description?: string;
  author?: string;
  status: "discovered" | "installed" | "enabled" | "disabled" | "error";
  enabled: boolean;
  config: Record<string, unknown>;
  tags?: string[];
  error?: string;
  manifest?: PluginManifest;
  capabilities?: {
    tools?: Array<{ name: string; description: string }>;
    commands?: Array<{ name: string; description: string; aliases?: string[] }>;
    messageHandlers?: number;
    scheduledTasks?: number;
  };
}

interface PluginStats {
  total: number;
  installed: number;
  enabled: number;
  disabled: number;
  error: number;
}

// ============ 状态 ============
const plugins = ref<Plugin[]>([]);
const stats = ref<PluginStats>({ total: 0, installed: 0, enabled: 0, disabled: 0, error: 0 });
const loading = ref(false);
const actionLoading = ref<string | null>(null);
const searchQuery = ref("");
const statusFilter = ref<string>("all");

// 配置编辑对话框
const showConfigModal = ref(false);
const configPlugin = ref<Plugin | null>(null);
const configForm = reactive<Record<string, unknown>>({});
const configErrors = ref<string[]>([]);
const configLoading = ref(false);

// 详情对话框
const showDetailModal = ref(false);
const detailPlugin = ref<Plugin | null>(null);

// ============ 计算属性 ============
const filteredPlugins = computed(() => {
  let result = plugins.value;

  // 状态过滤
  if (statusFilter.value !== "all") {
    result = result.filter((p) => p.status === statusFilter.value);
  }

  // 搜索过滤
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    result = result.filter(
      (p) =>
        p.name.toLowerCase().includes(query) ||
        p.description?.toLowerCase().includes(query) ||
        p.author?.toLowerCase().includes(query) ||
        p.tags?.some((t) => t.toLowerCase().includes(query))
    );
  }

  return result;
});

const statusOptions = [
  { label: "全部", value: "all" },
  { label: "已启用", value: "enabled" },
  { label: "已禁用", value: "disabled" },
  { label: "已安装", value: "installed" },
  { label: "错误", value: "error" },
];

// ============ 方法 ============

// 加载插件列表
async function loadPlugins() {
  loading.value = true;
  try {
    const response = await api.get<Plugin[]>("/plugins");
    plugins.value = response;
  } catch (error) {
    console.error("加载插件列表失败:", error);
    Notify({ type: "error", title: "加载插件列表失败" });
  } finally {
    loading.value = false;
  }
}

// 加载统计数据
async function loadStats() {
  try {
    const response = await api.get<PluginStats>("/plugins/stats");
    stats.value = response;
  } catch (error) {
    console.error("加载统计数据失败:", error);
  }
}

// 发现插件
async function discoverPlugins() {
  loading.value = true;
  try {
    await api.get("/plugins/discover");
    await loadPlugins();
    await loadStats();
    Notify({ type: "success", title: "插件发现完成" });
  } catch (error) {
    console.error("发现插件失败:", error);
    Notify({ type: "error", title: "发现插件失败" });
  } finally {
    loading.value = false;
  }
}

// 安装插件
async function installPlugin(name: string) {
  actionLoading.value = name;
  try {
    await api.post("/plugins", { name });
    await loadPlugins();
    await loadStats();
    Notify({ type: "success", title: `插件 ${name} 安装成功` });
  } catch (error) {
    console.error("安装插件失败:", error);
    Notify({ type: "error", title: "安装插件失败" });
  } finally {
    actionLoading.value = null;
  }
}

// 卸载插件
function uninstallPlugin(plugin: Plugin) {
  TinyModal.confirm({
    title: "确认卸载",
    message: `确定要卸载插件「${plugin.name}」吗？此操作不可恢复。`,
    onConfirm: async () => {
      actionLoading.value = plugin.name;
      try {
        await api.delete(`/plugins/${plugin.name}`);
        await loadPlugins();
        await loadStats();
        Notify({ type: "success", title: `插件 ${plugin.name} 已卸载` });
      } catch (error) {
        console.error("卸载插件失败:", error);
        Notify({ type: "error", title: "卸载插件失败" });
      } finally {
        actionLoading.value = null;
      }
    },
  });
}

// 启用插件
async function enablePlugin(name: string) {
  actionLoading.value = name;
  try {
    await api.post(`/plugins/${name}/enable`);
    await loadPlugins();
    await loadStats();
    Notify({ type: "success", title: `插件 ${name} 已启用` });
  } catch (error) {
    console.error("启用插件失败:", error);
    Notify({ type: "error", title: "启用插件失败" });
  } finally {
    actionLoading.value = null;
  }
}

// 禁用插件
async function disablePlugin(name: string) {
  actionLoading.value = name;
  try {
    await api.post(`/plugins/${name}/disable`);
    await loadPlugins();
    await loadStats();
    Notify({ type: "success", title: `插件 ${name} 已禁用` });
  } catch (error) {
    console.error("禁用插件失败:", error);
    Notify({ type: "error", title: "禁用插件失败" });
  } finally {
    actionLoading.value = null;
  }
}

// 重载插件
async function reloadPlugin(name: string) {
  actionLoading.value = name;
  try {
    await api.post(`/plugins/${name}/reload`);
    await loadPlugins();
    Notify({ type: "success", title: `插件 ${name} 已重载` });
  } catch (error) {
    console.error("重载插件失败:", error);
    Notify({ type: "error", title: "重载插件失败" });
  } finally {
    actionLoading.value = null;
  }
}

// 打开配置对话框
async function openConfigModal(plugin: Plugin) {
  configPlugin.value = plugin;
  configErrors.value = [];

  // 加载当前配置
  try {
    const config = await api.get<Record<string, unknown>>(`/plugins/${plugin.name}/config`);
    Object.keys(configForm).forEach((key) => delete configForm[key]);
    Object.assign(configForm, config);
  } catch (error) {
    console.error("加载配置失败:", error);
    Object.keys(configForm).forEach((key) => delete configForm[key]);
    Object.assign(configForm, plugin.config || {});
  }

  showConfigModal.value = true;
}

// 验证配置
async function validateConfig() {
  if (!configPlugin.value) return false;

  try {
    const response = await api.post<{ valid: boolean; errors: string[]; warnings: string[] }>(
      `/plugins/${configPlugin.value.name}/validate`,
      { config: configForm }
    );

    configErrors.value = response.errors;

    if (!response.valid) {
      Notify({ type: "warning", title: "配置验证失败", message: response.errors.join(", ") });
      return false;
    }

    if (response.warnings.length > 0) {
      Notify({ type: "info", title: "配置警告", message: response.warnings.join(", ") });
    }

    return true;
  } catch (error) {
    console.error("验证配置失败:", error);
    return false;
  }
}

// 保存配置
async function saveConfig() {
  if (!configPlugin.value) return;

  const valid = await validateConfig();
  if (!valid) return;

  configLoading.value = true;
  try {
    await api.put(`/plugins/${configPlugin.value.name}/config`, { config: configForm });
    Notify({ type: "success", title: "配置保存成功" });
    showConfigModal.value = false;
    await loadPlugins();
  } catch (error) {
    console.error("保存配置失败:", error);
    Notify({ type: "error", title: "保存配置失败" });
  } finally {
    configLoading.value = false;
  }
}

// 查看详情
async function viewDetail(plugin: Plugin) {
  try {
    const response = await api.get<Plugin>(`/plugins/${plugin.name}`);
    detailPlugin.value = response;
    showDetailModal.value = true;
  } catch (error) {
    console.error("加载插件详情失败:", error);
    Notify({ type: "error", title: "加载插件详情失败" });
  }
}

// 获取状态样式
function getStatusType(status: string): "success" | "warning" | "danger" | "info" {
  switch (status) {
    case "enabled":
      return "success";
    case "disabled":
      return "warning";
    case "error":
      return "danger";
    case "installed":
      return "info";
    default:
      return "info";
  }
}

// 获取状态文本
function getStatusText(status: string): string {
  const statusMap: Record<string, string> = {
    discovered: "已发现",
    installed: "已安装",
    enabled: "已启用",
    disabled: "已禁用",
    error: "错误",
  };
  return statusMap[status] || status;
}

// 判断是否有配置
function hasConfig(plugin: Plugin): boolean {
  return !!plugin.manifest?.config && Object.keys(plugin.manifest.config).length > 0;
}

// 初始化
onMounted(() => {
  loadPlugins();
  loadStats();
});
</script>

<template>
  <DashboardLayout>
    <div class="plugins-page">
      <!-- 页面标题和操作栏 -->
      <div class="page-header">
        <h2 class="page-title">插件管理</h2>
        <div class="header-actions">
          <tiny-button icon="refresh" :loading="loading" @click="loadPlugins">
            刷新
          </tiny-button>
          <tiny-button type="primary" icon="search" :loading="loading" @click="discoverPlugins">
            发现插件
          </tiny-button>
        </div>
      </div>

      <!-- 统计卡片 -->
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">{{ stats.total }}</div>
          <div class="stat-label">总计</div>
        </div>
        <div class="stat-card success">
          <div class="stat-value">{{ stats.enabled }}</div>
          <div class="stat-label">已启用</div>
        </div>
        <div class="stat-card warning">
          <div class="stat-value">{{ stats.disabled }}</div>
          <div class="stat-label">已禁用</div>
        </div>
        <div class="stat-card danger">
          <div class="stat-value">{{ stats.error }}</div>
          <div class="stat-label">错误</div>
        </div>
      </div>

      <!-- 过滤栏 -->
      <div class="filter-bar">
        <tiny-input
          v-model="searchQuery"
          placeholder="搜索插件名称、描述、作者..."
          clearable
          class="search-input"
        >
          <template #prefix>
            <icon-search />
          </template>
        </tiny-input>

        <tiny-select v-model="statusFilter" placeholder="状态过滤" clearable class="status-filter">
          <tiny-option
            v-for="opt in statusOptions"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
        </tiny-select>
      </div>

      <!-- 插件列表 -->
      <div v-if="loading" class="loading-placeholder">
        加载中...
      </div>

      <div v-else-if="filteredPlugins.length === 0" class="empty-placeholder">
        <p>暂无插件</p>
        <tiny-button type="primary" @click="discoverPlugins">发现插件</tiny-button>
      </div>

      <div v-else class="plugin-grid">
        <div v-for="plugin in filteredPlugins" :key="plugin.name" class="plugin-card">
          <!-- 卡片头部 -->
          <div class="plugin-header">
            <div class="plugin-title">
              <h3>{{ plugin.name }}</h3>
              <tiny-tag :type="getStatusType(plugin.status)" size="small">
                {{ getStatusText(plugin.status) }}
              </tiny-tag>
            </div>
            <div class="plugin-meta">
              <span class="version">v{{ plugin.version }}</span>
              <span v-if="plugin.author" class="author">{{ plugin.author }}</span>
            </div>
          </div>

          <!-- 描述 -->
          <p class="plugin-description">
            {{ plugin.description || "暂无描述" }}
          </p>

          <!-- 标签 -->
          <div v-if="plugin.tags?.length" class="plugin-tags">
            <tiny-tag v-for="tag in plugin.tags" :key="tag" size="mini" type="info">
              {{ tag }}
            </tiny-tag>
          </div>

          <!-- 错误信息 -->
          <div v-if="plugin.error" class="plugin-error">
            <icon-warning />
            <span>{{ plugin.error }}</span>
          </div>

          <!-- 操作按钮 -->
          <div class="plugin-actions">
            <!-- 发现状态 -->
            <template v-if="plugin.status === 'discovered'">
              <tiny-button
                size="small"
                type="primary"
                :loading="actionLoading === plugin.name"
                @click="installPlugin(plugin.name)"
              >
                安装
              </tiny-button>
            </template>

            <!-- 已安装/禁用状态 -->
            <template v-else-if="plugin.status === 'installed' || plugin.status === 'disabled'">
              <tiny-button
                size="small"
                type="primary"
                :loading="actionLoading === plugin.name"
                @click="enablePlugin(plugin.name)"
              >
                启用
              </tiny-button>
              <tiny-button
                size="small"
                type="danger"
                plain
                :loading="actionLoading === plugin.name"
                @click="uninstallPlugin(plugin)"
              >
                卸载
              </tiny-button>
            </template>

            <!-- 已启用状态 -->
            <template v-else-if="plugin.status === 'enabled'">
              <tiny-button
                size="small"
                :loading="actionLoading === plugin.name"
                @click="disablePlugin(plugin.name)"
              >
                禁用
              </tiny-button>
              <tiny-button
                size="small"
                :loading="actionLoading === plugin.name"
                @click="reloadPlugin(plugin.name)"
              >
                重载
              </tiny-button>
            </template>

            <!-- 错误状态 -->
            <template v-else-if="plugin.status === 'error'">
              <tiny-button
                size="small"
                :loading="actionLoading === plugin.name"
                @click="reloadPlugin(plugin.name)"
              >
                重试
              </tiny-button>
              <tiny-button
                size="small"
                type="danger"
                plain
                :loading="actionLoading === plugin.name"
                @click="uninstallPlugin(plugin)"
              >
                卸载
              </tiny-button>
            </template>

            <!-- 通用按钮 -->
            <tiny-button
              v-if="hasConfig(plugin)"
              size="small"
              @click="openConfigModal(plugin)"
            >
              配置
            </tiny-button>
            <tiny-button size="small" @click="viewDetail(plugin)">
              详情
            </tiny-button>
          </div>
        </div>
      </div>

      <!-- 配置对话框 -->
      <tiny-modal
        v-model="showConfigModal"
        :title="`配置插件: ${configPlugin?.name || ''}`"
        width="600px"
      >
        <div v-if="configPlugin?.manifest?.config" class="config-form">
          <div
            v-for="(field, key) in configPlugin.manifest.config"
            :key="key"
            class="config-field"
          >
            <label class="config-label">
              {{ key }}
              <span v-if="field.required" class="required">*</span>
            </label>
            <p v-if="field.description" class="config-description">{{ field.description }}</p>

            <!-- 字符串类型 -->
            <tiny-input
              v-if="field.type === 'string'"
              v-model="configForm[key as string]"
              :placeholder="field.default?.toString()"
            />

            <!-- 数字类型 -->
            <tiny-input-number
              v-else-if="field.type === 'number'"
              v-model="configForm[key as string]"
              :min="field.min"
              :max="field.max"
              :placeholder="field.default?.toString()"
            />

            <!-- 布尔类型 -->
            <tiny-switch
              v-else-if="field.type === 'boolean'"
              v-model="configForm[key as string]"
            />

            <!-- 枚举类型 -->
            <tiny-select
              v-else-if="field.enum"
              v-model="configForm[key as string]"
            >
              <tiny-option
                v-for="opt in field.enum"
                :key="String(opt)"
                :label="String(opt)"
                :value="opt"
              />
            </tiny-select>

            <!-- 其他类型 -->
            <tiny-input
              v-else
              v-model="configForm[key as string]"
            />
          </div>
        </div>

        <div v-if="configErrors.length" class="config-errors">
          <div v-for="error in configErrors" :key="error" class="error-item">
            <icon-warning /> {{ error }}
          </div>
        </div>

        <template #footer>
          <tiny-button @click="showConfigModal = false">取消</tiny-button>
          <tiny-button @click="validateConfig">验证</tiny-button>
          <tiny-button type="primary" :loading="configLoading" @click="saveConfig">
            保存
          </tiny-button>
        </template>
      </tiny-modal>

      <!-- 详情对话框 -->
      <tiny-modal
        v-model="showDetailModal"
        :title="detailPlugin?.name || '插件详情'"
        width="700px"
      >
        <div v-if="detailPlugin" class="plugin-detail">
          <!-- 基本信息 -->
          <div class="detail-section">
            <h4>基本信息</h4>
            <div class="detail-grid">
              <div class="detail-item">
                <span class="label">名称:</span>
                <span class="value">{{ detailPlugin.name }}</span>
              </div>
              <div class="detail-item">
                <span class="label">版本:</span>
                <span class="value">{{ detailPlugin.version }}</span>
              </div>
              <div class="detail-item">
                <span class="label">状态:</span>
                <tiny-tag :type="getStatusType(detailPlugin.status)" size="small">
                  {{ getStatusText(detailPlugin.status) }}
                </tiny-tag>
              </div>
              <div class="detail-item">
                <span class="label">作者:</span>
                <span class="value">{{ detailPlugin.author || "-" }}</span>
              </div>
            </div>
          </div>

          <!-- 描述 -->
          <div v-if="detailPlugin.description" class="detail-section">
            <h4>描述</h4>
            <p>{{ detailPlugin.description }}</p>
          </div>

          <!-- 能力 -->
          <div v-if="detailPlugin.capabilities" class="detail-section">
            <h4>能力</h4>

            <!-- 工具 -->
            <div v-if="detailPlugin.capabilities.tools?.length" class="capability-list">
              <h5>工具 ({{ detailPlugin.capabilities.tools.length }})</h5>
              <div
                v-for="tool in detailPlugin.capabilities.tools"
                :key="tool.name"
                class="capability-item"
              >
                <code>{{ tool.name }}</code>
                <span class="desc">{{ tool.description }}</span>
              </div>
            </div>

            <!-- 命令 -->
            <div v-if="detailPlugin.capabilities.commands?.length" class="capability-list">
              <h5>命令 ({{ detailPlugin.capabilities.commands.length }})</h5>
              <div
                v-for="cmd in detailPlugin.capabilities.commands"
                :key="cmd.name"
                class="capability-item"
              >
                <code>/{{ cmd.name }}</code>
                <span v-if="cmd.aliases?.length" class="aliases">
                  ({{ cmd.aliases.map((a) => `/${a}`).join(", ") }})
                </span>
                <span class="desc">{{ cmd.description }}</span>
              </div>
            </div>

            <!-- 消息处理器 -->
            <div v-if="detailPlugin.capabilities.messageHandlers" class="capability-summary">
              <span>消息处理器: {{ detailPlugin.capabilities.messageHandlers }} 个</span>
            </div>

            <!-- 定时任务 -->
            <div v-if="detailPlugin.capabilities.scheduledTasks" class="capability-summary">
              <span>定时任务: {{ detailPlugin.capabilities.scheduledTasks }} 个</span>
            </div>
          </div>

          <!-- 错误信息 -->
          <div v-if="detailPlugin.error" class="detail-section error-section">
            <h4>错误信息</h4>
            <pre>{{ detailPlugin.error }}</pre>
          </div>
        </div>

        <template #footer>
          <tiny-button @click="showDetailModal = false">关闭</tiny-button>
        </template>
      </tiny-modal>
    </div>
  </DashboardLayout>
</template>

<style scoped>
.plugins-page {
  padding: 24px;
  max-width: 1400px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.page-title {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
}

.header-actions {
  display: flex;
  gap: 12px;
}

/* 统计卡片 */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}

.stat-card {
  background: var(--tiny-color-bg-2);
  border-radius: 8px;
  padding: 20px;
  text-align: center;
  border: 1px solid var(--tiny-color-border);
}

.stat-card.success {
  border-color: var(--tiny-color-success);
}

.stat-card.warning {
  border-color: var(--tiny-color-warning);
}

.stat-card.danger {
  border-color: var(--tiny-color-danger);
}

.stat-value {
  font-size: 32px;
  font-weight: 700;
  color: var(--tiny-color-text-1);
}

.stat-label {
  font-size: 14px;
  color: var(--tiny-color-text-3);
  margin-top: 4px;
}

/* 过滤栏 */
.filter-bar {
  display: flex;
  gap: 16px;
  margin-bottom: 24px;
}

.search-input {
  flex: 1;
  max-width: 400px;
}

.status-filter {
  width: 150px;
}

/* 插件网格 */
.plugin-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
  gap: 20px;
}

.plugin-card {
  background: var(--tiny-color-bg-2);
  border-radius: 12px;
  padding: 20px;
  border: 1px solid var(--tiny-color-border);
  transition: box-shadow 0.2s;
}

.plugin-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.plugin-header {
  margin-bottom: 12px;
}

.plugin-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.plugin-title h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.plugin-meta {
  display: flex;
  gap: 12px;
  margin-top: 4px;
  font-size: 12px;
  color: var(--tiny-color-text-3);
}

.plugin-description {
  margin: 0 0 12px;
  font-size: 14px;
  color: var(--tiny-color-text-2);
  line-height: 1.5;
}

.plugin-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 12px;
}

.plugin-error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--tiny-color-danger-bg);
  border-radius: 6px;
  margin-bottom: 12px;
  font-size: 13px;
  color: var(--tiny-color-danger);
}

.plugin-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--tiny-color-border);
}

/* 加载和空状态 */
.loading-placeholder,
.empty-placeholder {
  text-align: center;
  padding: 60px 20px;
  color: var(--tiny-color-text-3);
}

.empty-placeholder p {
  margin-bottom: 16px;
}

/* 配置表单 */
.config-form {
  max-height: 400px;
  overflow-y: auto;
}

.config-field {
  margin-bottom: 16px;
}

.config-label {
  display: block;
  font-weight: 500;
  margin-bottom: 4px;
}

.config-label .required {
  color: var(--tiny-color-danger);
  margin-left: 2px;
}

.config-description {
  font-size: 12px;
  color: var(--tiny-color-text-3);
  margin: 0 0 8px;
}

.config-errors {
  margin-top: 16px;
  padding: 12px;
  background: var(--tiny-color-danger-bg);
  border-radius: 6px;
}

.error-item {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--tiny-color-danger);
  margin-bottom: 4px;
}

.error-item:last-child {
  margin-bottom: 0;
}

/* 详情对话框 */
.plugin-detail {
  max-height: 500px;
  overflow-y: auto;
}

.detail-section {
  margin-bottom: 20px;
}

.detail-section h4 {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 600;
  color: var(--tiny-color-text-2);
  border-bottom: 1px solid var(--tiny-color-border);
  padding-bottom: 8px;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.detail-item {
  display: flex;
  gap: 8px;
}

.detail-item .label {
  color: var(--tiny-color-text-3);
  min-width: 60px;
}

.detail-item .value {
  color: var(--tiny-color-text-1);
}

.capability-list {
  margin-bottom: 16px;
}

.capability-list h5 {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 500;
}

.capability-item {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  font-size: 13px;
}

.capability-item code {
  background: var(--tiny-color-bg-3);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: monospace;
}

.capability-item .aliases {
  color: var(--tiny-color-text-3);
  font-size: 12px;
}

.capability-item .desc {
  color: var(--tiny-color-text-2);
}

.capability-summary {
  font-size: 13px;
  color: var(--tiny-color-text-2);
  margin-bottom: 4px;
}

.error-section pre {
  background: var(--tiny-color-danger-bg);
  padding: 12px;
  border-radius: 6px;
  font-size: 12px;
  overflow-x: auto;
  color: var(--tiny-color-danger);
}

/* 响应式 */
@media (max-width: 768px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .plugin-grid {
    grid-template-columns: 1fr;
  }

  .filter-bar {
    flex-direction: column;
  }

  .search-input {
    max-width: none;
  }

  .status-filter {
    width: 100%;
  }
}
</style>
