<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { CloseIcon } from 'tdesign-icons-vue-next';
import type { AccountStatus, IdentityConfigView, EntitlementItem, DetectedTool, ImportedProvider, GitAuthPlatformStatus, AuditReportSummary, AgentBackendDescriptor, HookConfig } from '@cherishron/sacode-client-core';
import {
  applyInterfacePreferences,
  loadDesktopPreferences,
  saveDesktopPreferences,
  syncSystemIntegrations,
  type DesktopPreferences,
  type SettingsSection,
} from '../logic/preferences.ts';
import { isTauri, setAutostart, setTrayEnabled, getSystemIntegrationStatus } from '../platform/tauri-bridge.ts';
import AboutView from './AboutView.vue';
import { useDesktopApp } from '../composables/useDesktopApp';
import {
  appendKvRow,
  dropKvRow,
  kvToRecord,
  recordToKv,
  type KvRow,
} from '../logic/kv-rows.ts';
import {
  buildLocalProviderPayload,
  validateLocalProviderForm,
  API_TYPE_OPTIONS,
  cloudFeatureDisableReason,
  emptyLocalProviderForm,
  inferLocalMode,
  LOCAL_PROVIDER_EMPTY_HINT,
  localModeBannerHint,
  localModeBannerText,
  type LocalProviderForm,
} from '../logic/local-mode.ts';
import {
  argsToText,
  backendPathText,
  formatQuotaLine,
  healthBadge,
  installHintFor,
  isBackendEditable,
  isBackendUnavailable,
  isQuotaExhausted,
  textToArgs,
} from '../logic/agent-backends.ts';

/**
 * 设置 — 对齐 MonkeyCode：覆盖工作台（优先级 设置 > 工作台），
 * 视图级 h-40 页头 + 左分类 + 右独立滚动内容 + 底栏保存。
 */
const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
}>();

const { app, workspace } = useDesktopApp();

const section = ref<SettingsSection>('general');
const draft = ref<DesktopPreferences>(loadDesktopPreferences(app));
const dirty = ref(false);
const feedback = ref('');

watch(
  () => props.open,
  (open) => {
    if (open) {
      draft.value = loadDesktopPreferences(app);
      dirty.value = false;
      feedback.value = '';
    }
  },
);

watch(
  draft,
  () => {
    dirty.value = true;
  },
  { deep: true },
);

const navItems: Array<{ id: SettingsSection; label: string }> = [
  { id: 'general', label: '通用' },
  { id: 'account', label: '账号' },
  { id: 'agent-backends', label: 'Agent 后端' },
  { id: 'execution', label: '模型与执行' },
  { id: 'appearance', label: '界面' },
  { id: 'project', label: '项目' },
  { id: 'git', label: 'Git 平台' },
  { id: 'security', label: '安全扫描' },
  { id: 'hooks', label: 'Hooks' },
  { id: 'import', label: '配置导入' },
  { id: 'services', label: '服务' },
  { id: 'skills', label: '技能' },
  { id: 'about', label: '关于' },
];

// ── MCP 管理（P1-1） ──────────────────────────────────────────
type McpRow = {
  name: string;
  type: string;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  enabled: boolean;
  source: string;
  testResult?: string;
};

const mcpServers = ref<McpRow[]>([]);
const mcpLoading = ref(false);
const mcpError = ref('');
const mcpFormOpen = ref(false);
/** 非空 = 编辑既有服务器（整对象替换）；空 = 新建 */
const mcpEditingName = ref('');
const mcpArgsText = ref('');
const mcpEnvRows = ref<KvRow[]>([{ key: '', value: '' }]);
const mcpHeaderRows = ref<KvRow[]>([{ key: '', value: '' }]);
const mcpDraft = ref({
  name: '',
  type: 'stdio' as 'stdio' | 'remote' | 'http' | 'sse',
  url: '',
  command: '',
  enabled: true,
});

function resetMcpDraft() {
  mcpEditingName.value = '';
  mcpDraft.value = { name: '', type: 'stdio', url: '', command: '', enabled: true };
  mcpArgsText.value = '';
  mcpEnvRows.value = [{ key: '', value: '' }];
  mcpHeaderRows.value = [{ key: '', value: '' }];
}

function openMcpCreate() {
  resetMcpDraft();
  mcpFormOpen.value = true;
}

/** 编辑：把行数据填进完整表单（transport/command/url/env/headers/enabled） */
function editMcp(row: McpRow) {
  mcpEditingName.value = row.name;
  mcpDraft.value = {
    name: row.name,
    type: (row.type as 'stdio' | 'remote' | 'http' | 'sse') || 'stdio',
    url: row.url ?? '',
    command: row.command ?? '',
    enabled: row.enabled,
  };
  mcpArgsText.value = (row.args ?? []).join(' ');
  mcpEnvRows.value = recordToKv(row.env);
  mcpHeaderRows.value = recordToKv(row.headers);
  mcpFormOpen.value = true;
  mcpError.value = '';
}

async function loadMcp() {
  if (!app.client) return;
  mcpLoading.value = true;
  mcpError.value = '';
  try {
    const data = await app.client.listMcpServers();
    mcpServers.value = (data.servers ?? []).map((s) => ({ ...s }));
    if (data.error) mcpError.value = data.error;
  } catch (e) {
    const msg = String(e);
    // 旧 daemon 无 /api/mcp → 显示空态而非裸报错
    if (msg.includes('404') || msg.includes('Not Found')) {
      mcpServers.value = [];
      mcpError.value = '';
    } else {
      mcpError.value = msg;
    }
  } finally {
    mcpLoading.value = false;
  }
}

watch(
  () => section.value,
  (s) => {
    if (s === 'services') {
      void loadMcp();
      void refreshSystemIntegrations();
    }
    if (s === 'skills') void loadSkills();
    if (s === 'execution') void loadProviders();
    if (s === 'git') void loadGit();
    if (s === 'security') void loadAudits();
    if (s === 'import') void loadImportTools();
    if (s === 'hooks') void loadHooks();
  },
);

// ── 系统托盘 / 开机自启（真开关，失败明说） ─────────────────
/** 非 Tauri（浏览器预览）→ 禁用开关并标明暂不支持 */
const systemIntegrationsSupported = ref(isTauri());
const systemStatusNote = ref('');
const systemBusy = ref(false);
const systemError = ref('');
/** 壳侧真实状态（对账用，防止假绿） */
const systemReal = ref<{ tray_enabled: boolean; autostart_enabled: boolean } | null>(null);

async function refreshSystemIntegrations() {
  systemIntegrationsSupported.value = isTauri();
  if (!isTauri()) {
    systemStatusNote.value = '暂不支持：需桌面壳（Tauri）才能管理系统托盘 / 开机自启';
    systemReal.value = null;
    return;
  }
  systemBusy.value = true;
  systemError.value = '';
  try {
    const status = await getSystemIntegrationStatus();
    if (!status) {
      systemIntegrationsSupported.value = false;
      systemStatusNote.value = '暂不支持：当前桌面壳未提供系统集成查询';
      systemReal.value = null;
      return;
    }
    systemReal.value = status;
    systemStatusNote.value = `系统状态 · 托盘${status.tray_enabled ? '已启用' : '未启用'} · 自启${status.autostart_enabled ? '已启用' : '未启用'}`;
  } catch (e) {
    systemIntegrationsSupported.value = false;
    systemError.value = String(e);
    systemStatusNote.value = '暂不支持：查询系统集成状态失败';
  } finally {
    systemBusy.value = false;
  }
}

/** 立即调用壳侧 API；成功/失败都写进 systemError / systemStatusNote */
async function applySystemIntegration(kind: 'tray' | 'autostart', enabled: boolean) {
  if (!isTauri()) return;
  systemBusy.value = true;
  systemError.value = '';
  try {
    if (kind === 'tray') {
      const ok = await setTrayEnabled(enabled);
      if (!ok && enabled) throw new Error('托盘创建失败');
    } else {
      const ok = await setAutostart(enabled);
      if (ok !== enabled) throw new Error(`开机自启未按预期变为 ${enabled ? '开启' : '关闭'}`);
    }
    await refreshSystemIntegrations();
  } catch (e) {
    systemError.value = String(e);
    // 回滚开关，避免 UI 显示已开但系统未开
    if (kind === 'tray') draft.value.trayEnabled = !enabled;
    else draft.value.autostart = !enabled;
  } finally {
    systemBusy.value = false;
  }
}

// ── Hooks（只读展示，不执行） ─────────────────────────────────
type HookRow = HookConfig;
const hooks = ref<HookRow[]>([]);
const hooksConfigPath = ref('');
const hooksLoading = ref(false);
const hooksError = ref('');
const hooksSupported = ref(true);

async function loadHooks() {
  if (!app.client) {
    hooksSupported.value = false;
    hooksError.value = '未连接 daemon，无法读取 Hooks 配置';
    return;
  }
  hooksLoading.value = true;
  hooksError.value = '';
  try {
    const data = await app.client.listHooks();
    hooks.value = data.hooks ?? [];
    hooksConfigPath.value = data.config_path || '';
    hooksSupported.value = true;
  } catch (e) {
    const msg = String(e);
    if (msg.includes('404') || msg.includes('Not Found')) {
      // 旧 daemon 无 /api/hooks → 明确标注暂不支持，不假装有数据
      hooksSupported.value = false;
      hooks.value = [];
      hooksError.value = '';
    } else {
      hooksSupported.value = true;
      hooksError.value = msg;
    }
  } finally {
    hooksLoading.value = false;
  }
}

// ── 技能管理（P1-2） ──────────────────────────────────────────
type SkillRow = {
  name: string;
  description: string;
  source: string;
  path?: string;
  version?: string;
  author?: string;
  /** 契约 §7.2：默认启用标记 */
  enabled?: boolean;
};

const skills = ref<SkillRow[]>([]);
const skillLoading = ref(false);
const skillError = ref('');
const skillFormOpen = ref(false);
const skillDraft = ref({
  name: '',
  description: '',
  prompt: '',
  source: 'project' as 'project' | 'user',
  enabled: true,
});
const skillImportBusy = ref(false);
const skillImportError = ref('');
const skillImportNotice = ref('');
const skillZipInput = ref<HTMLInputElement | null>(null);
const skillDirInput = ref<HTMLInputElement | null>(null);

async function loadSkills() {
  if (!app.client) return;
  skillLoading.value = true;
  skillError.value = '';
  try {
    const data = await app.client.listSkills();
    skills.value = (data.skills ?? []).map((s) => ({
      ...s,
      // daemon 未返回 enabled 时按 true 处理（契约默认启用）
      enabled: (s as { enabled?: boolean }).enabled ?? true,
    }));
    if (data.error) skillError.value = data.error;
  } catch (e) {
    const msg = String(e);
    if (msg.includes('404') || msg.includes('Not Found')) {
      skills.value = [];
      skillError.value = '';
    } else {
      skillError.value = msg;
    }
  } finally {
    skillLoading.value = false;
  }
}

function openSkillForm(row?: SkillRow) {
  skillFormOpen.value = true;
  if (row) {
    skillDraft.value = {
      name: row.name,
      description: row.description,
      prompt: '',
      source: (row.source === 'user' ? 'user' : 'project') as 'project' | 'user',
      enabled: row.enabled ?? true,
    };
  } else {
    skillDraft.value = { name: '', description: '', prompt: '', source: 'project', enabled: true };
  }
}

