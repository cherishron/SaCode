<script setup lang="ts">
import { ref, reactive, computed, onMounted } from "vue";
import { useAuthStore } from "@/stores/auth";
import { useThemeStore, type Theme } from "@/stores/theme";
import { Modal as TinyModal, Notify } from "@opentiny/vue";
import { api } from "@/lib/api";
import DashboardLayout from "./DashboardLayout.vue";

const authStore = useAuthStore();
const themeStore = useThemeStore();
const activeTab = ref("general");

// ============ API Key 管理 ============
interface ApiKeyProvider {
  id: string;
  name: string;
  defaultBaseUrl: string;
}

interface ApiKeyConfig {
  id: string;
  provider: string;
  name: string;
  maskedKey: string;
  baseUrl: string | null;
  enabled: boolean;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const providers = ref<ApiKeyProvider[]>([]);
const apiKeys = ref<ApiKeyConfig[]>([]);
const apiKeysLoading = ref(false);

// 编辑中的 API Key
const editingKey = reactive({
  provider: "",
  apiKey: "",
  baseUrl: "",
  name: "",
  enabled: true,
});
const showApiKeyModal = ref(false);
const savingKey = ref(false);
const testingKey = ref(false);

// 加载提供商列表
async function loadProviders() {
  try {
    const response = await api.get<{ providers: ApiKeyProvider[] }>("/settings/providers");
    providers.value = response.providers;
  } catch (error) {
    console.error("加载提供商列表失败:", error);
  }
}

// 加载已配置的 API Keys
async function loadApiKeys() {
  apiKeysLoading.value = true;
  try {
    const response = await api.get<{ keys: ApiKeyConfig[] }>("/settings/keys");
    apiKeys.value = response.keys;
  } catch (error) {
    console.error("加载 API Keys 失败:", error);
  } finally {
    apiKeysLoading.value = false;
  }
}

// 获取提供商名称
function getProviderName(providerId: string): string {
  return providers.value.find((p) => p.id === providerId)?.name || providerId;
}

// 获取提供商默认 URL
function getProviderDefaultUrl(providerId: string): string {
  return providers.value.find((p) => p.id === providerId)?.defaultBaseUrl || "";
}

// 打开编辑对话框
function openApiKeyModal(providerId: string) {
  const existing = apiKeys.value.find((k) => k.provider === providerId);
  const provider = providers.value.find((p) => p.id === providerId);

  editingKey.provider = providerId;
  editingKey.name = existing?.name || provider?.name || "";
  editingKey.apiKey = "";
  editingKey.baseUrl = existing?.baseUrl || provider?.defaultBaseUrl || "";
  editingKey.enabled = existing?.enabled ?? true;

  showApiKeyModal.value = true;
}

// 保存 API Key
async function saveApiKey() {
  if (!editingKey.apiKey && !apiKeys.value.find((k) => k.provider === editingKey.provider)) {
    Notify({ type: "error", title: "请输入 API 密钥" });
    return;
  }

  savingKey.value = true;
  try {
    const payload: {
      provider: string;
      apiKey?: string;
      baseUrl?: string;
      name: string;
      enabled: boolean;
    } = {
      provider: editingKey.provider,
      name: editingKey.name,
      enabled: editingKey.enabled,
    };

    // 只有输入了新密钥才发送
    if (editingKey.apiKey) {
      payload.apiKey = editingKey.apiKey;
    }
    if (editingKey.baseUrl) {
      payload.baseUrl = editingKey.baseUrl;
    }

    const response = await api.post<{ success: boolean; key: ApiKeyConfig }>("/settings/keys", payload);

    if (response.success) {
      Notify({ type: "success", title: "保存成功" });
      showApiKeyModal.value = false;
      await loadApiKeys();
    }
  } catch (error) {
    console.error("保存失败:", error);
    Notify({ type: "error", title: "保存失败" });
  } finally {
    savingKey.value = false;
  }
}

// 测试 API Key 连接
async function testApiKey() {
  if (!editingKey.provider) return;

  testingKey.value = true;
  try {
    const response = await api.post<{ success: boolean; message: string }>(
      `/settings/keys/${editingKey.provider}/test`
    );

    if (response.success) {
      Notify({ type: "success", title: response.message });
    } else {
      Notify({ type: "error", title: response.message });
    }
  } catch (error) {
    console.error("测试失败:", error);
    Notify({ type: "error", title: "测试连接失败" });
  } finally {
    testingKey.value = false;
  }
}

// 删除 API Key
function deleteApiKey(providerId: string) {
  const key = apiKeys.value.find((k) => k.provider === providerId);
  if (!key) return;

  TinyModal.confirm({
    title: "确认删除",
    message: `确定要删除「${getProviderName(providerId)}」的 API 密钥吗？`,
    onConfirm: async () => {
      try {
        await api.delete(`/settings/keys/${providerId}`);
        Notify({ type: "success", title: "删除成功" });
        await loadApiKeys();
      } catch (error) {
        console.error("删除失败:", error);
        Notify({ type: "error", title: "删除失败" });
      }
    },
  });
}

// 切换启用状态
async function toggleApiKeyEnabled(providerId: string) {
  const key = apiKeys.value.find((k) => k.provider === providerId);
  if (!key) return;

  try {
    await api.patch(`/settings/keys/${providerId}`, { enabled: !key.enabled });
    key.enabled = !key.enabled;
    Notify({ type: "success", title: key.enabled ? "已启用" : "已禁用" });
  } catch (error) {
    console.error("切换状态失败:", error);
    Notify({ type: "error", title: "操作失败" });
  }
}

// 初始化加载
onMounted(() => {
  loadProviders();
  loadApiKeys();
  loadOAuthProviders();
  loadOAuthConfigs();
});
// ============ API Key 管理 End ============

// ============ OAuth 配置管理 ============
interface OAuthProvider {
  id: string;
  name: string;
  requiresCallback: boolean;
  requiresCorpId: boolean;
  requiresAgentId: boolean;
}

interface OAuthConfig {
  id: string;
  provider: string;
  name: string;
  maskedClientId: string;
  maskedClientSecret?: string;
  callbackUrl: string | null;
  corpId: string | null;
  agentId: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

const oauthProviders = ref<OAuthProvider[]>([]);
const oauthConfigs = ref<OAuthConfig[]>([]);
const oauthLoading = ref(false);

// 编辑中的 OAuth 配置
const editingOAuth = reactive({
  provider: "",
  clientId: "",
  clientSecret: "",
  callbackUrl: "",
  corpId: "",
  agentId: "",
  name: "",
  enabled: true,
});
const showOAuthModal = ref(false);
const savingOAuth = ref(false);

// 加载 OAuth 提供商列表
async function loadOAuthProviders() {
  try {
    const response = await api.get<{ providers: OAuthProvider[] }>("/settings/oauth/providers");
    oauthProviders.value = response.providers;
  } catch (error) {
    console.error("加载 OAuth 提供商列表失败:", error);
  }
}

// 加载已配置的 OAuth
async function loadOAuthConfigs() {
  oauthLoading.value = true;
  try {
    const response = await api.get<{ configs: OAuthConfig[] }>("/settings/oauth");
    oauthConfigs.value = response.configs;
  } catch (error) {
    console.error("加载 OAuth 配置失败:", error);
  } finally {
    oauthLoading.value = false;
  }
}

// 获取 OAuth 提供商名称
function getOAuthProviderName(providerId: string): string {
  return oauthProviders.value.find((p) => p.id === providerId)?.name || providerId;
}

// 打开 OAuth 编辑对话框
function openOAuthModal(providerId: string) {
  const existing = oauthConfigs.value.find((c) => c.provider === providerId);
  const provider = oauthProviders.value.find((p) => p.id === providerId);

  editingOAuth.provider = providerId;
  editingOAuth.name = existing?.name || provider?.name || "";
  editingOAuth.clientId = "";
  editingOAuth.clientSecret = "";
  editingOAuth.callbackUrl = existing?.callbackUrl || "";
  editingOAuth.corpId = existing?.corpId || "";
  editingOAuth.agentId = existing?.agentId || "";
  editingOAuth.enabled = existing?.enabled ?? true;

  showOAuthModal.value = true;
}

// 保存 OAuth 配置
async function saveOAuthConfig() {
  if (!editingOAuth.clientId && !oauthConfigs.value.find((c) => c.provider === editingOAuth.provider)) {
    Notify({ type: "error", title: "请输入 Client ID" });
    return;
  }

  savingOAuth.value = true;
  try {
    const payload: {
      provider: string;
      clientId?: string;
      clientSecret?: string;
      callbackUrl?: string;
      corpId?: string;
      agentId?: string;
      name: string;
      enabled: boolean;
    } = {
      provider: editingOAuth.provider,
      name: editingOAuth.name,
      enabled: editingOAuth.enabled,
    };

    if (editingOAuth.clientId) {
      payload.clientId = editingOAuth.clientId;
    }
    if (editingOAuth.clientSecret) {
      payload.clientSecret = editingOAuth.clientSecret;
    }
    if (editingOAuth.callbackUrl) {
      payload.callbackUrl = editingOAuth.callbackUrl;
    }
    if (editingOAuth.corpId) {
      payload.corpId = editingOAuth.corpId;
    }
    if (editingOAuth.agentId) {
      payload.agentId = editingOAuth.agentId;
    }

    const response = await api.post<{ success: boolean; config: OAuthConfig }>("/settings/oauth", payload);

    if (response.success) {
      Notify({ type: "success", title: "保存成功" });
      showOAuthModal.value = false;
      await loadOAuthConfigs();
    }
  } catch (error) {
    console.error("保存失败:", error);
    Notify({ type: "error", title: "保存失败" });
  } finally {
    savingOAuth.value = false;
  }
}

// 删除 OAuth 配置
function deleteOAuthConfig(providerId: string) {
  const config = oauthConfigs.value.find((c) => c.provider === providerId);
  if (!config) return;

  TinyModal.confirm({
    title: "确认删除",
    message: `确定要删除「${getOAuthProviderName(providerId)}」的 OAuth 配置吗？`,
    onConfirm: async () => {
      try {
        await api.delete(`/settings/oauth/${providerId}`);
        Notify({ type: "success", title: "删除成功" });
        await loadOAuthConfigs();
      } catch (error) {
        console.error("删除失败:", error);
        Notify({ type: "error", title: "删除失败" });
      }
    },
  });
}

// 切换 OAuth 启用状态
async function toggleOAuthEnabled(providerId: string) {
  const config = oauthConfigs.value.find((c) => c.provider === providerId);
  if (!config) return;

  try {
    const response = await api.post<{ success: boolean; enabled: boolean }>(
      `/settings/oauth/${providerId}/toggle`,
      { enabled: !config.enabled }
    );
    if (response.success) {
      config.enabled = response.enabled;
      Notify({ type: "success", title: response.enabled ? "已启用" : "已禁用" });
    }
  } catch (error) {
    console.error("切换状态失败:", error);
    Notify({ type: "error", title: "操作失败" });
  }
}

// 获取默认回调 URL
function getDefaultCallbackUrl(providerId: string): string {
  const baseUrl = window.location.origin.replace(/:\d+$/, ":3000");
  return `${baseUrl}/api/auth/oauth/${providerId}/callback`;
}
// ============ OAuth 配置管理 End ============

// 环境检测：生产环境隐藏敏感配置
const isDev = import.meta.env.DEV;

const generalSettings = reactive({
  language: "zh-CN",
  theme: themeStore.theme,
  timezone: "Asia/Shanghai",
});

// 当前有效主题显示
const currentEffectiveTheme = computed(() => {
  if (themeStore.isDark) return "深色模式";
  return "浅色模式";
});

const aiSettings = reactive({
  defaultModel: "gpt-4",
  temperature: 0.7,
  maxTokens: 4096,
  acpUrl: "ws://localhost:8090/acp",
  timeout: 60000,
});

// AI 设置边界常量
const AI_LIMITS = {
  temperatureMin: 0,
  temperatureMax: 2,
  maxTokensMin: 256,
  maxTokensMax: 32768,
  timeoutMin: 5000,
  timeoutMax: 300000,
} as const;

// 修改密码相关
const showPasswordModal = ref(false);
const passwordForm = reactive({
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
});
const passwordLoading = ref(false);

// ============ 个人资料编辑 ============
const profileForm = reactive({
  username: "",
  email: "",
});
const avatarPreview = ref<string | null>(null);
const avatarFile = ref<File | null>(null);
const profileLoading = ref(false);
const avatarLoading = ref(false);

// 选择头像文件
function handleAvatarSelect(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (!file) return;

  // 验证文件类型
  const validTypes = ["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"];
  if (!validTypes.includes(file.type)) {
    Notify({ type: "error", title: "请选择有效的图片文件 (PNG, JPG, GIF, WebP)" });
    return;
  }

  // 验证文件大小 (最大 2MB)
  if (file.size > 2 * 1024 * 1024) {
    Notify({ type: "error", title: "图片大小不能超过 2MB" });
    return;
  }

  avatarFile.value = file;

  // 预览图片
  const reader = new FileReader();
  reader.onload = (e) => {
    avatarPreview.value = e.target?.result as string;
  };
  reader.readAsDataURL(file);
}

// 上传头像
async function uploadAvatar() {
  if (!avatarPreview.value) {
    Notify({ type: "error", title: "请先选择头像图片" });
    return;
  }

  avatarLoading.value = true;

  try {
    const response = await api.post<{ success: boolean; user: { id: string; username: string; email: string; avatar: string } }>("/auth/avatar", {
      avatar: avatarPreview.value,
    });

    // 更新 authStore 中的用户信息
    if (response.user && authStore.user) {
      authStore.user.avatar = response.user.avatar;
    }

    Notify({ type: "success", title: "头像上传成功" });
    avatarFile.value = null;
    avatarPreview.value = null;
  } catch (error) {
    console.error("头像上传失败:", error);
    Notify({ type: "error", title: "头像上传失败" });
  } finally {
    avatarLoading.value = false;
  }
}

// 删除头像
async function deleteAvatar() {
  TinyModal.confirm({
    title: "确认删除",
    message: "确定要删除当前头像吗？",
    onConfirm: async () => {
      try {
        const response = await api.delete<{ success: boolean; user: { id: string; username: string; email: string; avatar: null } }>("/auth/avatar");

        // 更新 authStore 中的用户信息
        if (response.user && authStore.user) {
          authStore.user.avatar = undefined;
        }

        Notify({ type: "success", title: "头像已删除" });
      } catch (error) {
        console.error("删除头像失败:", error);
        Notify({ type: "error", title: "删除头像失败" });
      }
    },
  });
}

// 取消头像选择
function cancelAvatarSelect() {
  avatarFile.value = null;
  avatarPreview.value = null;
}

// 打开个人资料编辑
function openProfileEdit() {
  profileForm.username = authStore.user?.username || "";
  profileForm.email = authStore.user?.email || "";
}

// 保存个人资料
async function saveProfile() {
  // 验证用户名
  if (profileForm.username && (profileForm.username.length < 2 || profileForm.username.length > 50)) {
    Notify({ type: "error", title: "用户名长度必须在 2-50 个字符之间" });
    return;
  }

  // 验证邮箱格式
  if (profileForm.email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(profileForm.email)) {
      Notify({ type: "error", title: "邮箱格式不正确" });
      return;
    }
  }

