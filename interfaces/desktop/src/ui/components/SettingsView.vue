<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { CloseIcon } from 'tdesign-icons-vue-next';
import type { AccountStatus, EntitlementItem } from '@cherishron/sacode-client-core';
import {
  applyInterfacePreferences,
  loadDesktopPreferences,
  saveDesktopPreferences,
  type DesktopPreferences,
  type SettingsSection,
} from '../../app/settings.ts';
import { useDesktopApp } from '../composables/useDesktopApp';

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
  enabled: boolean;
  source: string;
  testResult?: string;
};

const mcpServers = ref<McpRow[]>([]);
const mcpLoading = ref(false);
const mcpError = ref('');
const mcpFormOpen = ref(false);
const mcpArgsText = ref('');
const mcpDraft = ref({
  name: '',
  type: 'stdio' as 'stdio' | 'remote',
  url: '',
  command: '',
});

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
    if (s === 'services') void loadMcp();
    if (s === 'skills') void loadSkills();
  },
);

// ── 技能管理（P1-2） ──────────────────────────────────────────
type SkillRow = {
  name: string;
  description: string;
  source: string;
  path?: string;
  version?: string;
  author?: string;
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
});

async function loadSkills() {
  if (!app.client) return;
  skillLoading.value = true;
  skillError.value = '';
  try {
    const data = await app.client.listSkills();
    skills.value = data.skills ?? [];
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
    };
  } else {
    skillDraft.value = { name: '', description: '', prompt: '', source: 'project' };
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
    });
    skillFormOpen.value = false;
    await loadSkills();
  } catch (e) {
    skillError.value = String(e);
  }
}

async function removeSkill(row: SkillRow) {
  if (!app.client) return;
  try {
    await app.client.deleteSkill(row.name, row.source as 'user' | 'project' | 'workspace');
    await loadSkills();
  } catch (e) {
    skillError.value = String(e);
  }
}