function editSkill(row: SkillRow) {
  openSkillForm(row);
}

async function saveSkill() {
  const name = skillDraft.value.name.trim();
  if (!name || !skillDraft.value.prompt.trim() || !app.client) return;
  try {
    await app.client.upsertSkill(name, {
      description: skillDraft.value.description,
      prompt: skillDraft.value.prompt,
      source: skillDraft.value.source,
      // 契约 §7.2 enabled；类型未含时随 body 扩展提交
      enabled: skillDraft.value.enabled,
    } as Parameters<typeof app.client.upsertSkill>[1]);
    skillFormOpen.value = false;
    await loadSkills();
  } catch (e) {
    skillError.value = String(e);
  }
}

/** 默认启用开关 — PUT 整对象保留 prompt 时仅改 enabled；无读 prompt 接口则本地标记。 */
async function toggleSkillEnabled(row: SkillRow, enabled: boolean) {
  const next = { ...row, enabled };
  skills.value = skills.value.map((s) =>
    s.name === row.name && s.source === row.source ? next : s,
  );
  if (!app.client) return;
  try {
    // TODO(Agent4): 技能 enabled 落盘端点就绪后改为真 PUT；当前仅本地生效
    await app.client.upsertSkill(row.name, {
      description: row.description,
      prompt: '',
      source: (row.source === 'user' ? 'user' : 'project') as 'project' | 'user',
      enabled,
    } as Parameters<typeof app.client.upsertSkill>[1]);
  } catch (e) {
    skillError.value = String(e);
  }
}

async function removeSkill(row: SkillRow) {
  if (!app.client) return;
  if (!window.confirm(`删除技能「${row.name}」？此操作无法撤销。`)) return;
  try {
    await app.client.deleteSkill(row.name, row.source as 'user' | 'project' | 'workspace');
    await loadSkills();
  } catch (e) {
    skillError.value = String(e);
  }
}

/**
 * ZIP / 目录导入（契约 §7.2 POST /api/skills/import）。
 * 端点就绪前：把选中的 zip / 目录文件清单反馈为提示，并打 TODO。
 * TODO(Agent4): daemon-client 补 importSkill 后改为 multipart 上传。
 */
async function importSkillsFrom(files: FileList | null, kind: 'zip' | 'dir') {
  if (!files || !files.length) return;
  skillImportBusy.value = true;
  skillImportError.value = '';
  skillImportNotice.value = '';
  try {
    const names = Array.from(files).map((f) => f.name).slice(0, 8);
    const client = app.client as {
      importSkills?: (payload: FormData) => Promise<{ status: string; names?: string[]; message?: string }>;
    };
    if (typeof client?.importSkills === 'function') {
      const form = new FormData();
      for (const file of Array.from(files)) form.append('file', file, file.name);
      form.append('kind', kind);
      const result = await client.importSkills(form);
      skillImportNotice.value = `已导入 ${result.names?.length ?? 0} 个技能${result.message ? `：${result.message}` : ''}`;
    } else {
      // TODO(Agent4): POST /api/skills/import 未就绪 — 仅登记文件名
      skillImportNotice.value =
        `已选择 ${files.length} 个${kind === 'zip' ? ' ZIP' : '目录'}文件（${names.join('、')}${files.length > 8 ? '…' : ''}）；导入端点就绪后将上传。`;
    }
    await loadSkills();
  } catch (e) {
    skillImportError.value = String(e);
  } finally {
    skillImportBusy.value = false;
    if (skillZipInput.value) skillZipInput.value.value = '';
    if (skillDirInput.value) skillDirInput.value.value = '';
  }
}

/**
 * 保存 MCP：契约 §7.1 — PUT 整对象替换（transport/command/url/env/headers/enabled）。
 * 当前 daemon-client 的 type 词表是 'remote' | 'stdio'，契约 transport 是 'stdio' | 'http' | 'sse'；
 * 提交时非 stdio 一律映射为 'remote'，精确 transport 待 Agent4 对齐后透传。
 * headers 为契约新增字段，upsertMcpServer 类型未含时以扩展字段随 body 提交。
 * TODO(Agent4): daemon-client upsertMcpServer 对齐 transport 词表 + headers 类型后去掉 as 断言。
 */
async function saveMcp() {
  const name = mcpDraft.value.name.trim();
  if (!name || !app.client) return;
  const isRemote = mcpDraft.value.type !== 'stdio';
  const env = kvToRecord(mcpEnvRows.value);
  const headers = kvToRecord(mcpHeaderRows.value);
  const body = {
    // 非 stdio 映射到当前客户端词表 'remote'
    type: (isRemote ? 'remote' : 'stdio') as 'remote' | 'stdio',
    url: isRemote ? mcpDraft.value.url.trim() : undefined,
    command: isRemote ? undefined : mcpDraft.value.command.trim(),
    args: isRemote
      ? undefined
      : mcpArgsText.value.split(/\s+/).filter(Boolean),
    env: Object.keys(env).length ? env : undefined,
    // 契约字段；当前 daemon-client 类型未含 headers，扩展提交
    headers: Object.keys(headers).length ? headers : undefined,
    enabled: mcpDraft.value.enabled,
    source: 'project' as const,
  };
  try {
    await app.client.upsertMcpServer(name, body as Parameters<typeof app.client.upsertMcpServer>[1]);
    mcpFormOpen.value = false;
    resetMcpDraft();
    await loadMcp();
  } catch (e) {
    mcpError.value = String(e);
  }
}

function cancelMcpEdit() {
  mcpFormOpen.value = false;
  resetMcpDraft();
}

async function toggleMcp(row: McpRow, enabled: boolean) {
  if (!app.client) return;
  try {
    await app.client.toggleMcpServer(row.name, enabled, row.source === 'user' ? 'user' : 'project');
    row.enabled = enabled;
  } catch (e) {
    mcpError.value = String(e);
  }
}

async function removeMcp(name: string) {
  if (!app.client) return;
  try {
    await app.client.deleteMcpServer(name);
    await loadMcp();
  } catch (e) {
    mcpError.value = String(e);
  }
}

async function testMcp(row: McpRow) {
  if (!app.client) return;
  try {
    const result = await app.client.testMcpServer(row.name);
    row.testResult = result.tools?.length
      ? `OK · ${result.tools.length} tools：${result.tools.slice(0, 4).map((t) => t.name).join('、')}`
      : result.message || '无工具';
  } catch (e) {
    row.testResult = String(e);
  }
}

const workspaceLabel = computed(() => {
  const path = workspace.value || app.workspace || '';
  if (!path) return 'SaCode Desktop';
  // 只显示文件夹名，不暴露完整路径
  const base = path.replace(/\\/g, '/').split('/').filter(Boolean).pop();
  return base || 'SaCode Desktop';
});

// ── 账号 / 权益 ─────────────────────────────────────────────
const account = ref<AccountStatus | null>(null);
const loginState = ref<string | null>(null);
const accountLoading = ref(false);
const accountError = ref('');
const accountBusy = ref(false);
const entitlements = ref<EntitlementItem[]>([]);
const entLoading = ref(false);
const entError = ref('');
const entNeedsAuth = ref(false);
const entBaseUrl = ref('');
/** C3 服务地址高级折叠（默认不展开，自用者零干扰） */
const advancedOpen = ref(false);

/**
 * C1 模式横幅：由现有 account 数据推断。
 * TODO(Agent4): /account/status 就绪后改读真实 mode / cloud_available。
 */
const localMode = computed(() =>
  inferLocalMode({
    account: account.value,
    accountError: accountError.value,
    cloudServiceError: entError.value,
    everLoggedIn: loginState.value === 'completed' || Boolean(account.value?.logged_in_at),
  }),
);
const modeBannerText = computed(() => localModeBannerText(localMode.value));
const modeBannerHint = computed(() => localModeBannerHint(localMode.value));
/** C4 云能力置灰原因；null = 可用 */
const cloudDisableReason = computed(() => cloudFeatureDisableReason(localMode.value));
const cloudFeaturesOff = computed(() => cloudDisableReason.value !== null);

async function refreshAccount() {
  if (!app.client) return;
  accountLoading.value = true;
  accountError.value = '';
  try {
    const res = await app.client.accountStatus();
    account.value = res.account;
    loginState.value = res.login_state ?? null;
  } catch (e) {
    accountError.value = String(e);
  } finally {
    accountLoading.value = false;
  }
}

async function refreshEntitlements() {
  if (!app.client) return;
  entLoading.value = true;
  entError.value = '';
  entNeedsAuth.value = false;
  try {
    const res = await app.client.accountEntitlements('sacode');
    entitlements.value = res.items;
    entBaseUrl.value = res.entitlement_base_url || '';
    entNeedsAuth.value = Boolean(res.needs_entitlement_auth);
  } catch (e) {
    entError.value = String(e);
  } finally {
    entLoading.value = false;
  }
}

async function onAccountLogin() {
  if (!app.client) return;
  accountBusy.value = true;
  accountError.value = '';
  try {
    await app.client.accountLogin();
    loginState.value = 'pending';
    // 轮询登录状态（与旧版 settings 节奏一致）
    for (let i = 0; i < 60 && props.open && section.value === 'account'; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const res = await app.client.accountStatus();
      account.value = res.account;
      loginState.value = res.login_state ?? null;
      if (res.login_state === 'completed' || res.login_state === 'failed') break;
    }
    if (!props.open || section.value !== 'account') return;
    if (!account.value?.logged_in) {
      accountError.value = '登录尚未完成，请稍后刷新账号状态。';
      return;
    }
    await refreshEntitlements();
    if (entNeedsAuth.value) {
      // 仅登录完成后尝试一次；失败仍可手动授权，不重复触发浏览器登录。
      await onEntitlementLogin();
    }
  } catch (e) {
    accountError.value = String(e);
  } finally {
    accountBusy.value = false;
  }
}

async function onEntitlementLogin() {
  if (!app.client) return;
  accountBusy.value = true;
  entError.value = '';
  try {
    await app.client.accountEntitlementLogin();
    for (let i = 0; i < 60 && props.open && section.value === 'account'; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      await refreshEntitlements();
      if (!entNeedsAuth.value && !entError.value) break;
      if (loginState.value === 'failed') break;
    }
  } catch (e) {
    entError.value = String(e);
  } finally {
    accountBusy.value = false;
  }
}

async function onAccountSyncModels() {
  if (!app.client) return;
  accountBusy.value = true;
  accountError.value = '';
  try {
    await app.client.accountSyncModels();
    await refreshAccount();
  } catch (e) {
    accountError.value = String(e);
  } finally {
    accountBusy.value = false;
  }
}

async function onAccountLogout() {
  if (!app.client) return;
  accountBusy.value = true;
  accountError.value = '';
  try {
    await app.client.accountLogout();
    account.value = null;
    loginState.value = null;
    entitlements.value = [];
    entNeedsAuth.value = false;
  } catch (e) {
    accountError.value = String(e);
  } finally {
    accountBusy.value = false;
  }
}

// ── 服务地址配置（GET/PUT /account/config）────────────────────
const identityConfig = ref<IdentityConfigView | null>(null);
const identityDraft = ref({
  idp_base_url: '',
  gateway_base_url: '',
  entitlement_base_url: '',
  provider_name: '',
});
const identityLoading = ref(false);
const identitySaving = ref(false);
const identityError = ref('');
const identityFeedback = ref('');