  profileLoading.value = true;

  try {
    const response = await api.put<{ success: boolean; user: { id: string; username: string; email: string; avatar: string | null } }>("/auth/profile", {
      username: profileForm.username,
      email: profileForm.email,
    });

    // 更新 authStore 中的用户信息
    if (response.user && authStore.user) {
      authStore.user.username = response.user.username;
      authStore.user.email = response.user.email;
    }

    Notify({ type: "success", title: "个人资料更新成功" });
  } catch (error) {
    console.error("更新个人资料失败:", error);
    Notify({ type: "error", title: "更新个人资料失败" });
  } finally {
    profileLoading.value = false;
  }
}

/**
 * 限制数值在指定范围内
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// 敏感配置脱敏显示
const maskedAcpUrl = computed(() => {
  if (!aiSettings.acpUrl) return "";
  if (isDev) return aiSettings.acpUrl;

  // 生产环境脱敏：显示协议和端口，隐藏路径
  try {
    const url = new URL(aiSettings.acpUrl);
    return `${url.protocol}//${url.hostname}:${url.port}/***`;
  } catch {
    return "***";
  }
});

const pluginSettings = reactive({
  autoUpdate: true,
  enableSandbox: true,
  allowedDomains: [] as string[],
});

const plugins = ref([
  { id: "1", name: "天气查询", version: "1.0.0", enabled: true },
  { id: "2", name: "翻译助手", version: "1.2.0", enabled: true },
  { id: "3", name: "代码执行", version: "0.9.0", enabled: false },
]);

async function saveGeneralSettings() {
  // 应用主题设置
  themeStore.setTheme(generalSettings.theme as Theme);
  // TODO: 保存其他设置到服务器
  console.log("Save general settings:", generalSettings);
}

// 主题切换时立即应用
function onThemeChange(value: Theme) {
  themeStore.setTheme(value);
}

async function saveAISettings() {
  // 边界校验并修正
  aiSettings.temperature = clamp(
    aiSettings.temperature,
    AI_LIMITS.temperatureMin,
    AI_LIMITS.temperatureMax
  );
  aiSettings.maxTokens = clamp(
    aiSettings.maxTokens,
    AI_LIMITS.maxTokensMin,
    AI_LIMITS.maxTokensMax
  );
  aiSettings.timeout = clamp(
    aiSettings.timeout,
    AI_LIMITS.timeoutMin,
    AI_LIMITS.timeoutMax
  );

  // TODO: 保存 AI 设置
  console.log("Save AI settings:", aiSettings);
}

async function savePluginSettings() {
  // TODO: 保存插件设置
  console.log("Save plugin settings:", pluginSettings);
}

function togglePlugin(id: string) {
  const plugin = plugins.value.find((p) => p.id === id);
  if (plugin) {
    plugin.enabled = !plugin.enabled;
  }
}

function deletePlugin(id: string) {
  const index = plugins.value.findIndex((p) => p.id === id);
  if (index === -1) return;

  const plugin = plugins.value[index]!;

  TinyModal.confirm({
    title: "确认删除",
    message: `确定要删除插件「${plugin.name}」吗？此操作不可恢复。`,
    onConfirm: () => {
      plugins.value.splice(index, 1);
    },
  });
}

// 打开修改密码对话框
function openPasswordModal() {
  passwordForm.currentPassword = "";
  passwordForm.newPassword = "";
  passwordForm.confirmPassword = "";
  showPasswordModal.value = true;
}

// 修改密码
async function changePassword() {
  // 验证
  if (!passwordForm.currentPassword || !passwordForm.newPassword) {
    Notify({ type: "error", title: "请填写所有密码字段" });
    return;
  }

  if (passwordForm.newPassword.length < 6) {
    Notify({ type: "error", title: "新密码至少需要 6 个字符" });
    return;
  }

  if (passwordForm.newPassword !== passwordForm.confirmPassword) {
    Notify({ type: "error", title: "两次输入的新密码不一致" });
    return;
  }

  passwordLoading.value = true;

  try {
    await api.put("/auth/password", {
      currentPassword: passwordForm.currentPassword,
      newPassword: passwordForm.newPassword,
    });

    Notify({ type: "success", title: "密码修改成功" });
    showPasswordModal.value = false;
  } catch (error) {
    console.error("密码修改失败:", error);
    Notify({ type: "error", title: "密码修改失败，请检查当前密码是否正确" });
  } finally {
    passwordLoading.value = false;
  }
}
</script>

<template>
  <DashboardLayout>
    <div class="settings-page">
      <h2 class="page-title">设置</h2>

      <tiny-tabs v-model="activeTab">
        <!-- 通用设置 -->
        <tiny-tab-item title="通用" name="general">
          <tiny-card class="settings-card">
            <tiny-form label-width="100px">
              <tiny-form-item label="语言">
                <tiny-select v-model="generalSettings.language">
                  <tiny-option label="简体中文" value="zh-CN" />
                  <tiny-option label="English" value="en-US" />
                </tiny-select>
              </tiny-form-item>

              <tiny-form-item label="主题">
                <div class="theme-setting">
                  <tiny-radio-group v-model="generalSettings.theme" @change="onThemeChange">
                    <tiny-radio label="light">浅色</tiny-radio>
                    <tiny-radio label="dark">深色</tiny-radio>
                    <tiny-radio label="auto">跟随系统</tiny-radio>
                  </tiny-radio-group>
                  <span class="theme-status">当前: {{ currentEffectiveTheme }}</span>
                </div>
              </tiny-form-item>

              <tiny-form-item label="时区">
                <tiny-select v-model="generalSettings.timezone">
                  <tiny-option label="北京时间 (UTC+8)" value="Asia/Shanghai" />
                  <tiny-option label="东京时间 (UTC+9)" value="Asia/Tokyo" />
                  <tiny-option label="纽约时间 (UTC-5)" value="America/New_York" />
                </tiny-select>
              </tiny-form-item>

              <tiny-form-item>
                <tiny-button type="primary" @click="saveGeneralSettings">
                  保存设置
                </tiny-button>
              </tiny-form-item>
            </tiny-form>
          </tiny-card>
        </tiny-tab-item>

        <!-- AI 设置 -->
        <tiny-tab-item title="AI 配置" name="ai">
          <tiny-card class="settings-card">
            <tiny-form label-width="100px">
              <tiny-form-item label="默认模型">
                <tiny-select v-model="aiSettings.defaultModel">
                  <tiny-option label="GPT-4" value="gpt-4" />
                  <tiny-option label="GPT-4 Turbo" value="gpt-4-turbo" />
                  <tiny-option label="GPT-3.5 Turbo" value="gpt-3.5-turbo" />
                  <tiny-option label="Claude 3 Opus" value="claude-3-opus" />
                  <tiny-option label="Claude 3 Sonnet" value="claude-3-sonnet" />
                </tiny-select>
              </tiny-form-item>

              <tiny-form-item label="Temperature">
                <tiny-slider v-model="aiSettings.temperature" :min="0" :max="2" :step="0.1" />
                <span class="slider-value">{{ aiSettings.temperature }}</span>
              </tiny-form-item>

              <tiny-form-item label="最大 Token">
                <tiny-input-number v-model="aiSettings.maxTokens" :min="256" :max="32768" />
              </tiny-form-item>

              <tiny-form-item label="ACP 地址">
                <tiny-input
                  :model-value="isDev ? aiSettings.acpUrl : maskedAcpUrl"
                  :disabled="!isDev"
                  placeholder="WebSocket 地址"
                />
                <span v-if="!isDev" class="config-hint">生产环境配置已隐藏</span>
              </tiny-form-item>

              <tiny-form-item label="超时时间">
                <tiny-input-number v-model="aiSettings.timeout" :min="5000" :max="300000" />
                <span class="unit">毫秒</span>
              </tiny-form-item>

              <tiny-form-item>
                <tiny-button type="primary" @click="saveAISettings"> 保存设置 </tiny-button>
              </tiny-form-item>
            </tiny-form>
          </tiny-card>
        </tiny-tab-item>

        <!-- 插件管理 -->
        <tiny-tab-item title="插件" name="plugins">
          <tiny-card class="settings-card">
            <template #header>
              <div class="card-header">
                <h3>已安装插件</h3>
                <tiny-button size="small" icon="plus"> 安装插件 </tiny-button>
              </div>
            </template>

            <div class="plugin-list">
              <div v-for="plugin in plugins" :key="plugin.id" class="plugin-item">
                <div class="plugin-info">
                  <span class="plugin-name">{{ plugin.name }}</span>
                  <tiny-tag size="small">v{{ plugin.version }}</tiny-tag>
                </div>
                <div class="plugin-actions">
                  <tiny-switch
                    :model-value="plugin.enabled"
                    @change="togglePlugin(plugin.id)"
                  />
                  <tiny-button size="mini" type="danger" @click="deletePlugin(plugin.id)">
                    删除
                  </tiny-button>
                </div>
              </div>
            </div>

            <tiny-divider />

            <tiny-form label-width="100px">
              <tiny-form-item label="自动更新">
                <tiny-switch v-model="pluginSettings.autoUpdate" />
              </tiny-form-item>

              <tiny-form-item label="沙箱模式">
                <tiny-switch v-model="pluginSettings.enableSandbox" />
              </tiny-form-item>

              <tiny-form-item>
                <tiny-button type="primary" @click="savePluginSettings">
                  保存设置
                </tiny-button>
              </tiny-form-item>
            </tiny-form>
          </tiny-card>
        </tiny-tab-item>

        <!-- 账户设置 -->
        <tiny-tab-item title="账户" name="account">
          <tiny-card class="settings-card">
            <!-- 头像编辑 -->
            <div class="avatar-section">
              <div class="avatar-container">
                <tiny-avatar
                  :src="avatarPreview || authStore.user?.avatar"
                  :text="authStore.user?.username?.charAt(0).toUpperCase()"
                  size="large"
                />
                <div v-if="avatarPreview" class="avatar-preview-actions">
                  <tiny-button size="small" type="primary" :loading="avatarLoading" @click="uploadAvatar">
                    确认上传
                  </tiny-button>
                  <tiny-button size="small" @click="cancelAvatarSelect">
                    取消
                  </tiny-button>
                </div>
              </div>
              <div class="avatar-actions">
                <label class="upload-btn">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/gif,image/webp"
                    hidden
                    @change="handleAvatarSelect"
                  />
                  <tiny-button size="small" icon="upload">更换头像</tiny-button>
                </label>
                <tiny-button
                  v-if="authStore.user?.avatar"
                  size="small"
                  type="danger"
                  plain
                  @click="deleteAvatar"
                >
                  删除头像
                </tiny-button>
              </div>
              <p class="avatar-hint">支持 PNG、JPG、GIF、WebP 格式，最大 2MB</p>
            </div>

            <tiny-divider />

            <!-- 个人资料编辑 -->
            <tiny-form label-width="100px">
              <tiny-form-item label="用户名">
                <div class="form-input-row">
                  <tiny-input
                    v-model="profileForm.username"
                    placeholder="请输入用户名"
                    @focus="openProfileEdit"
                  />
                  <tiny-button
                    type="primary"
                    :loading="profileLoading"
                    :disabled="profileForm.username === authStore.user?.username"
                    @click="saveProfile"
                  >
                    保存
                  </tiny-button>
                </div>
                <span class="form-hint">用户名长度 2-50 个字符</span>
              </tiny-form-item>

              <tiny-form-item label="邮箱">
                <div class="form-input-row">
                  <tiny-input
                    v-model="profileForm.email"
                    placeholder="请输入邮箱"
                    @focus="openProfileEdit"
                  />
                  <tiny-button
                    type="primary"
                    :loading="profileLoading"
                    :disabled="profileForm.email === authStore.user?.email"
                    @click="saveProfile"
                  >
                    保存
                  </tiny-button>
                </div>
                <span class="form-hint">用于接收通知和找回密码</span>
              </tiny-form-item>

              <tiny-divider />

              <tiny-form-item label="修改密码">
                <tiny-button @click="openPasswordModal">修改密码</tiny-button>
              </tiny-form-item>

              <tiny-form-item>
                <tiny-button type="danger" @click="authStore.logout">
                  退出登录
                </tiny-button>
              </tiny-form-item>
            </tiny-form>
          </tiny-card>
        </tiny-tab-item>

        <!-- API Key 管理 -->
        <tiny-tab-item title="API 密钥" name="apikeys">
          <tiny-card class="settings-card">
            <template #header>
              <div class="card-header">
                <h3>AI 提供商 API 密钥</h3>
                <tiny-button
                  v-if="apiKeys.length > 0"
                  size="small"
                  icon="refresh"
                  :loading="apiKeysLoading"
                  @click="loadApiKeys"
                >
                  刷新
                </tiny-button>
              </div>
            </template>

            <div v-if="apiKeysLoading" class="loading-placeholder">
              加载中...
            </div>

            <div v-else class="api-key-list">
              <!-- 已配置的密钥 -->
              <div v-for="key in apiKeys" :key="key.provider" class="api-key-item">
                <div class="api-key-info">
                  <span class="provider-name">{{ key.name }}</span>
                  <tiny-tag size="small" :type="key.enabled ? 'success' : 'info'">
                    {{ key.provider }}
                  </tiny-tag>
                  <span class="masked-key">{{ key.maskedKey }}</span>
                </div>
                <div class="api-key-actions">
                  <tiny-switch
                    :model-value="key.enabled"
                    @change="toggleApiKeyEnabled(key.provider)"
                  />
                  <tiny-button size="mini" @click="openApiKeyModal(key.provider)">
                    编辑
                  </tiny-button>
                  <tiny-button size="mini" type="danger" @click="deleteApiKey(key.provider)">
                    删除
                  </tiny-button>
                </div>
              </div>

              <!-- 未配置的提供商 -->
              <tiny-divider v-if="apiKeys.length > 0" />

              <div class="unconfigured-providers">
                <h4>添加新密钥</h4>
                <div class="provider-grid">
                  <div
                    v-for="provider in providers.filter(p => !apiKeys.find(k => k.provider === p.id))"
                    :key="provider.id"
                    class="provider-card"
                    @click="openApiKeyModal(provider.id)"
                  >
                    <span class="provider-name">{{ provider.name }}</span>
                    <tiny-tag size="small" type="info">{{ provider.id }}</tiny-tag>
                  </div>
                </div>
              </div>

              <!-- 所有提供商都已配置 -->
              <div
                v-if="providers.length > 0 && apiKeys.length >= providers.length"
                class="all-configured"
              >
                <tiny-tag type="success">所有提供商已配置</tiny-tag>
              </div>
            </div>
          </tiny-card>
        </tiny-tab-item>

        <!-- OAuth 配置 -->
        <tiny-tab-item title="OAuth" name="oauth">
          <tiny-card class="settings-card">
            <template #header>
              <div class="card-header">
                <h3>OAuth 登录配置</h3>
                <tiny-button
                  v-if="oauthConfigs.length > 0"
                  size="small"
                  icon="refresh"
                  :loading="oauthLoading"
                  @click="loadOAuthConfigs"
                >
                  刷新
                </tiny-button>
              </div>
            </template>

            <div v-if="oauthLoading" class="loading-placeholder">
              加载中...
            </div>

            <div v-else class="oauth-list">
              <!-- 已配置的 OAuth -->
              <div v-for="config in oauthConfigs" :key="config.provider" class="oauth-item">
                <div class="oauth-info">
                  <span class="provider-name">{{ config.name }}</span>
                  <tiny-tag size="small" :type="config.enabled ? 'success' : 'info'">
                    {{ config.provider }}
                  </tiny-tag>
                  <span class="masked-key">{{ config.maskedClientId }}</span>
                </div>
                <div class="oauth-actions">
                  <tiny-switch
                    :model-value="config.enabled"
                    @change="toggleOAuthEnabled(config.provider)"
                  />
                  <tiny-button size="mini" @click="openOAuthModal(config.provider)">
                    编辑
                  </tiny-button>
                  <tiny-button size="mini" type="danger" @click="deleteOAuthConfig(config.provider)">
                    删除
                  </tiny-button>
                </div>
              </div>

              <!-- 未配置的提供商 -->
              <tiny-divider v-if="oauthConfigs.length > 0" />

              <div class="unconfigured-providers">
                <h4>添加 OAuth 登录</h4>
                <div class="provider-grid">
                  <div
                    v-for="provider in oauthProviders.filter(p => !oauthConfigs.find(c => c.provider === p.id))"
                    :key="provider.id"
                    class="provider-card"
                    @click="openOAuthModal(provider.id)"
                  >
                    <span class="provider-name">{{ provider.name }}</span>
                    <tiny-tag size="small" type="info">{{ provider.id }}</tiny-tag>
                  </div>
                </div>
              </div>

              <!-- 所有 OAuth 都已配置 -->
              <div
                v-if="oauthProviders.length > 0 && oauthConfigs.length >= oauthProviders.length"
                class="all-configured"
              >
                <tiny-tag type="success">所有 OAuth 已配置</tiny-tag>
              </div>
            </div>
          </tiny-card>
        </tiny-tab-item>
      </tiny-tabs>

      <!-- 修改密码对话框 -->
      <tiny-dialog-box
        v-model="showPasswordModal"
        title="修改密码"
        width="400px"
      >
        <tiny-form label-width="100px">
          <tiny-form-item label="当前密码">
            <tiny-input
              v-model="passwordForm.currentPassword"
              type="password"
              placeholder="请输入当前密码"
              show-password
            />
          </tiny-form-item>

          <tiny-form-item label="新密码">
            <tiny-input
              v-model="passwordForm.newPassword"
              type="password"
              placeholder="请输入新密码（至少 6 位）"
              show-password
            />
          </tiny-form-item>

          <tiny-form-item label="确认密码">
            <tiny-input
              v-model="passwordForm.confirmPassword"
              type="password"
              placeholder="请再次输入新密码"
              show-password
            />
          </tiny-form-item>
        </tiny-form>

        <template #footer>
          <tiny-button @click="showPasswordModal = false">取消</tiny-button>
          <tiny-button type="primary" :loading="passwordLoading" @click="changePassword">
            确认修改
          </tiny-button>
        </template>
      </tiny-dialog-box>

      <!-- API Key 编辑对话框 -->
      <tiny-dialog-box
        v-model="showApiKeyModal"
        :title="`配置 ${getProviderName(editingKey.provider)} API 密钥`"
        width="500px"
      >
        <tiny-form label-width="100px">
          <tiny-form-item label="提供商">
            <tiny-input :model-value="getProviderName(editingKey.provider)" disabled />
          </tiny-form-item>

          <tiny-form-item label="显示名称">
            <tiny-input
              v-model="editingKey.name"
              placeholder="输入自定义名称"
            />
          </tiny-form-item>

          <tiny-form-item label="API 密钥">
            <tiny-input
              v-model="editingKey.apiKey"
              type="password"
              placeholder="输入 API 密钥（留空则保留原密钥）"
              show-password
            />
            <span class="form-hint">
              密钥将被加密存储，留空则保留原有密钥
            </span>
          </tiny-form-item>

          <tiny-form-item label="API 地址">
            <tiny-input
              v-model="editingKey.baseUrl"
              :placeholder="`默认: ${getProviderDefaultUrl(editingKey.provider)}`"
            />
            <span class="form-hint">
              可自定义 API 端点地址（如使用代理服务）
            </span>
          </tiny-form-item>

          <tiny-form-item label="启用">
            <tiny-switch v-model="editingKey.enabled" />
          </tiny-form-item>
        </tiny-form>

        <template #footer>
          <tiny-button @click="showApiKeyModal = false">取消</tiny-button>
          <tiny-button :loading="testingKey" @click="testApiKey">
            测试连接
          </tiny-button>
          <tiny-button type="primary" :loading="savingKey" @click="saveApiKey">
            保存
          </tiny-button>
        </template>
      </tiny-dialog-box>

      <!-- OAuth 编辑对话框 -->
      <tiny-dialog-box
        v-model="showOAuthModal"
        :title="`配置 ${getOAuthProviderName(editingOAuth.provider)} OAuth`"
        width="500px"
      >
        <tiny-form label-width="100px">
          <tiny-form-item label="提供商">
            <tiny-input :model-value="getOAuthProviderName(editingOAuth.provider)" disabled />
          </tiny-form-item>

          <tiny-form-item label="显示名称">
            <tiny-input
              v-model="editingOAuth.name"
              placeholder="输入自定义名称"
            />
          </tiny-form-item>

          <tiny-form-item label="Client ID">
            <tiny-input
              v-model="editingOAuth.clientId"
              placeholder="输入 Client ID（留空则保留原值）"
            />
            <span class="form-hint">
              OAuth 应用的客户端 ID
            </span>
          </tiny-form-item>

          <tiny-form-item label="Client Secret">
            <tiny-input
              v-model="editingOAuth.clientSecret"
              type="password"
              placeholder="输入 Client Secret（留空则保留原值）"
              show-password
            />
            <span class="form-hint">
              密钥将被加密存储
            </span>
          </tiny-form-item>

          <tiny-form-item label="回调地址">
            <tiny-input
              v-model="editingOAuth.callbackUrl"
              :placeholder="`默认: ${getDefaultCallbackUrl(editingOAuth.provider)}`"
            />
            <span class="form-hint">
              OAuth 回调地址，需与 OAuth 提供商配置一致
            </span>
          </tiny-form-item>

          <tiny-form-item v-if="editingOAuth.provider === 'wework'" label="CorpID">
            <tiny-input
              v-model="editingOAuth.corpId"
              placeholder="企业微信 CorpID"
            />
          </tiny-form-item>

          <tiny-form-item v-if="editingOAuth.provider === 'wework'" label="AgentID">
            <tiny-input
              v-model="editingOAuth.agentId"
              placeholder="企业微信应用 AgentID"
            />
          </tiny-form-item>

          <tiny-form-item label="启用">
            <tiny-switch v-model="editingOAuth.enabled" />
          </tiny-form-item>
        </tiny-form>

        <template #footer>
          <tiny-button @click="showOAuthModal = false">取消</tiny-button>
          <tiny-button type="primary" :loading="savingOAuth" @click="saveOAuthConfig">
            保存
          </tiny-button>
        </template>
      </tiny-dialog-box>
    </div>
  </DashboardLayout>
</template>

<style scoped>
.settings-page {
  max-width: 800px;
}

.page-title {
  font-size: 24px;
  font-weight: 600;
  margin: 0 0 24px 0;
}

.settings-card {
  border-radius: 12px;
}

.slider-value {
  margin-left: 12px;
  font-weight: 500;
}

.unit {
  margin-left: 8px;
  color: #6b7280;
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

.plugin-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}

.plugin-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #f9fafb;
  border-radius: 8px;
}

.dark .plugin-item {
  background: #374151;
}

.plugin-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.plugin-name {
  font-weight: 500;
}

.plugin-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.user-info-section {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 0;
}

.user-details h3 {
  margin: 0 0 4px 0;
  font-size: 18px;
}

.user-details p {
  margin: 0;
  color: #6b7280;
}

.avatar-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 16px 0;
}

.avatar-container {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.avatar-preview-actions {
  display: flex;
  gap: 8px;
}

.avatar-actions {
  display: flex;
  gap: 8px;
}

.upload-btn {
  cursor: pointer;
}

.avatar-hint {
  font-size: 12px;
  color: #6b7280;
  margin: 0;
}

.form-input-row {
  display: flex;
  gap: 12px;
  align-items: center;
}

.form-input-row .tiny-input {
  flex: 1;
}

.theme-setting {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.theme-status {
  font-size: 12px;
  color: #6b7280;
}

.config-hint {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: #9ca3af;
}

.form-hint {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: #6b7280;
}

.loading-placeholder {
  padding: 24px;
  text-align: center;
  color: #6b7280;
}

.api-key-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.api-key-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #f9fafb;
  border-radius: 8px;
}

.dark .api-key-item {
  background: #374151;
}

.api-key-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.api-key-info .provider-name {
  font-weight: 500;
}

.api-key-info .masked-key {
  font-family: monospace;
  font-size: 12px;
  color: #6b7280;
}

.api-key-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.unconfigured-providers h4 {
  margin: 0 0 12px 0;
  font-size: 14px;
  font-weight: 500;
  color: #6b7280;
}

.provider-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
}

.provider-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: #f3f4f6;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.dark .provider-card {
  background: #4b5563;
}

.provider-card:hover {
  background: #e5e7eb;
  transform: translateY(-1px);
}

.dark .provider-card:hover {
  background: #6b7280;
}

.provider-card .provider-name {
  font-weight: 500;
}

.all-configured {
  text-align: center;
  padding: 16px;
}
</style>