async function saveMcp() {
  const name = mcpDraft.value.name.trim();
  if (!name || !app.client) return;
  try {
    await app.client.upsertMcpServer(name, {
      type: mcpDraft.value.type,
      url: mcpDraft.value.type === 'remote' ? mcpDraft.value.url : undefined,
      command: mcpDraft.value.type === 'stdio' ? mcpDraft.value.command : undefined,
      args: mcpDraft.value.type === 'stdio'
        ? mcpArgsText.value.split(/\s+/).filter(Boolean)
        : undefined,
      enabled: true,
      source: 'project',
    });
    mcpFormOpen.value = false;
    mcpDraft.value = { name: '', type: 'stdio', url: '', command: '' };
    mcpArgsText.value = '';
    await loadMcp();
  } catch (e) {
    mcpError.value = String(e);
  }
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
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const res = await app.client.accountStatus();
      account.value = res.account;
      loginState.value = res.login_state ?? null;
      if (res.login_state === 'completed' || res.login_state === 'failed') break;
    }
    await refreshEntitlements();
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
    for (let i = 0; i < 60; i++) {
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

watch(section, (s) => {
  if (s === 'account') {
    void refreshAccount();
    void refreshEntitlements();
    void refreshLicense();
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

function onSave() {
  saveDesktopPreferences({ ...draft.value, nickname: draft.value.nickname.trim() || 'SaCode 用户' });
  dirty.value = false;
  feedback.value = '设置已保存';
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
          <!-- 通用 -->
          <template v-if="section === 'general'">
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
              <t-radio-group v-model="draft.density" variant="default-filled" size="small">
                <t-radio-button value="comfortable">舒适</t-radio-button>
                <t-radio-button value="compact">紧凑</t-radio-button>
              </t-radio-group>
            </label>
            <label class="settings-field">
              <span>语言</span>
              <t-radio-group v-model="draft.locale" variant="default-filled" size="small">
                <t-radio-button value="zh-CN">简体中文</t-radio-button>
                <t-radio-button value="en-US">English</t-radio-button>
              </t-radio-group>
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
              <t-switch v-model="draft.trayEnabled" />
            </label>
            <label class="settings-field">
              <span>开机自启</span>
              <t-switch v-model="draft.autostart" />
            </label>
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
                <div class="mcp-row-actions">
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
            <t-button size="small" style="margin-top: 12px" @click="mcpFormOpen = !mcpFormOpen">
              {{ mcpFormOpen ? '收起' : '添加服务器' }}
            </t-button>
            <div v-if="mcpFormOpen" class="mcp-form">
              <t-input v-model="mcpDraft.name" placeholder="名称" size="small" />
              <t-radio-group v-model="mcpDraft.type" variant="default-filled" size="small">
                <t-radio-button value="stdio">stdio</t-radio-button>
                <t-radio-button value="remote">remote</t-radio-button>
              </t-radio-group>
              <t-input
                v-if="mcpDraft.type === 'remote'"
                v-model="mcpDraft.url"
                placeholder="https://…"
                size="small"
              />
              <template v-else>
                <t-input v-model="mcpDraft.command" placeholder="command" size="small" />
                <t-input
                  v-model="mcpArgsText"
                  placeholder="args（空格分隔）"
                  size="small"
                />
              </template>
              <t-button size="small" theme="primary" @click="void saveMcp()">保存</t-button>
            </div>
          </template>

          <!-- 账号 / 权益 -->
          <template v-else-if="section === 'account'">
            <h3 class="settings-section-title">账号（sa-idp · 网关）</h3>
            <div v-if="accountLoading" class="muted">加载中…</div>
            <div v-else-if="accountError" class="composer-error">{{ accountError }}</div>
            <div v-else class="mcp-list">
              <div class="mcp-row">
                <div class="mcp-row-main">
                  <strong>{{ account?.logged_in ? (account.subject || '已登录') : '未登录' }}</strong>
                  <span class="muted">
                    {{ account?.logged_in
                      ? `${account.provider_name || 'sa-ai'} · ${account.models_count || 0} 个网关模型`
                      : '可使用本地模型；登录后同步网关模型' }}
                  </span>
                </div>
                <div class="muted mono" style="font-size: 11px">
                  {{ account?.gateway_base_url || '—' }}
                </div>
              </div>
            </div>
            <div class="mcp-row-actions" style="margin-top: 12px">
              <t-button
                v-if="!account?.logged_in"
                size="small"
                theme="primary"
                :disabled="accountBusy"
                @click="void onAccountLogin()"
              >
                登录 sa-idp
              </t-button>
              <template v-else>
                <t-button size="small" variant="outline" :disabled="accountBusy" @click="void onAccountSyncModels()">
                  同步模型
                </t-button>
                <t-button size="small" variant="outline" theme="danger" :disabled="accountBusy" @click="void onAccountLogout()">
                  退出登录
                </t-button>
              </template>
            </div>

            <h3 class="settings-section-title" style="margin-top: 24px">
              权益（sa-entitlement）
            </h3>
            <p class="muted" style="margin-bottom: 8px">
              产品 sacode · 能力按 capability 门禁，未知能力不会扩权。
              <span v-if="entBaseUrl" class="mono" style="font-size: 11px">{{ entBaseUrl }}</span>
            </p>
            <div v-if="entLoading" class="muted">加载中…</div>
            <div v-else-if="entError" class="composer-error">{{ entError }}</div>
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
          </template>

          <!-- 关于 -->
          <template v-else-if="section === 'about'">
            <h3 class="settings-section-title">关于</h3>
            <p class="muted">SaCode Desktop · Vue 3 + TDesign</p>
            <p class="muted">布局契约见 docs/plans/desktop-layout-contract.md</p>
          </template>

          <!-- 技能管理（P1-2） -->
          <template v-else-if="section === 'skills'">
            <h3 class="settings-section-title">技能</h3>
            <p class="muted" style="margin-bottom: 12px">用户 / 项目目录技能；同名项目覆盖用户。</p>
            <div class="mcp-list">
              <div v-if="skillLoading" class="muted">加载中…</div>
              <div v-else-if="skillError" class="composer-error">{{ skillError }}</div>
              <div v-else-if="!skills.length" class="muted">暂无技能</div>
              <div v-for="s in skills" :key="`${s.source}:${s.name}`" class="mcp-row">
                <div class="mcp-row-main">
                  <strong>{{ s.name }}</strong>
                  <span class="muted">{{ s.source }}</span>
                  <span style="flex: 1" />
                  <t-button size="small" variant="outline" @click="editSkill(s)">编辑</t-button>
                  <t-button size="small" variant="outline" theme="danger" @click="void removeSkill(s)">
                    删除
                  </t-button>
                </div>
                <div class="muted" style="font-size: 11px">{{ s.description || '（无描述）' }}</div>
              </div>
            </div>
            <t-button size="small" style="margin-top: 12px" @click="openSkillForm()">
              {{ skillFormOpen ? '收起' : '新建技能' }}
            </t-button>
            <div v-if="skillFormOpen" class="mcp-form">
              <t-input v-model="skillDraft.name" placeholder="名称" size="small" />
              <t-input v-model="skillDraft.description" placeholder="描述" size="small" />
              <t-radio-group v-model="skillDraft.source" variant="default-filled" size="small">
                <t-radio-button value="project">项目</t-radio-button>
                <t-radio-button value="user">用户</t-radio-button>
              </t-radio-group>
              <t-textarea
                v-model="skillDraft.prompt"
                :autosize="{ minRows: 4, maxRows: 12 }"
                placeholder="技能提示词（支持 {{args}} {{cwd}} {{skill_name}}）"
              />
              <t-button size="small" theme="primary" @click="void saveSkill()">保存技能</t-button>
            </div>
          </template>

          <!-- 其它分区占位 -->
          <template v-else>
            <h3 class="settings-section-title">{{ navItems.find((n) => n.id === section)?.label }}</h3>
            <p class="muted">此分区的管理表单将在功能对齐阶段接入（模型 / Git / 安全 / 导入 / 账号）。</p>
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