function identityDraftFrom(cfg: IdentityConfigView) {
  identityDraft.value = {
    idp_base_url: cfg.effective.idp_base_url,
    gateway_base_url: cfg.effective.gateway_base_url,
    entitlement_base_url: cfg.effective.entitlement_base_url,
    provider_name: cfg.effective.provider_name,
  };
}

async function refreshAccountConfig() {
  if (!app.client) return;
  identityLoading.value = true;
  identityError.value = '';
  try {
    const cfg = await app.client.accountConfigGet();
    identityConfig.value = cfg;
    identityDraftFrom(cfg);
  } catch (e) {
    identityError.value = String(e);
  } finally {
    identityLoading.value = false;
  }
}

/** 从 daemon 错误中提取后端原始 error 文案（形如 "... failed (400 Bad Request): <原文>"）。 */
function serverErrorMessage(e: unknown): string {
  const msg = String(e);
  const idx = msg.indexOf('): ');
  return idx >= 0 ? msg.slice(idx + 3) : msg;
}

async function onSaveAccountConfig() {
  if (!app.client || !identityConfig.value) return;
  const eff = identityConfig.value.effective;
  const input: {
    idp_base_url?: string;
    gateway_base_url?: string;
    entitlement_base_url?: string;
    provider_name?: string;
  } = {};
  if (identityDraft.value.idp_base_url !== eff.idp_base_url) input.idp_base_url = identityDraft.value.idp_base_url;
  if (identityDraft.value.gateway_base_url !== eff.gateway_base_url) input.gateway_base_url = identityDraft.value.gateway_base_url;
  if (identityDraft.value.entitlement_base_url !== eff.entitlement_base_url) input.entitlement_base_url = identityDraft.value.entitlement_base_url;
  if (identityDraft.value.provider_name !== eff.provider_name) input.provider_name = identityDraft.value.provider_name;
  if (!Object.keys(input).length) {
    identityFeedback.value = '没有需要保存的更改';
    return;
  }
  identitySaving.value = true;
  identityError.value = '';
  identityFeedback.value = '';
  try {
    const updated = await app.client.accountConfigUpdate(input);
    identityConfig.value = updated;
    identityDraftFrom(updated);
    identityFeedback.value = account.value?.logged_in
      ? '配置已保存；部分设置需重新登录后生效'
      : '配置已保存';
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 409) {
      identityError.value = '登录进行中，请稍候';
    } else if (status === 400) {
      identityError.value = serverErrorMessage(e);
    } else {
      identityError.value = String(e);
    }
  } finally {
    identitySaving.value = false;
  }
}

watch(section, (s) => {
  if (s === 'account') {
    void refreshAccount().then(() => {
      // 云增强可选：未登录不拉权益，避免「未登录」被渲染成报错（P2/P3）
      if (account.value?.logged_in) void refreshEntitlements();
    });
    void refreshLicense();
    void refreshAccountConfig();
  } else if (s === 'agent-backends') {
    void loadAgentBackends();
  }
});

const licenseStatus = ref<{
  present: boolean;
  status: string;
  kid?: string;
  product?: string;
  capabilities?: string[];
  expires_at?: string;
  error?: string;
} | null>(null);
const licenseImportOpen = ref(false);
const licenseText = ref('');
const licenseBusy = ref(false);
const licenseError = ref('');
const activationDeviceName = ref('');
const activationResult = ref('');

async function refreshLicense() {
  if (!app.client) return;
  try {
    licenseStatus.value = await app.client.accountLicenseStatus();
  } catch (e) {
    licenseError.value = String(e);
  }
}

async function onImportLicense() {
  if (!app.client || !licenseText.value.trim()) return;
  licenseBusy.value = true;
  licenseError.value = '';
  try {
    await app.client.accountLicenseImport(licenseText.value);
    licenseText.value = '';
    licenseImportOpen.value = false;
    await refreshLicense();
  } catch (e) {
    licenseError.value = String(e);
  } finally {
    licenseBusy.value = false;
  }
}

async function onExportActivation() {
  if (!app.client) return;
  licenseBusy.value = true;
  licenseError.value = '';
  try {
    const res = await app.client.accountActivationRequest({
      device_name: activationDeviceName.value || undefined,
      product: 'sacode',
    });
    activationResult.value = JSON.stringify(res.request, null, 2);
  } catch (e) {
    licenseError.value = String(e);
  } finally {
    licenseBusy.value = false;
  }
}

// ── 后端管理页 ──────────────────────────────────────────────────
const providers = ref<{ name: string; base_url: string; models: string[]; has_credential: boolean }[]>([]);
/** C5 添加本地模型向导（名称 / 接口协议 / base_url / api_key / 远端模型勾选 / 是否思考 / reasoning_effort） */
const providerForm = ref<LocalProviderForm>(emptyLocalProviderForm());
const providerFormReady = computed(() => buildLocalProviderPayload(providerForm.value) !== null);
const providerError = ref('');
const providerFeedback = ref('');
const providerBusy = ref(false);
/** 远端模型列表（拉取后供勾选） */
const providerModels = ref<{ id: string; owned_by?: string }[]>([]);
const providerModelsBusy = ref(false);
const providerModelsError = ref('');
/** 从远端拉取模型列表（OpenAI /models 标准端点；Anthropic 走 daemon 适配）。 */
async function fetchProviderModels() {
  if (!app.client) {
    providerModelsError.value = 'daemon 未连接，无法拉取模型列表';
    return;
  }
  const base_url = providerForm.value.base_url.trim();
  if (!base_url) {
    providerModelsError.value = '请先填写接口地址';
    return;
  }
  providerModelsBusy.value = true;
  providerModelsError.value = '';
  try {
    const res = await app.client.fetchProviderModels({
      api_type: providerForm.value.api_type,
      base_url,
      api_key: providerForm.value.api_key,
    });
    providerModels.value = res.models;
    // 丢弃已不存在于新列表中的勾选
    const available = new Set(res.models.map((m) => m.id));
    providerForm.value.selected_models = providerForm.value.selected_models.filter((id) => available.has(id));
    if (res.models.length === 0) {
      providerModelsError.value = '远端未返回任何模型';
    }
  } catch (e) {
    providerModels.value = [];
    providerModelsError.value = String(e);
  } finally {
    providerModelsBusy.value = false;
  }
}
function toggleProviderModel(id: string, checked: boolean) {
  const set = new Set(providerForm.value.selected_models);
  if (checked) set.add(id);
  else set.delete(id);
  providerForm.value.selected_models = [...set];
}
async function loadProviders() {
  if (!app.client) return;
  providerBusy.value = true;
  providerError.value = '';
  try { providers.value = (await app.client.listLocalProviders()).providers; }
  catch (e) { providerError.value = String(e); }
  finally { providerBusy.value = false; }
}
async function addProvider() {
  if (!app.client) {
    providerError.value = 'daemon 未连接，无法保存';
    return;
  }
  const invalid = validateLocalProviderForm(providerForm.value);
  if (invalid) {
    providerError.value = invalid;
    return;
  }
  const payload = buildLocalProviderPayload(providerForm.value);
  if (!payload) {
    providerError.value = '请完整填写名称、接口地址，并勾选至少一个模型';
    return;
  }
  providerBusy.value = true;
  providerError.value = '';
  providerFeedback.value = '';
  try {
    await app.client.createLocalProvider(payload);
    providerForm.value = emptyLocalProviderForm();
    providerModels.value = [];
    providerModelsError.value = '';
    providerFeedback.value = '本地模型已添加，任务可直接使用';
    await loadProviders();
  } catch (e) {
    providerError.value = String(e);
  } finally {
    providerBusy.value = false;
  }
}
async function removeProvider(name: string) {
  if (!app.client || !window.confirm(`删除本地模型提供商「${name}」？`)) return;
  providerBusy.value = true;
  try { await app.client.deleteLocalProvider(name); await loadProviders(); }
  catch (e) { providerError.value = String(e); }
  finally { providerBusy.value = false; }
}

// ── Agent 后端（O2/O3/O5） ─────────────────────────────────────
const agentBackends = ref<AgentBackendDescriptor[]>([]);
const agentBackendsLoading = ref(false);
const agentBackendsError = ref('');
const agentBackendsFeedback = ref('');
/** 每个后端的探测 / 保存 / 折叠状态 */
const backendProbeBusy = ref<Record<string, boolean>>({});
const backendSaveBusy = ref<Record<string, boolean>>({});
const backendAdvancedOpen = ref<Record<string, boolean>>({});
/** 高级编辑草稿：路径 + args 文本 */
const backendDrafts = ref<Record<string, { executable: string; args_text: string }>>({});

function ensureBackendDraft(row: AgentBackendDescriptor) {
  if (!backendDrafts.value[row.id]) {
    backendDrafts.value[row.id] = {
      executable: row.executable ?? '',
      args_text: argsToText(row.args),
    };
  }
  return backendDrafts.value[row.id];
}

async function loadAgentBackends() {
  if (!app.client) return;
  agentBackendsLoading.value = true;
  agentBackendsError.value = '';
  try {
    const res = await app.client.listAgentBackends();
    agentBackends.value = res.backends;
    for (const row of agentBackends.value) {
      backendDrafts.value[row.id] = {
        executable: row.executable ?? '',
        args_text: argsToText(row.args),
      };
    }
  } catch (e) {
    agentBackendsError.value = String(e);
  } finally {
    agentBackendsLoading.value = false;
  }
}

async function toggleAgentBackend(row: AgentBackendDescriptor, enabled: boolean) {
  if (!app.client || !isBackendEditable(row)) return;
  backendSaveBusy.value = { ...backendSaveBusy.value, [row.id]: true };
  agentBackendsError.value = '';
  agentBackendsFeedback.value = '';
  try {
    const updated = await app.client.updateAgentBackend(row.id, { enabled });
    const idx = agentBackends.value.findIndex((b) => b.id === row.id);
    if (idx >= 0) agentBackends.value.splice(idx, 1, updated);
    agentBackendsFeedback.value = `${updated.display_name} 已${enabled ? '启用' : '禁用'}`;
  } catch (e) {
    agentBackendsError.value = String(e);
  } finally {
    backendSaveBusy.value = { ...backendSaveBusy.value, [row.id]: false };
  }
}

async function probeAgentBackend(row: AgentBackendDescriptor) {
  if (!app.client) return;
  backendProbeBusy.value = { ...backendProbeBusy.value, [row.id]: true };
  agentBackendsError.value = '';
  agentBackendsFeedback.value = '';
  try {
    const updated = await app.client.probeAgentBackend(row.id);
    const idx = agentBackends.value.findIndex((b) => b.id === row.id);
    if (idx >= 0) agentBackends.value.splice(idx, 1, updated);
    backendDrafts.value[row.id] = {
      executable: updated.executable ?? '',
      args_text: argsToText(updated.args),
    };
    // 失败也不刷红错：展示 install_hint / diagnostic 一行即可
    agentBackendsFeedback.value = isBackendUnavailable(updated)
      ? `${updated.display_name} 探测未通过`
      : `${updated.display_name} 探测通过`;
  } catch (e) {
    agentBackendsError.value = String(e);
  } finally {
    backendProbeBusy.value = { ...backendProbeBusy.value, [row.id]: false };
  }
}

async function saveAgentBackendPath(row: AgentBackendDescriptor) {
  if (!app.client || !isBackendEditable(row)) return;
  const draft = backendDrafts.value[row.id];
  if (!draft) return;
  const executable = draft.executable.trim();
  const args = textToArgs(draft.args_text);
  backendSaveBusy.value = { ...backendSaveBusy.value, [row.id]: true };
  agentBackendsError.value = '';
  agentBackendsFeedback.value = '';
  try {
    const updated = await app.client.updateAgentBackend(row.id, {
      ...(executable ? { executable } : {}),
      args,
    });
    const idx = agentBackends.value.findIndex((b) => b.id === row.id);
    if (idx >= 0) agentBackends.value.splice(idx, 1, updated);
    agentBackendsFeedback.value = `${updated.display_name} 路径已保存`;
  } catch (e) {
    agentBackendsError.value = String(e);
  } finally {
    backendSaveBusy.value = { ...backendSaveBusy.value, [row.id]: false };
  }
}

function toggleBackendAdvanced(row: AgentBackendDescriptor) {
  ensureBackendDraft(row);
  backendAdvancedOpen.value = {
    ...backendAdvancedOpen.value,
    [row.id]: !backendAdvancedOpen.value[row.id],
  };
}

// ── 网关模型连接（POST /account/connections）───────────────────
const gwConnDraft = ref({ name: '', base_url: '', upstream_api_key: '' });
const gwConnModels = ref<{ client_model: string; upstream_model: string }[]>([
  { client_model: '', upstream_model: '' },
]);
const gwConnBusy = ref(false);
const gwConnError = ref('');
const gwConnFeedback = ref('');

function addGwModelRow() {
  gwConnModels.value.push({ client_model: '', upstream_model: '' });
}

function removeGwModelRow(index: number) {
  if (gwConnModels.value.length <= 1) return;
  gwConnModels.value.splice(index, 1);
}

async function registerGatewayModel() {
  if (!app.client) return;
  const name = gwConnDraft.value.name.trim();
  const baseUrl = gwConnDraft.value.base_url.trim();
  const apiKey = gwConnDraft.value.upstream_api_key;
  // 仅提交完整映射行，忽略空行
  const models = gwConnModels.value
    .map((m) => ({ client_model: m.client_model.trim(), upstream_model: m.upstream_model.trim() }))
    .filter((m) => m.client_model && m.upstream_model);
  if (!name || !baseUrl || !apiKey || !models.length) return;
  gwConnBusy.value = true;
  gwConnError.value = '';
  gwConnFeedback.value = '';
  try {
    await app.client.registerModelConnection({
      name,
      base_url: baseUrl,
      upstream_api_key: apiKey,
      models,
    });
    gwConnFeedback.value = '模型连接已注册';
    gwConnDraft.value = { name: '', base_url: '', upstream_api_key: '' };
    gwConnModels.value = [{ client_model: '', upstream_model: '' }];
  } catch (e) {
    gwConnError.value = String(e);
  } finally {
    gwConnBusy.value = false;
  }
}

const gitPlatforms = ref<GitAuthPlatformStatus[]>([]);
const gitBusy = ref(false);
const gitError = ref('');
const githubClientId = ref('');
const githubFlow = ref<{ device_code: string; user_code: string; verification_uri: string; interval: number } | null>(null);
async function loadGit() {
  if (!app.client) return;
  gitBusy.value = true;
  gitError.value = '';
  try { gitPlatforms.value = (await app.client.gitAuthStatus()).platforms; }
  catch (e) { gitError.value = String(e); }
  finally { gitBusy.value = false; }
}
async function startGithub() {
  if (!app.client) return;
  gitBusy.value = true;
  gitError.value = '';
  try {
    githubFlow.value = await app.client.startGithubDeviceFlow(githubClientId.value.trim() || undefined);
    window.open(githubFlow.value.verification_uri, '_blank', 'noopener,noreferrer');
  } catch (e) { gitError.value = String(e); }
  finally { gitBusy.value = false; }
}
async function finishGithub() {
  if (!app.client || !githubFlow.value) return;
  gitBusy.value = true;
  gitError.value = '';
  try {
    const result = await app.client.pollGithubDeviceFlow(githubFlow.value.device_code, 10, githubClientId.value.trim() || undefined);
    if (result.status !== 'ok') {
      gitError.value = `授权尚未完成：${result.status}`;
      return;
    }
    githubFlow.value = null;
    await loadGit();
  } catch (e) { gitError.value = String(e); }
  finally { gitBusy.value = false; }
}
async function disconnectGit(host: string) {
  if (!app.client || (host !== 'github' && host !== 'gitee') || !window.confirm(`断开 ${host} 授权？`)) return;
  gitBusy.value = true;
  try { await app.client.gitAuthLogout(host); await loadGit(); }
  catch (e) { gitError.value = String(e); }
  finally { gitBusy.value = false; }
}

const auditReports = ref<AuditReportSummary[]>([]);
const auditBusy = ref(false);
const auditError = ref('');
const auditFeedback = ref('');
async function loadAudits() {
  if (!app.client) return;
  auditBusy.value = true;
  auditError.value = '';
  try { auditReports.value = (await app.client.listAudits()).reports; }
  catch (e) { auditError.value = String(e); }
  finally { auditBusy.value = false; }
}
async function scanAudit() {
  if (!app.client) return;
  auditBusy.value = true;
  auditError.value = '';
  auditFeedback.value = '';
  try {
    const result = await app.client.runAuditScan({ scanTier: 'static', useAi: false });
    auditFeedback.value = `扫描完成 · ${result.findings.length} 条发现`;
  } catch (e) { auditError.value = String(e); }
  finally { auditBusy.value = false; }
  if (!auditError.value) await loadAudits();
}

const importTools = ref<DetectedTool[]>([]);
const importedProviders = ref<ImportedProvider[]>([]);
const importToolId = ref('');
const importSelected = ref<string[]>([]);
const importBusy = ref(false);
const importError = ref('');
const importFeedback = ref('');
async function loadImportTools() {
  if (!app.client) return;
  importBusy.value = true;
  importError.value = '';
  try { importTools.value = await app.client.listImportTools(); }
  catch (e) { importError.value = String(e); }
  finally { importBusy.value = false; }
}
async function selectImportTool(id: string) {
  if (!app.client) return;
  importToolId.value = id;
  importedProviders.value = [];
  importSelected.value = [];
  importError.value = '';
  if (!id) return;
  importBusy.value = true;
  try { importedProviders.value = await app.client.listImportProviders(id); }
  catch (e) { importError.value = String(e); }
  finally { importBusy.value = false; }
}
async function applySelectedImport() {
  if (!app.client || !importToolId.value || !importSelected.value.length) return;
  importBusy.value = true;
  importError.value = '';
  importFeedback.value = '';
  try {
    const result = await app.client.applyImport(importToolId.value, importSelected.value);
    importFeedback.value = `已导入：${result.providers.join('、') || '无'}`;
    importSelected.value = [];
  } catch (e) { importError.value = String(e); }
  finally { importBusy.value = false; }
}

const exportBusy = ref(false);
const exportError = ref('');
async function exportEnterpriseAudit() {
  if (!app.client) return;
  exportBusy.value = true;
  exportError.value = '';
  try {
    const result = await app.client.exportEnterpriseAudit();
    const url = URL.createObjectURL(new Blob([result.content], { type: 'application/x-ndjson;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `sacode-audit-${new Date().toISOString().slice(0, 10)}.jsonl`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) { exportError.value = String(e); }
  finally { exportBusy.value = false; }
}

function onSave() {
  const prefs = { ...draft.value, nickname: draft.value.nickname.trim() || 'SaCode 用户' };
  saveDesktopPreferences(prefs);
  dirty.value = false;
  // 托盘 / 自启落到桌面壳；失败明说，不假装保存成功
  void syncSystemIntegrations(prefs).then((result) => {
    if (!isTauri()) {
      feedback.value = '偏好已保存（托盘 / 自启仅记录，当前环境暂不支持）';
      return;
    }
    if (result.errors.length) {
      feedback.value = `偏好已保存，但系统集成失败：${result.errors.join('；')}`;
      systemError.value = result.errors.join('；');
    } else {
      feedback.value = '设置已保存';
    }
    void refreshSystemIntegrations();
  });
}

function onClose() {
  emit('update:open', false);
}
</script>

<template>
  <div v-if="open" class="settings-overlay" @click.self="onClose">
    <section class="settings-window" role="dialog" aria-modal="true">
      <!-- 契约：视图级页头 chrome-row -->
      <header class="settings-head">
        <span class="settings-title">偏好设置</span>
        <span class="muted">{{ workspaceLabel }}</span>
        <span style="flex: 1" />
        <button class="ghost-btn" type="button" title="关闭" @click="onClose">
          <CloseIcon size="13" />
        </button>
      </header>

      <div class="settings-body">
        <nav class="settings-nav scroll-y">
          <button
            v-for="item in navItems"
            :key="item.id"
            type="button"
            class="settings-nav-item"
            :class="{ active: section === item.id }"
            @click="section = item.id"
          >
            {{ item.label }}
          </button>
        </nav>

        <main class="settings-content scroll-y">
           <!-- 模型与执行 -->
           <template v-if="section === 'execution'">
             <h3 class="settings-section-title">本地模型提供商</h3>
             <p class="muted">网关模型由账号同步；此处管理本地提供商。本地模式下配好即可跑任务，无需登录。</p>
             <p v-if="providerError" class="composer-error" role="alert">{{ providerError }}</p>
             <p v-if="providerFeedback" class="muted" role="status">{{ providerFeedback }}</p>
             <p v-if="providerBusy" class="muted">处理中…</p>
             <!-- C5 空状态引导 -->
             <p v-else-if="!providers.length" class="provider-empty-hint">{{ LOCAL_PROVIDER_EMPTY_HINT }}</p>
             <div v-for="provider in providers" :key="provider.name" class="mcp-row">
               <div class="mcp-row-main"><strong>{{ provider.name }}</strong><span class="muted">{{ provider.models.join('、') || '无模型' }}</span>
                 <t-button size="small" variant="outline" theme="danger" :disabled="providerBusy" @click="void removeProvider(provider.name)">删除</t-button></div>
               <div class="muted mono">{{ provider.base_url }} · {{ provider.has_credential ? '已配置凭据' : '无凭据' }}</div>
             </div>
             <!-- C5 添加本地模型向导 -->
             <h3 class="settings-section-title" style="margin-top: 24px">添加本地模型</h3>
             <p class="muted" style="margin-bottom: 8px">
               一步配通：名称 → 接口地址 → API Key → models（每行一个）→ 思考能力。密钥仅提交给 daemon，界面不回显。
             </p>
             <div class="mcp-form provider-wizard">
               <label class="settings-field"><span>1 · 接口协议</span>
                  <t-radio-group v-model="providerForm.api_type" variant="default-filled" size="small">
                    <t-radio-button v-for="opt in API_TYPE_OPTIONS" :key="opt.value" :value="opt.value">
                      {{ opt.label }}
                    </t-radio-button>
                  </t-radio-group>
                  <span class="muted" style="font-size: 11px">{{ API_TYPE_OPTIONS.find(o => o.value === providerForm.api_type)?.hint }}</span>
                </label>
               <label class="settings-field"><span>2 · 名称</span><t-input v-model="providerForm.name" placeholder="例如 ollama-local（字母数字-_）" /></label>
               <label class="settings-field"><span>3 · 接口地址</span><t-input v-model="providerForm.base_url" placeholder="https://api.example.com/v1 或 http://127.0.0.1:11434/v1" /></label>
               <label class="settings-field"><span>4 · API Key</span><t-input v-model="providerForm.api_key" type="password" autocomplete="off" placeholder="本地服务可留空；网关服务填 sk-…" /></label>
               <label class="settings-field">
                 <span>5 · 模型列表（从远端拉取后勾选）</span>
                 <div class="provider-models-picker">
                   <t-button
                     size="small"
                     variant="outline"
                     :loading="providerModelsBusy"
                     :disabled="providerModelsBusy || !providerForm.base_url.trim()"
                     @click="void fetchProviderModels()"
                   >
                     {{ providerModels.length ? '重新拉取模型列表' : '拉取模型列表' }}
                   </t-button>
                   <span v-if="providerModels.length" class="muted" style="font-size: 11px">
                     共 {{ providerModels.length }} 个，已勾选 {{ providerForm.selected_models.length }} 个
                   </span>
                 </div>
                 <div v-if="providerModelsError" class="provider-models-error" role="alert">
                   {{ providerModelsError }}
                 </div>
                 <div v-if="providerModels.length" class="provider-models-list scroll-y">
                   <label
                     v-for="m in providerModels"
                     :key="m.id"
                     class="provider-model-row"
                     :class="{ selected: providerForm.selected_models.includes(m.id) }"
                   >
                     <input
                       type="checkbox"
                       :checked="providerForm.selected_models.includes(m.id)"
                       @change="toggleProviderModel(m.id, ($event.target as HTMLInputElement).checked)"
                     />
                     <span class="provider-model-id" :title="m.id">{{ m.id }}</span>
                     <span v-if="m.owned_by" class="muted provider-model-owner">{{ m.owned_by }}</span>
                   </label>
                 </div>
                 <span v-else-if="!providerModelsBusy" class="muted" style="font-size: 11px">
                   填好接口地址（与密钥）后点击「拉取模型列表」，勾选需要加入 SaCode 的模型
                 </span>
               </label>
               <label class="settings-field settings-field--row">
                 <span>5 · 是否思考</span>
                 <t-switch v-model="providerForm.thinking" size="small" />
                 <span class="muted">{{ providerForm.thinking ? '支持推理/思考输出' : '纯对话输出' }}</span>
               </label>
               <label class="settings-field">
                 <span>6 · reasoning_effort 默认档</span>
                 <t-radio-group v-model="providerForm.reasoning_effort" variant="default-filled" size="small">
                   <t-radio-button value="low">low</t-radio-button>
                   <t-radio-button value="medium">medium</t-radio-button>
                   <t-radio-button value="high">high</t-radio-button>
                 </t-radio-group>
               </label>
               <t-button
                 size="small"
                 theme="primary"
                 :disabled="providerBusy || !providerFormReady"
                 @click="void addProvider()"
               >
                 添加到本地模型
               </t-button>
             </div>
             <h3 class="settings-section-title" style="margin-top: 24px">网关模型连接</h3>
             <p class="muted" style="margin-bottom: 8px">
               为具名网关连接注册 client_model → upstream_model 映射；密钥仅提交给 daemon，界面不回显。
             </p>
             <div v-if="gwConnError" class="composer-error" role="alert">{{ gwConnError }}</div>
             <div v-if="gwConnFeedback" class="muted" role="status">{{ gwConnFeedback }}</div>
             <div class="mcp-form">
               <label class="settings-field"><span>名称</span><t-input v-model="gwConnDraft.name" placeholder="连接名称" /></label>
               <label class="settings-field"><span>接口地址</span><t-input v-model="gwConnDraft.base_url" placeholder="https://…" /></label>
               <label class="settings-field"><span>上游 API Key</span><t-input v-model="gwConnDraft.upstream_api_key" type="password" autocomplete="off" /></label>
               <div v-for="(m, i) in gwConnModels" :key="i" class="mcp-row">
                 <t-input v-model="m.client_model" placeholder="client_model" size="small" />
                 <t-input v-model="m.upstream_model" placeholder="upstream_model" size="small" />
                 <t-button size="small" variant="outline" theme="danger" :disabled="gwConnModels.length <= 1" @click="removeGwModelRow(i)">移除</t-button>
               </div>
               <div class="mcp-row-actions">
                 <t-button size="small" variant="outline" @click="addGwModelRow()">添加映射</t-button>
                 <t-button size="small" theme="primary" :disabled="gwConnBusy || !gwConnDraft.name.trim() || !gwConnDraft.base_url.trim() || !gwConnDraft.upstream_api_key.trim()" @click="void registerGatewayModel()">注册模型连接</t-button>
               </div>
             </div>
           </template>

           <!-- Git 平台 -->
           <template v-else-if="section === 'git'">
             <h3 class="settings-section-title">Git 平台</h3>
             <p v-if="gitError" class="composer-error" role="alert">{{ gitError }}</p>
             <p v-if="gitBusy" class="muted">处理中…</p>
             <p v-else-if="!gitPlatforms.length" class="muted">暂无平台状态</p>
             <div v-for="platform in gitPlatforms" :key="platform.host" class="mcp-row">
               <div class="mcp-row-main"><strong>{{ platform.host }}</strong><span class="muted">{{ platform.token_present ? (platform.login || '已授权') : platform.configured ? '未授权' : '未配置' }}</span>
                 <t-button v-if="platform.token_present" size="small" variant="outline" :disabled="gitBusy" @click="void disconnectGit(platform.host)">断开</t-button></div>
             </div>
             <div class="mcp-form">
               <label class="settings-field"><span>GitHub OAuth Client ID（未在 daemon 配置时填写）</span><t-input v-model="githubClientId" /></label>
               <t-button size="small" :disabled="gitBusy" @click="void startGithub()">GitHub 设备授权</t-button>
               <div v-if="githubFlow" class="mcp-row">
                 <p>在浏览器打开 <a :href="githubFlow.verification_uri" target="_blank" rel="noopener noreferrer">GitHub 验证页</a>，输入代码 <strong class="mono">{{ githubFlow.user_code }}</strong></p>
                 <t-button size="small" :disabled="gitBusy" @click="void finishGithub()">已授权，检查状态</t-button>
               </div>
             </div>
             <p class="muted">Gitee 需要预先配置 OAuth 回调地址；未配置前无法在桌面端完成回调。</p>
           </template>

           <!-- 安全扫描 -->
           <template v-else-if="section === 'security'">
             <h3 class="settings-section-title">安全扫描</h3>
             <p class="muted">静态扫描当前工作区；不会修改文件。</p>
             <t-button size="small" :disabled="auditBusy" @click="void scanAudit()">{{ auditBusy ? '扫描中…' : '运行静态扫描' }}</t-button>
             <p v-if="auditError" class="composer-error" role="alert">{{ auditError }}</p>
             <p v-if="auditFeedback" class="muted" role="status">{{ auditFeedback }}</p>
             <p v-if="!auditBusy && !auditReports.length" class="muted">暂无扫描报告</p>
             <div v-for="report in auditReports" :key="report.audit_id" class="mcp-row">
               <div class="mcp-row-main"><strong>{{ report.created_at }}</strong><span class="muted">{{ report.finding_count }} 条 · 高 {{ report.high }} / 中 {{ report.medium }} / 低 {{ report.low }}</span></div>
             </div>
           </template>

           <!-- 配置导入 -->
           <template v-else-if="section === 'import'">
             <h3 class="settings-section-title">配置导入</h3>
             <p class="muted">选择已检测的外部工具，预览后确认导入提供商；不会显示或自动上传已有密钥。</p>
             <p v-if="importError" class="composer-error" role="alert">{{ importError }}</p>
             <p v-if="importFeedback" class="muted" role="status">{{ importFeedback }}</p>
             <p v-if="importBusy" class="muted">处理中…</p>
             <p v-else-if="!importTools.length" class="muted">未检测到可导入的工具</p>
             <div class="mcp-form">
               <label class="settings-field"><span>来源工具</span><select class="settings-select" :value="importToolId" @change="void selectImportTool(($event.target as HTMLSelectElement).value)"><option value="">请选择工具</option><option v-for="tool in importTools" :key="tool.id" :value="tool.id">{{ tool.label }}（{{ tool.provider_count }}）</option></select></label>
               <p v-if="importToolId && !importBusy && !importedProviders.length" class="muted">该工具暂无可导入的提供商</p>
               <label v-for="provider in importedProviders" :key="provider.name" class="mcp-row"><input v-model="importSelected" type="checkbox" :value="provider.name" /><strong>{{ provider.name }}</strong><span class="muted">{{ provider.model || provider.base_url }} · {{ provider.has_api_key ? '包含凭据' : '无凭据' }}</span></label>
               <t-button size="small" :disabled="importBusy || !importSelected.length" @click="void applySelectedImport()">确认导入选中项</t-button>
             </div>
           </template>

           <!-- 通用 -->
          <template v-else-if="section === 'general'">
            <h3 class="settings-section-title">通用</h3>
            <label class="settings-field">
              <span>昵称</span>
              <t-input v-model="draft.nickname" />
            </label>
            <label class="settings-field">
              <span>默认模式</span>
              <t-radio-group v-model="draft.defaultMode" variant="default-filled" size="small">
                <t-radio-button value="plan">Plan</t-radio-button>
                <t-radio-button value="build">Build</t-radio-button>
                <t-radio-button value="yolo">Yolo</t-radio-button>
              </t-radio-group>
            </label>
            <label class="settings-field">
              <span>默认技能</span>
              <t-input v-model="draft.defaultSkill" placeholder="留空表示不使用" />
            </label>
            <t-switch v-model="draft.restoreLastProject" />
            <span class="muted">启动时恢复上次项目</span>
          </template>

          <!-- 界面 -->
          <template v-else-if="section === 'appearance'">
            <h3 class="settings-section-title">界面</h3>
            <label class="settings-field">
              <span>主题</span>
              <t-radio-group v-model="draft.theme" variant="default-filled" size="small" @change="() => { applyInterfacePreferences(draft) }">
                <t-radio-button value="system">跟随系统</t-radio-button>
                <t-radio-button value="dark">深色</t-radio-button>
                <t-radio-button value="light">浅色</t-radio-button>
              </t-radio-group>
            </label>
            <label class="settings-field">
              <span>密度</span>
              <t-radio-group v-model="draft.density" variant="default-filled" size="small" @change="() => { applyInterfacePreferences(draft) }">
                <t-radio-button value="comfortable">舒适</t-radio-button>
                <t-radio-button value="compact">紧凑</t-radio-button>
              </t-radio-group>
              <span class="muted" style="font-size: 11px">立即生效：紧凑收紧列表间距与行高（layout-contract 令牌），并随「保存设置」持久化</span>
            </label>
            <label class="settings-field">
              <span>语言</span>
              <t-radio-group v-model="draft.locale" variant="default-filled" size="small" @change="() => { applyInterfacePreferences(draft) }">
                <t-radio-button value="zh-CN">简体中文</t-radio-button>
                <t-radio-button value="en-US">English</t-radio-button>
              </t-radio-group>
              <!-- 无完整 i18n：切换仅记录偏好 + 写 html[lang]，不假装翻译界面 -->
              <span class="muted" style="font-size: 11px">
                仅记录偏好（当前界面文案仍为中文）：完整英文界面需接入 i18n，暂不支持即时翻译；选择会写入 html[lang] 并保存
              </span>
            </label>
          </template>

          <!-- 项目 -->
          <template v-else-if="section === 'project'">
            <h3 class="settings-section-title">项目</h3>
            <label class="settings-field">
              <span>默认项目目录</span>
              <t-input v-model="draft.defaultProjectDir" placeholder="新建任务预填路径" />
            </label>
          </template>

          <!-- 服务 / 运行环境 + MCP（P1-1） -->
          <template v-else-if="section === 'services'">
            <h3 class="settings-section-title">运行环境</h3>
            <label class="settings-field">
              <span>默认终端</span>
              <t-radio-group v-model="draft.defaultTerminal" variant="default-filled" size="small">
                <t-radio-button value="powershell">PowerShell</t-radio-button>
                <t-radio-button value="pwsh">pwsh</t-radio-button>
                <t-radio-button value="cmd">cmd</t-radio-button>
                <t-radio-button value="bash">bash</t-radio-button>
                <t-radio-button value="system-default">系统默认</t-radio-button>
              </t-radio-group>
            </label>
            <label class="settings-field">
              <span>系统托盘</span>
              <t-switch
                v-model="draft.trayEnabled"
                :disabled="!systemIntegrationsSupported || systemBusy"
                @change="(v: boolean) => void applySystemIntegration('tray', v)"
              />
              <span class="muted" style="font-size: 11px">
                {{ systemIntegrationsSupported
                  ? '关闭窗口时隐藏到托盘；立即调用桌面壳，失败会回滚'
                  : '暂不支持：需桌面壳（Tauri）' }}
              </span>
            </label>
            <label class="settings-field">
              <span>开机自启</span>
              <t-switch
                v-model="draft.autostart"
                :disabled="!systemIntegrationsSupported || systemBusy"
                @change="(v: boolean) => void applySystemIntegration('autostart', v)"
              />
              <span class="muted" style="font-size: 11px">
                {{ systemIntegrationsSupported
                  ? '注册系统启动项（Windows Run key / 启动文件夹）；失败会回滚'
                  : '暂不支持：需桌面壳（Tauri）' }}
              </span>
            </label>
            <p v-if="systemStatusNote" class="muted" role="status" style="font-size: 11px">{{ systemStatusNote }}</p>
            <p v-if="systemError" class="composer-error" role="alert">{{ systemError }}</p>
            <h3 class="settings-section-title" style="margin-top: 24px">MCP 服务器</h3>
            <div class="mcp-list">
              <div v-if="mcpLoading" class="muted">加载中…</div>
              <div v-else-if="mcpError" class="composer-error">{{ mcpError }}</div>
              <div v-else-if="!mcpServers.length" class="muted">暂无 MCP 服务器</div>
              <div v-for="s in mcpServers" :key="s.name" class="mcp-row">
                <div class="mcp-row-main">
                  <strong>{{ s.name }}</strong>
                  <span class="muted">{{ s.type }} · {{ s.source }}</span>
                  <t-switch
                    :model-value="s.enabled"
                    size="small"
                    @change="(v: boolean) => void toggleMcp(s, v)"
                  />
                </div>
                <div class="muted mono" style="font-size: 11px">
                  {{ s.url || [s.command, ...(s.args || [])].join(' ') }}
                </div>
                <div v-if="s.env && Object.keys(s.env).length" class="muted mono" style="font-size: 11px">
                  env: {{ Object.keys(s.env).join('、') }}
                </div>
                <div v-if="s.headers && Object.keys(s.headers).length" class="muted mono" style="font-size: 11px">
                  headers: {{ Object.keys(s.headers).join('、') }}
                </div>
                <div class="mcp-row-actions">
                  <t-button size="small" variant="outline" @click="editMcp(s)">编辑</t-button>
                  <t-button size="small" variant="outline" @click="void testMcp(s)">探活</t-button>
                  <t-button size="small" variant="outline" theme="danger" @click="void removeMcp(s.name)">
                    删除
                  </t-button>
                </div>
                <div v-if="s.testResult" class="muted" style="font-size: 11px">
                  {{ s.testResult }}
                </div>
              </div>
            </div>
            <t-button size="small" style="margin-top: 12px" @click="mcpFormOpen ? cancelMcpEdit() : openMcpCreate()">
              {{ mcpFormOpen ? '收起' : '添加服务器' }}
            </t-button>
            <div v-if="mcpFormOpen" class="mcp-form">
              <h4 class="settings-section-title" style="margin: 0 0 8px">
                {{ mcpEditingName ? `编辑「${mcpEditingName}」` : '添加服务器' }}
              </h4>
              <label class="settings-field"><span>名称</span>
                <t-input v-model="mcpDraft.name" placeholder="名称" size="small" :disabled="!!mcpEditingName" />
              </label>
              <label class="settings-field"><span>传输方式</span>
                <t-radio-group v-model="mcpDraft.type" variant="default-filled" size="small">
                  <t-radio-button value="stdio">stdio</t-radio-button>
                  <t-radio-button value="remote">remote</t-radio-button>
                  <t-radio-button value="http">http</t-radio-button>
                  <t-radio-button value="sse">sse</t-radio-button>
                </t-radio-group>
              </label>
              <label v-if="mcpDraft.type !== 'stdio'" class="settings-field"><span>URL</span>
                <t-input v-model="mcpDraft.url" placeholder="https://…" size="small" />
              </label>
              <template v-else>
                <label class="settings-field"><span>命令</span>
                  <t-input v-model="mcpDraft.command" placeholder="command" size="small" />
                </label>
                <label class="settings-field"><span>参数</span>
                  <t-input v-model="mcpArgsText" placeholder="args（空格分隔）" size="small" />
                </label>
              </template>

              <!-- env 键值对 -->
              <div class="kv-block">
                <span class="kv-label">环境变量（env）</span>
                <div v-for="(row, i) in mcpEnvRows" :key="`env-${i}`" class="kv-row">
                  <t-input v-model="row.key" placeholder="KEY" size="small" />
                  <t-input v-model="row.value" placeholder="value" size="small" />
                  <t-button size="small" variant="outline" theme="danger" @click="mcpEnvRows = dropKvRow(mcpEnvRows, i)">移除</t-button>
                </div>
                <t-button size="small" variant="outline" @click="mcpEnvRows = appendKvRow(mcpEnvRows)">添加 env</t-button>
              </div>

              <!-- headers 键值对 -->
              <div class="kv-block">
                <span class="kv-label">请求头（headers）</span>
                <div v-for="(row, i) in mcpHeaderRows" :key="`hdr-${i}`" class="kv-row">
                  <t-input v-model="row.key" placeholder="Header-Name" size="small" />
                  <t-input v-model="row.value" placeholder="value" size="small" />
                  <t-button size="small" variant="outline" theme="danger" @click="mcpHeaderRows = dropKvRow(mcpHeaderRows, i)">移除</t-button>
                </div>
                <t-button size="small" variant="outline" @click="mcpHeaderRows = appendKvRow(mcpHeaderRows)">添加 header</t-button>
              </div>

              <label class="settings-field" style="flex-direction: row; align-items: center; gap: 8px">
                <t-switch v-model="mcpDraft.enabled" size="small" />
                <span>启用</span>
              </label>
              <div class="mcp-row-actions">
                <t-button size="small" theme="primary" @click="void saveMcp()">
                  {{ mcpEditingName ? '保存修改' : '保存' }}
                </t-button>
                <t-button size="small" variant="outline" @click="cancelMcpEdit()">取消</t-button>
              </div>
            </div>
          </template>

          <!-- 账号 / 权益 -->
          <template v-else-if="section === 'account'">
            <!-- C1 模式横幅：local / online / cloud_degraded -->
            <div class="mode-banner" :class="`mode-banner--${localMode}`" role="status">
              <span class="mode-banner-dot" aria-hidden="true" />
              <strong class="mode-banner-text">{{ modeBannerText }}</strong>
              <span class="muted mode-banner-hint">{{ modeBannerHint }}</span>
            </div>

            <h3 class="settings-section-title">账号（sa-idp · 网关）</h3>
            <div v-if="accountLoading" class="muted">加载中…</div>
            <div v-else class="mcp-list">
              <div class="mcp-row">
                <div class="mcp-row-main">
                  <!-- P1 默认 Local：未登录文案是「正在使用本地模型」，不是「未登录/未完成」 -->
                  <strong>{{ account?.logged_in ? (account.subject || '已登录') : '正在使用本地模型' }}</strong>
                  <span class="muted">
                    {{ account?.logged_in
                      ? `${account.provider_name || 'sa-ai'} · ${account.models_count || 0} 个网关模型`
                      : '本地模式已就绪；登录是可选增强，用于同步网关模型' }}
                  </span>
                </div>
                <div class="muted mono" style="font-size: 11px">
                  {{ account?.gateway_base_url || '—' }}
                </div>
              </div>
            </div>
            <!-- 云侧问题不刷红错：一行原因即可（P7 云件套可缺席） -->
            <p v-if="accountError" class="muted" role="status">{{ accountError }}</p>
            <div class="mcp-row-actions" style="margin-top: 12px">
              <!-- P2 登录永非门槛 / P3 云能力显式可选：登录是 outline 可选入口，非主 CTA -->
              <t-button
                v-if="!account?.logged_in"
                size="small"
                variant="outline"
                :disabled="accountBusy"
                @click="void onAccountLogin()"
              >
                登录以启用云增强
              </t-button>
              <template v-else>
                <!-- C4 同步模型：未登录/不可用时置灰 + 一行原因 -->
                <t-button
                  size="small"
                  variant="outline"
                  :disabled="accountBusy || cloudFeaturesOff"
                  :title="cloudDisableReason || ''"
                  @click="void onAccountSyncModels()"
                >
                  同步模型
                </t-button>
                <t-button size="small" variant="outline" theme="danger" :disabled="accountBusy" @click="void onAccountLogout()">
                  退出登录
                </t-button>
              </template>
            </div>
            <p v-if="account?.logged_in && cloudDisableReason" class="muted cloud-reason" role="status">
              {{ cloudDisableReason }} · 同步模型暂不可用
            </p>

            <!-- C3 服务地址折叠进「高级」（默认不展开） -->
            <div class="advanced-block">
              <button
                type="button"
                class="advanced-toggle"
                :aria-expanded="advancedOpen"
                @click="advancedOpen = !advancedOpen"
              >
                <span>高级 · 服务地址</span>
                <span class="muted">{{ advancedOpen ? '收起' : '展开' }}</span>
              </button>
              <div v-if="advancedOpen" class="advanced-body">
                <p class="muted" style="margin-bottom: 8px">
                  配置 sa-idp / 网关 / 权益服务地址；仅展示地址，收不到也不回填任何 token 或密钥。
                </p>
                <div v-if="identityError" class="composer-error" role="alert">{{ identityError }}</div>
                <div v-if="identityFeedback" class="muted" role="status">{{ identityFeedback }}</div>
                <div v-if="identityLoading" class="muted">加载中…</div>
                <div v-else class="mcp-form">
                  <label class="settings-field">
                    <span>IdP 基础地址</span>
                    <t-input v-model="identityDraft.idp_base_url" placeholder="https://…" />
                  </label>
                  <p v-if="identityConfig?.env_overrides.idp_base_url" class="muted" style="font-size: 11px">
                    环境变量覆盖中，修改需清除 SACODE_* 环境变量
                  </p>
                  <label class="settings-field">
                    <span>网关基础地址</span>
                    <t-input v-model="identityDraft.gateway_base_url" placeholder="https://…" />
                  </label>
                  <p v-if="identityConfig?.env_overrides.gateway_base_url" class="muted" style="font-size: 11px">
                    环境变量覆盖中，修改需清除 SACODE_* 环境变量
                  </p>
                  <label class="settings-field">
                    <span>权益基础地址</span>
                    <t-input v-model="identityDraft.entitlement_base_url" placeholder="https://…" />
                  </label>
                  <p v-if="identityConfig?.env_overrides.entitlement_base_url" class="muted" style="font-size: 11px">
                    环境变量覆盖中，修改需清除 SACODE_* 环境变量
                  </p>
                  <label class="settings-field">
                    <span>提供商名称</span>
                    <t-input v-model="identityDraft.provider_name" placeholder="sa-ai" />
                  </label>
                  <div class="mcp-row-actions">
                    <t-button size="small" variant="outline" :disabled="identityLoading || identitySaving" @click="void refreshAccountConfig()">
                      刷新配置
                    </t-button>
                    <t-button size="small" theme="primary" :disabled="identitySaving || !identityConfig" @click="void onSaveAccountConfig()">
                      保存配置
                    </t-button>
                  </div>
                </div>
              </div>
            </div>

            <h3 class="settings-section-title" style="margin-top: 24px">
              权益（sa-entitlement）
            </h3>
            <!-- C4 权益列表：未登录 / 不可用时置灰 + 一行原因，不弹错 -->
            <div v-if="cloudFeaturesOff" class="cloud-disabled-block" aria-disabled="true">
              <p class="muted cloud-reason">{{ cloudDisableReason }}</p>
              <p v-if="entError" class="muted" style="font-size: 11px">{{ entError }}</p>
              <div class="mcp-row cloud-disabled-row">
                <div class="mcp-row-main">
                  <strong class="muted">权益列表</strong>
                  <span class="muted">登录后可查看（可选云增强）</span>
                </div>
              </div>
            </div>
            <template v-else>
              <p class="muted" style="margin-bottom: 8px">
                产品 sacode · 能力按 capability 门禁，未知能力不会扩权。
                <span v-if="entBaseUrl" class="mono" style="font-size: 11px">{{ entBaseUrl }}</span>
              </p>
              <div v-if="entLoading" class="muted">加载中…</div>
              <div v-else-if="entError" class="muted" role="status">{{ entError }}</div>
              <div v-else-if="entNeedsAuth" class="mcp-list">
                <div class="mcp-row">
                  <div class="mcp-row-main">
                    <strong>需要权益授权</strong>
                    <span class="muted">请用 sacode-ent 客户端完成一次授权（IdP 会话存在时通常无感）</span>
                  </div>
                </div>
                <t-button size="small" theme="primary" :disabled="accountBusy" @click="void onEntitlementLogin()">
                  授权权益
                </t-button>
              </div>
              <div v-else-if="!entitlements.length" class="muted">当前没有有效权益记录</div>
              <div v-else class="mcp-list">
                <div v-for="e in entitlements" :key="e.id" class="mcp-row">
                  <div class="mcp-row-main">
                    <strong>{{ e.product || e.id }}</strong>
                    <span class="muted">{{ e.status || 'active' }}</span>
                  </div>
                  <div class="muted" style="font-size: 11px">
                    {{ e.valid_from || '—' }} → {{ e.valid_until || '—' }}
                  </div>
                  <div class="muted mono" style="font-size: 11px">
                    {{ (e.capabilities || []).join('、') || '（无能力）' }}
                  </div>
                </div>
              </div>
            </template>

            <h3 class="settings-section-title" style="margin-top: 24px">License（离线）</h3>
            <div v-if="licenseError" class="composer-error">{{ licenseError }}</div>
            <div v-if="licenseStatus" class="mcp-list">
              <div class="mcp-row">
                <div class="mcp-row-main">
                  <strong>
                    {{ licenseStatus.present ? licenseStatus.status : '未导入' }}
                  </strong>
                  <span class="muted">
                    {{ licenseStatus.kid ? `kid ${licenseStatus.kid}` : '导入 .saai-license.json 后可在离线环境门禁能力' }}
                  </span>
                </div>
                <div class="muted mono" style="font-size: 11px">
                  {{ licenseStatus.product || '' }}
                  {{ licenseStatus.expires_at ? `· 有效至 ${licenseStatus.expires_at}` : '' }}
                </div>
                <div class="muted mono" style="font-size: 11px">
                  {{ (licenseStatus.capabilities || []).join('、') }}
                </div>
              </div>
            </div>
            <div class="mcp-row-actions" style="margin-top: 8px">
              <t-button size="small" variant="outline" @click="licenseImportOpen = !licenseImportOpen">
                {{ licenseImportOpen ? '收起' : '导入 License' }}
              </t-button>
            </div>
            <div v-if="licenseImportOpen" class="mcp-form">
              <t-textarea
                v-model="licenseText"
                :autosize="{ minRows: 6, maxRows: 16 }"
                placeholder="粘贴 saai-license/v1 JSON"
              />
              <t-button size="small" theme="primary" :disabled="licenseBusy" @click="void onImportLicense()">
                导入
              </t-button>
            </div>

            <h3 class="settings-section-title" style="margin-top: 24px">设备激活请求</h3>
            <p class="muted" style="margin-bottom: 8px">
              企业内网/离线：导出激活请求交给管理员关联 entitlement 签发设备绑定 License。
            </p>
            <div class="mcp-form">
              <t-input v-model="activationDeviceName" placeholder="设备名称（可选）" size="small" />
              <t-button size="small" :disabled="licenseBusy" @click="void onExportActivation()">
                生成激活请求
              </t-button>
            </div>
            <pre
              v-if="activationResult"
              class="muted mono"
              style="font-size: 11px; white-space: pre-wrap; max-height: 220px; overflow: auto"
            >{{ activationResult }}</pre>
             <h3 class="settings-section-title" style="margin-top: 24px">企业审计导出</h3>
             <!-- C4 审计导出：云增强置灰 + 一行原因，不弹错 -->
             <p class="muted">需要 sacode_audit_export 权益或有效离线 License；最多导出 5000 行当前项目审计日志。</p>
             <p v-if="cloudDisableReason" class="muted cloud-reason" role="status">{{ cloudDisableReason }} · 审计导出暂不可用</p>
             <p v-if="exportError" class="muted" role="alert">{{ exportError }}</p>
             <t-button
               size="small"
               variant="outline"
               :disabled="exportBusy || cloudFeaturesOff"
               :title="cloudDisableReason || ''"
               @click="void exportEnterpriseAudit()"
             >{{ exportBusy ? '导出中…' : '导出审计日志' }}</t-button>
           </template>

           <!-- Agent 后端（O2/O3/O5）— Local Mode 可改，无需登录 -->
           <template v-else-if="section === 'agent-backends'">
             <h3 class="settings-section-title">Agent 后端</h3>
             <p class="muted">
               管理本地 Agent 后端（native / ACP）。本地模式下即可配置与探测，无需登录；云增强不影响此处。
             </p>
             <p v-if="agentBackendsError" class="composer-error" role="alert">{{ agentBackendsError }}</p>
             <p v-if="agentBackendsFeedback" class="muted" role="status">{{ agentBackendsFeedback }}</p>
             <div v-if="agentBackendsLoading" class="muted">加载中…</div>
             <div v-else-if="!agentBackends.length" class="muted">暂无后端</div>
             <div v-else class="mcp-list">
               <div
                 v-for="row in agentBackends"
                 :key="row.id"
                 class="mcp-row agent-backend-row"
                 :class="{ 'agent-backend-row--unavailable': isBackendUnavailable(row) }"
               >
                 <div class="mcp-row-main">
                   <strong>{{ row.display_name }}</strong>
                   <span class="agent-health-badge" :class="`agent-health-badge--${healthBadge(row.health).tone}`">
                     {{ healthBadge(row.health).label }}
                   </span>
                   <!-- O3 启用开关：native 不可改 -->
                   <t-switch
                     :model-value="row.enabled"
                     size="small"
                     :disabled="!isBackendEditable(row) || backendSaveBusy[row.id]"
                     @change="(v: boolean) => void toggleAgentBackend(row, v)"
                   />
                   <span class="muted" style="font-size: 11px">
                     {{ isBackendEditable(row) ? (row.enabled ? '已启用' : '已禁用') : '内置 · 始终启用' }}
                   </span>
                   <span style="flex: 1" />
                   <t-button
                     size="small"
                     variant="outline"
                     :disabled="backendProbeBusy[row.id]"
                     @click="void probeAgentBackend(row)"
                   >
                     {{ backendProbeBusy[row.id] ? '探测中…' : '探测' }}
                   </t-button>
                 </div>
                 <!-- 路径行 -->
                 <div class="muted mono" style="font-size: 11px">{{ backendPathText(row) }}</div>
                 <!-- O5 额度：一行小字；exhausted → warning -->
                 <div
                   v-if="formatQuotaLine(row.quota)"
                   class="agent-quota-line"
                   :class="{ 'agent-quota-line--exhausted': isQuotaExhausted(row.quota) }"
                 >
                   {{ formatQuotaLine(row.quota) }}
                 </div>
                 <!-- O2 未安装/不可用：置灰 + 一行安装指引，不刷红怒 -->
                 <div v-if="isBackendUnavailable(row)" class="agent-install-hint" role="status">
                   {{ installHintFor(row) }}
                   <span v-if="row.diagnostic" class="muted" style="font-size: 11px"> · {{ row.diagnostic }}</span>
                 </div>
                 <!-- 路径/参数编辑（可折叠高级） -->
                 <div v-if="isBackendEditable(row)" class="advanced-block agent-backend-advanced">
                   <button
                     type="button"
                     class="advanced-toggle"
                     :aria-expanded="Boolean(backendAdvancedOpen[row.id])"
                     @click="toggleBackendAdvanced(row)"
                   >
                     <span>高级 · 路径与参数</span>
                     <span class="muted">{{ backendAdvancedOpen[row.id] ? '收起' : '展开' }}</span>
                   </button>
                   <div v-if="backendAdvancedOpen[row.id]" class="advanced-body">
                     <label class="settings-field">
                       <span>可执行文件路径</span>
                       <t-input
                         v-model="ensureBackendDraft(row).executable"
                         placeholder="例如 C:\...\opencode.exe 或 opencode"
                         size="small"
                       />
                     </label>
                     <label class="settings-field">
                       <span>参数（每行一个）</span>
                       <t-textarea
                         v-model="ensureBackendDraft(row).args_text"
                         :autosize="{ minRows: 2, maxRows: 6 }"
                         placeholder="acp&#10;--verbose"
                       />
                     </label>
                     <div class="mcp-row-actions">
                       <t-button
                         size="small"
                         theme="primary"
                         :disabled="backendSaveBusy[row.id]"
                         @click="void saveAgentBackendPath(row)"
                       >
                         {{ backendSaveBusy[row.id] ? '保存中…' : '保存路径' }}
                       </t-button>
                     </div>
                   </div>
                 </div>
               </div>
             </div>
           </template>

           <!-- 关于 -->
          <template v-else-if="section === 'about'">
            <AboutView :mode="localMode" :workspace-path="String(workspace || app.workspace || '')" />
          </template>

          <!-- 技能管理（P1-2） -->
          <template v-else-if="section === 'skills'">
            <h3 class="settings-section-title">技能</h3>
            <p class="muted" style="margin-bottom: 12px">用户 / 项目目录技能；同名项目覆盖用户。</p>

            <!-- ZIP / 目录导入（契约 §7.2） -->
            <div class="mcp-row-actions" style="margin-bottom: 12px">
              <t-button size="small" variant="outline" :disabled="skillImportBusy" @click="skillZipInput?.click()">
                导入 ZIP
              </t-button>
              <t-button size="small" variant="outline" :disabled="skillImportBusy" @click="skillDirInput?.click()">
                导入目录
              </t-button>
              <input
                ref="skillZipInput"
                type="file"
                accept=".zip"
                multiple
                style="display: none"
                @change="void importSkillsFrom(($event.target as HTMLInputElement).files, 'zip')"
              />
              <input
                ref="skillDirInput"
                type="file"
                webkitdirectory
                style="display: none"
                @change="void importSkillsFrom(($event.target as HTMLInputElement).files, 'dir')"
              />
            </div>
            <p v-if="skillImportBusy" class="muted">导入中…</p>
            <p v-if="skillImportError" class="composer-error">{{ skillImportError }}</p>
            <p v-if="skillImportNotice" class="muted" role="status">{{ skillImportNotice }}</p>

            <div class="mcp-list">
              <div v-if="skillLoading" class="muted">加载中…</div>
              <div v-else-if="skillError" class="composer-error">{{ skillError }}</div>
              <div v-else-if="!skills.length" class="muted">暂无技能</div>
              <div v-for="s in skills" :key="`${s.source}:${s.name}`" class="mcp-row">
                <div class="mcp-row-main">
                  <strong>{{ s.name }}</strong>
                  <span class="muted">{{ s.source }}</span>
                  <!-- 默认启用开关（契约 §7.2 enabled） -->
                  <t-switch
                    :model-value="s.enabled ?? true"
                    size="small"
                    @change="(v: boolean) => void toggleSkillEnabled(s, v)"
                  />
                  <span class="muted" style="font-size: 11px">{{ s.enabled ?? true ? '默认启用' : '默认关闭' }}</span>
                  <span style="flex: 1" />
                  <t-button size="small" variant="outline" @click="editSkill(s)">编辑</t-button>
                  <t-button size="small" variant="outline" theme="danger" @click="void removeSkill(s)">
                    删除
                  </t-button>
                </div>
                <div class="muted" style="font-size: 11px">{{ s.description || '（无描述）' }}</div>
              </div>
            </div>
            <t-button size="small" style="margin-top: 12px" @click="skillFormOpen ? (skillFormOpen = false) : openSkillForm()">
              {{ skillFormOpen ? '收起' : '新建技能' }}
            </t-button>
            <div v-if="skillFormOpen" class="mcp-form">
              <t-input v-model="skillDraft.name" placeholder="名称" size="small" />
              <t-input v-model="skillDraft.description" placeholder="描述" size="small" />
              <t-radio-group v-model="skillDraft.source" variant="default-filled" size="small">
                <t-radio-button value="project">项目</t-radio-button>
                <t-radio-button value="user">用户</t-radio-button>
              </t-radio-group>
              <label class="settings-field" style="flex-direction: row; align-items: center; gap: 8px">
                <t-switch v-model="skillDraft.enabled" size="small" />
                <span>默认启用</span>
              </label>
              <t-textarea
                v-model="skillDraft.prompt"
                :autosize="{ minRows: 4, maxRows: 12 }"
                placeholder="技能提示词（支持 {{args}} {{cwd}} {{skill_name}}）"
              />
              <t-button size="small" theme="primary" @click="void saveSkill()">保存技能</t-button>
            </div>
          </template>

          <template v-else-if="section === 'hooks'">
            <h3 class="settings-section-title">Hooks</h3>
            <p class="muted">只读展示用户级 Hooks 配置（磁盘内容镜像），桌面端不执行钩子；执行与生命周期归 CLI（<span class="mono">/hooks</span> 或 <span class="mono">sacode hooks</span>）。</p>
            <div v-if="hooksLoading" class="muted">加载中…</div>
            <template v-else-if="!hooksSupported">
              <!-- 旧 daemon 无 /api/hooks：明确暂不支持，不摆假列表 -->
              <p class="muted" role="status">暂不支持：当前 daemon 未提供 <span class="mono">GET /api/hooks</span>，请升级 daemon 或直接编辑配置文件。</p>
              <p class="muted mono" style="font-size: 11px">配置路径（约定）：~/.sacode/settings.json 的 hooks 数组</p>
              <p class="muted" style="font-size: 11px">TODO：daemon 升级后此页将自动展示配置路径与只读列表。</p>
            </template>
            <template v-else>
              <p v-if="hooksError" class="composer-error" role="alert">{{ hooksError }}</p>
              <div v-if="hooksConfigPath" class="mcp-row" style="margin-bottom: 8px">
                <div class="mcp-row-main">
                  <strong>配置文件</strong>
                  <span class="muted">仅反映磁盘配置，不代表 CLI 已加载或执行</span>
                </div>
                <div class="muted mono" style="font-size: 11px">{{ hooksConfigPath }}</div>
              </div>
              <div class="mcp-list">
                <div v-if="!hooks.length" class="muted">尚未配置用户级 Hooks</div>
                <div v-for="h in hooks" :key="`${h.event}:${h.name}`" class="mcp-row">
                  <div class="mcp-row-main">
                    <strong>{{ h.name }}</strong>
                    <span class="muted">{{ h.event }}</span>
                    <span class="muted" style="font-size: 11px">{{ h.enabled ? '启用' : '停用' }}</span>
                  </div>
                  <div class="muted mono" style="font-size: 11px">{{ h.command }}</div>
                </div>
              </div>
              <p class="muted" style="font-size: 11px; margin-top: 8px">
                触发说明：由 CLI 在对应生命周期事件（如 pre_task / post_task）加载并执行；桌面设置页不做启停写入，避免与 CLI 配置双写冲突。
              </p>
            </template>
          </template>
          <template v-else>
            <h3 class="settings-section-title">{{ navItems.find((n) => n.id === section)?.label }}</h3>
          </template>
        </main>
      </div>

      <footer class="settings-foot">
        <span class="settings-save-status" :class="{ dirty }">
          {{ feedback || (dirty ? '有未保存的更改' : '设置已保存') }}
        </span>
        <span style="flex: 1" />
        <t-button variant="outline" size="small" @click="onClose">取消</t-button>
        <t-button theme="primary" size="small" :disabled="!dirty" @click="onSave">
          保存设置
        </t-button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
/* MCP env / headers 键值对编辑 */
.kv-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.kv-label {
  color: var(--text-weak);
  font-size: 12px;
}
.kv-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.kv-row :deep(.t-input) {
  flex: 1;
  min-width: 0;
}

/* C1 模式横幅 — 度量取 layout-contract / theme 既有令牌 */
.mode-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: var(--list-row-min);
  margin-bottom: 12px;
  padding: 6px 10px;
  border: 1px solid var(--border-weak);
  border-radius: 6px;
  background: var(--bg-surface);
  font: var(--text-12-medium);
  color: var(--text-strong);
}
.mode-banner-dot {
  width: var(--list-icon);
  height: var(--list-icon);
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--text-weak);
}
.mode-banner--local {
  border-left: 3px solid var(--accent);
}
.mode-banner--local .mode-banner-dot {
  background: var(--accent);
}
.mode-banner--online {
  border-left: 3px solid var(--success);
}
.mode-banner--online .mode-banner-dot {
  background: var(--success);
}
.mode-banner--cloud_degraded {
  border-left: 3px solid var(--warning);
}
.mode-banner--cloud_degraded .mode-banner-dot {
  background: var(--warning);
}
.mode-banner-text {
  font: var(--text-12-medium);
}
.mode-banner-hint {
  font: var(--text-12-regular);
}

/* C3 服务地址高级折叠 */
.advanced-block {
  margin-top: 24px;
  border: 1px solid var(--border-weak);
  border-radius: 6px;
}
.advanced-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  min-height: var(--list-row-min);
  padding: 6px 10px;
  border: 0;
  background: transparent;
  color: var(--text-strong);
  font: var(--text-12-medium);
  cursor: pointer;
  text-align: left;
}
.advanced-toggle:hover {
  background: var(--bg-raised);
}
.advanced-body {
  padding: 8px 10px 12px;
  border-top: var(--divider) solid var(--border-weak);
}

/* C4 云能力置灰 */
.cloud-disabled-block {
  opacity: 0.72;
}
.cloud-disabled-row {
  pointer-events: none;
}
.cloud-reason {
  margin: 4px 0 8px;
  font: var(--text-12-regular);
  color: var(--text-weak);
}

/* C5 本地模型向导 / 空状态 */
.provider-empty-hint {
  margin: 8px 0;
  padding: 8px 10px;
  border-left: 3px solid var(--accent);
  background: var(--accent-soft);
  color: var(--text-base);
  font: var(--text-12-regular);
  border-radius: 0 6px 6px 0;
}
.provider-wizard {
  margin-top: 4px;
}

/* 远端模型列表拉取 + 多选 */
.provider-models-picker {
  display: flex;
  align-items: center;
  gap: 10px;
}
.provider-models-list {
  max-height: 220px;
  min-height: 80px;
  margin-top: 8px;
  border: 1px solid var(--border-weak);
  border-radius: var(--radius-sm, 6px);
  padding: 4px;
}
.provider-model-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}
.provider-model-row:hover {
  background: var(--bg-raised);
}
.provider-model-row.selected {
  background: var(--accent-soft, rgba(54, 108, 255, 0.1));
}
.provider-model-row input[type='checkbox'] {
  flex-shrink: 0;
  cursor: pointer;
}
.provider-model-id {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.provider-model-owner {
  flex-shrink: 0;
  font-size: 11px;
  opacity: 0.7;
}
.provider-models-error {
  margin-top: 6px;
  color: var(--danger);
  font-size: 12px;
}
.settings-field--row {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

/* Agent 后端（O2/O3/O5） */
.agent-health-badge {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: var(--radius-full, 999px);
  font: var(--text-12-medium);
  font-size: 11px;
  line-height: 16px;
}
.agent-health-badge--success {
  background: var(--success-soft, var(--accent-soft));
  color: var(--success, var(--accent));
}
.agent-health-badge--warning {
  background: var(--warning-soft);
  color: var(--warning);
}
.agent-health-badge--danger {
  background: var(--danger-soft);
  color: var(--danger);
}
.agent-health-badge--muted {
  background: var(--bg-raised);
  color: var(--text-weak);
}
.agent-quota-line {
  font: var(--text-12-regular);
  color: var(--text-weak);
}
.agent-quota-line--exhausted {
  color: var(--warning);
}
.agent-install-hint {
  margin-top: 2px;
  padding: 6px 8px;
  border-left: 3px solid var(--warning);
  background: var(--warning-soft);
  color: var(--text-base);
  font: var(--text-12-regular);
  border-radius: 0 6px 6px 0;
}
.agent-backend-row--unavailable {
  opacity: 0.72;
}
.agent-backend-advanced {
  margin-top: 8px;
}
</style>
