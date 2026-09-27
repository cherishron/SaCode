/** SettingsCenter — Desktop 本地设置中心 */
import { el } from '../dom.ts';
import type { DesktopApp } from './service.ts';
import { selectWorkspaceFolder } from '../tauri-bridge.ts';
import type { ConversationMode } from './top-bar.ts';
import { brandLogo, logoUrlForTheme } from '../brand.ts';
import type { AuditScanTier } from '@cherishron/sacode-client-core';

export type SettingsSection =
  | 'general'
  | 'account'
  | 'execution'
  | 'appearance'
  | 'project'
  | 'git'
  | 'security'
  | 'hooks'
  | 'import'
  | 'services'
  | 'about';
export type InterfaceDensity = 'comfortable' | 'compact';
export type ThemePreference = 'system' | 'dark' | 'light';
export type TerminalShell = 'powershell' | 'cmd' | 'pwsh' | 'bash' | 'wsl' | 'windows-terminal' | 'system-default';

export interface DesktopPreferences {
  nickname: string;
  defaultMode: ConversationMode;
  defaultBackend: string;
  defaultModel: string;
  defaultSkill: string;
  density: InterfaceDensity;
  theme: ThemePreference;
  sidebarOpen: boolean;
  contextOpen: boolean;
  restoreLastProject: boolean;
  /** 默认终端：使用本机已安装的 shell */
  defaultTerminal: TerminalShell;
  /** 默认项目位置：新建项目会话时预填的目录 */
  defaultProjectDir: string;
  /** 界面语言：当前仅简体中文与英文两档 */
  locale: 'zh-CN' | 'en-US';
  /** 系统托盘：关闭窗口时隐藏到托盘而不是退出 */
  trayEnabled: boolean;
  /** 开机自启动 */
  autostart: boolean;
}

export interface SettingsState {
  open: boolean;
  section: SettingsSection;
  draft: DesktopPreferences;
  dirty: boolean;
  switchingProject: boolean;
  busy: boolean;
  feedback: string;
  localProviders: { name: string; base_url: string; models: string[]; has_credential: boolean }[];
  connectionMode: 'local' | 'gateway';
  providerForm: { name: string; baseUrl: string; apiKey: string; model: string; upstream: string; thinking: boolean };
  /** Git 分区：平台授权状态与进行中的设备流 */
  gitAuth: { platforms: { host: string; configured: boolean; login: string | null; updated_at: string | null }[]; loading: boolean; deviceFlow: { device_code: string; user_code: string; verification_uri: string; verification_uri_complete?: string | null } | null; polling: boolean; error: string | null; giteeCode: string };
  /** Hooks 分区：只读 hooks 列表与配置来源 */
  hooks: { entries: { name: string; event: string; command: string; enabled: boolean }[]; configPath: string; loading: boolean; error: string | null };
  /** Import 分区：外部工具探测与勾选状态 */
  importTools: { tools: { id: string; label: string; config_path: string; provider_count: number }[]; providers: { name: string; base_url: string; model: string; has_api_key: boolean }[]; selected: string[]; activeTool: string | null; loading: boolean; busy: boolean; error: string | null; feedback: string | null };
}

const STORAGE_KEY = 'sacode.desktop.preferences';

export function loadDesktopPreferences(app?: DesktopApp): DesktopPreferences {
  const fallback: DesktopPreferences = {
    nickname: localStorage.getItem('sacode.user.nickname')?.trim() || 'SaCode 用户',
    defaultMode: 'build',
    defaultBackend: app?.defaultBackend || 'sacode',
    defaultModel: app?.workspaceCapabilities.models[0]?.id || '',
    defaultSkill: '',
    density: 'comfortable',
    theme: 'dark',
    sidebarOpen: true,
    contextOpen: true,
    restoreLastProject: true,
    defaultTerminal: 'system-default',
    defaultProjectDir: '',
    locale: 'zh-CN',
    trayEnabled: false,
    autostart: false,
  };
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Partial<DesktopPreferences>;
    return {
      ...fallback,
      ...parsed,
      nickname: parsed.nickname?.trim() || fallback.nickname,
      defaultBackend: parsed.defaultBackend || fallback.defaultBackend,
      defaultModel: typeof parsed.defaultModel === 'string' ? parsed.defaultModel : fallback.defaultModel,
      defaultSkill: typeof parsed.defaultSkill === 'string' ? parsed.defaultSkill : fallback.defaultSkill,
      theme: parsed.theme === 'dark' || parsed.theme === 'light' || parsed.theme === 'system' ? parsed.theme : fallback.theme,
      defaultTerminal: parsed.defaultTerminal || fallback.defaultTerminal,
    };
  } catch {
    return fallback;
  }
}

export function saveDesktopPreferences(preferences: DesktopPreferences) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  localStorage.setItem('sacode.user.nickname', preferences.nickname.trim() || 'SaCode 用户');
  applyInterfacePreferences(preferences);
}

let systemThemeListenerRegistered = false;

function refreshBrandAssets() {
  const logo = logoUrlForTheme();
  document.querySelectorAll<HTMLImageElement>('img.sa-logo').forEach(image => { image.src = logo; });
  const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (favicon) favicon.href = logo;
}

export function applyInterfacePreferences(preferences: DesktopPreferences) {
  document.documentElement.dataset.density = preferences.density;
  if (preferences.theme === 'system') {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = preferences.theme;
  }
  // 开发工作台默认深色；未显式跟随系统时确保 data-theme 存在
  if (!document.documentElement.dataset.theme && preferences.theme !== 'system') {
    document.documentElement.dataset.theme = 'dark';
  }
  refreshBrandAssets();
  if (!systemThemeListenerRegistered && typeof window.matchMedia === 'function') {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', refreshBrandAssets);
    systemThemeListenerRegistered = true;
  }
}

export function createSettingsState(app?: DesktopApp): SettingsState {
  return {
    open: false,
    section: 'general',
    draft: loadDesktopPreferences(app),
    dirty: false,
    switchingProject: false,
    busy: false,
    feedback: '',
    localProviders: [],
    connectionMode: 'local',
    providerForm: { name: '', baseUrl: '', apiKey: '', model: '', upstream: '', thinking: false },
    gitAuth: {
      platforms: [],
      loading: false,
      deviceFlow: null,
      polling: false,
      error: null,
      giteeCode: '',
    },
    hooks: { entries: [], configPath: '', loading: false, error: null },
    importTools: {
      tools: [],
      providers: [],
      selected: [],
      activeTool: null,
      loading: false,
      busy: false,
      error: null,
      feedback: null,
    },
  };
}

export function openSettings(state: SettingsState, app: DesktopApp) {
  state.open = true;
  state.draft = loadDesktopPreferences(app);
  if (app.workspaceCapabilities.models.length > 0 && state.draft.defaultModel && !app.workspaceCapabilities.models.some((model) => model.id === state.draft.defaultModel)) {
    state.draft.defaultModel = '';
  }
  if (app.workspaceCapabilities.skills.length > 0 && state.draft.defaultSkill && !app.workspaceCapabilities.skills.some((skill) => skill.name === state.draft.defaultSkill)) {
    state.draft.defaultSkill = '';
  }
  if (app.agents.length > 0 && !app.agents.some((agent) => agent.id === state.draft.defaultBackend)) {
    state.draft.defaultBackend = app.defaultBackend || app.agents[0].id;
  }
  state.dirty = false;
  state.switchingProject = false;
  state.feedback = '';
  state.providerForm = { name: '', baseUrl: '', apiKey: '', model: '', upstream: '', thinking: false };
  const workspace = app.workspace;
  state.localProviders = [];
  void app.listLocalProviders().then((result) => {
    if (!state.open || app.workspace !== workspace) return;
    state.localProviders = result.providers;
    app.onChange?.();
  }).catch(() => {});
  // 懒加载新分区数据：Git / Hooks / Import 均按需请求，避免每次打开设置都打满 daemon。
  void refreshGitAuthSection(app, state).catch(() => {});
  void refreshHooksSection(app, state).catch(() => {});
  void refreshImportSection(app, state).catch(() => {});
}

async function refreshGitAuthSection(app: DesktopApp, state: SettingsState) {
  state.gitAuth.loading = true;
  try {
    const result = await app.refreshGitAuth();
    state.gitAuth.platforms = result.platforms.map((p) => ({
      host: p.host,
      configured: p.configured,
      login: p.login,
      updated_at: p.updated_at,
    }));
    state.gitAuth.error = null;
  } catch (e) {
    state.gitAuth.error = String(e);
  } finally {
    state.gitAuth.loading = false;
    app.onChange?.();
  }
}

async function refreshHooksSection(app: DesktopApp, state: SettingsState) {
  state.hooks.loading = true;
  try {
    const result = await app.listHooks();
    state.hooks.entries = result.hooks;
    state.hooks.configPath = result.config_path;
    state.hooks.error = null;
  } catch (e) {
    state.hooks.error = String(e);
  } finally {
    state.hooks.loading = false;
    app.onChange?.();
  }
}

async function refreshImportSection(app: DesktopApp, state: SettingsState) {
  state.importTools.loading = true;
  try {
    state.importTools.tools = await app.listImportTools();
    state.importTools.error = null;
  } catch (e) {
    state.importTools.error = String(e);
  } finally {
    state.importTools.loading = false;
    app.onChange?.();
  }
}

export interface SettingsActions {
  onClose: () => void;
  onSave: (preferences: DesktopPreferences) => void;
  onSwitchProject: (workspace: string) => Promise<void>;
  rerender: () => void;
}

export function buildSettingsCenter(
  app: DesktopApp,
  state: SettingsState,
  actions: SettingsActions,
): HTMLElement {
  return el('div', {
    className: 'settings-overlay',
    onclick: (event: Event) => {
      if (event.target === event.currentTarget && !state.switchingProject) actions.onClose();
    },
  }, [
    el('section', { className: 'settings-window', role: 'dialog', ariaModal: 'true' }, [
      el('header', { className: 'settings-header' }, [
        el('div', { className: 'settings-header-main' }, [
          brandLogo({ className: 'settings-brand-mark rounded', size: 26 }),
          el('div', { className: 'settings-header-copy' }, [
            el('h2', { className: 'settings-title' }, ['偏好设置']),
            el('div', { className: 'settings-subtitle' }, [workspaceName(app.workspace) || 'SaCode Desktop']),
          ]),
        ]),
        el('button', {
          className: 'settings-close',
          title: '关闭',
          onclick: actions.onClose,
        }, ['×']),
      ]),
      el('div', { className: 'settings-body' }, [
        buildSettingsNavigation(state, actions.rerender),
        el('main', { className: 'settings-content' }, [
          buildSectionContent(app, state, actions),
        ]),
      ]),
      el('footer', { className: 'settings-footer' }, [
        el('span', { className: `settings-save-status ${state.dirty ? 'dirty' : ''}` }, [
          state.dirty ? '有未保存的更改' : '设置已保存',
        ]),
        el('div', { className: 'settings-footer-actions' }, [
          el('button', { className: 'btn ghost settings-cancel-button', onclick: actions.onClose }, ['取消']),
          el('button', {
            className: 'btn settings-save-button',
            disabled: !state.dirty,
            onclick: () => actions.onSave({
              ...state.draft,
              nickname: state.draft.nickname.trim() || 'SaCode 用户',
            }),
          }, ['保存设置']),
        ]),
      ]),
    ]),
  ]);
}

function buildSettingsNavigation(state: SettingsState, rerender: () => void) {
  const items: Array<[SettingsSection, string]> = [
    ['general', '通用'],
    ['account', '账号'],
    ['execution', '模型与执行'],
    ['appearance', '界面'],
    ['project', '项目'],
    ['git', 'Git 平台'],
    ['security', '安全扫描'],
    ['hooks', 'Hooks'],
    ['import', '配置导入'],
    ['services', '服务'],
    ['about', '关于'],
  ];
  return el('nav', { className: 'settings-nav' }, items.map(([section, label]) =>
    el('button', {
      className: `settings-nav-item ${state.section === section ? 'active' : ''}`,
      onclick: () => {
        state.providerForm.apiKey = '';
        state.section = section;
        rerender();
      },
      title: label,
    }, [label]),
  ));
}

function buildSectionContent(app: DesktopApp, state: SettingsState, actions: SettingsActions): HTMLElement {
  switch (state.section) {
    case 'general': return buildGeneralSection(state, actions.rerender);
    case 'account': return buildAccountSection(app, state, actions.rerender);
    case 'execution': return buildExecutionSection(app, state, actions.rerender);
    case 'appearance': return buildAppearanceSection(state, actions.rerender);
    case 'project': return buildProjectSection(app, state, actions);
    case 'git': return buildGitSection(app, state, actions.rerender);
    case 'security': return buildSecuritySection(app, state);
    case 'hooks': return buildHooksSection(app, state, actions.rerender);
    case 'import': return buildImportSection(app, state, actions.rerender);
    case 'services': return buildServicesSection(app);
    case 'about': return buildAboutSection(app);
  }
}

function buildGeneralSection(state: SettingsState, rerender: () => void) {
  return settingsSection('通用', '账号显示与启动行为', [
    settingCard('个人资料', [
      settingRow('用户昵称', '显示在左侧栏底部', el('input', {
        className: 'settings-input',
        value: state.draft.nickname,
        maxLength: 40,
        oninput: (event: Event) => {
          state.draft.nickname = (event.target as HTMLInputElement).value;
          markDirty(state);
        },
      })),
    ]),
    settingCard('启动', [
      settingToggle('恢复上次打开的项目', '下次启动时自动打开最近项目', state.draft.restoreLastProject, (checked) => {
        state.draft.restoreLastProject = checked;
        markDirty(state);
        rerender();
      }),
      settingRow('默认项目位置', '新建任务时预填的工作目录', el('div', { className: 'settings-inline' }, [
        el('input', {
          className: 'settings-input',
          value: state.draft.defaultProjectDir,
          placeholder: '例如 D:\\Projects',
          oninput: (event: Event) => {
            state.draft.defaultProjectDir = (event.target as HTMLInputElement).value;
            markDirty(state);
          },
        }),
        el('button', {
          className: 'btn ghost',
          title: '浏览目录',
          onclick: async () => {
            const dir = await selectWorkspaceFolder();
            if (!dir) return;
            state.draft.defaultProjectDir = dir;
            markDirty(state);
            rerender();
          },
        }, ['浏览…']),
      ])),
      settingToggle('系统托盘', '关闭窗口时隐藏到托盘而不是退出', state.draft.trayEnabled, (checked) => {
        state.draft.trayEnabled = checked;
        markDirty(state);
        rerender();
      }),
      settingToggle('开机自启动', '登录 Windows 时自动以托盘方式启动', state.draft.autostart, (checked) => {
        state.draft.autostart = checked;
        markDirty(state);
        rerender();
      }),
    ]),
    settingCard('语言', [
      settingRow('界面语言', '切换后立即生效', settingsSelect(state.draft.locale, [
        ['zh-CN', '简体中文'],
        ['en-US', 'English'],
      ], (value) => {
        state.draft.locale = value === 'en-US' ? 'en-US' : 'zh-CN';
        markDirty(state);
        rerender();
      })),
      el('div', { className: 'settings-note' }, ['完整访问权限：SaCode 在本机拥有完整文件读写能力，请仅在可信项目中开启高风险执行模式。']),
    ]),
    settingCard('快捷键', [
      settingRow('侧栏', '显示 / 隐藏左侧项目栏', el('span', { className: 'settings-capability-value mono' }, ['Ctrl+B'])),
      settingRow('工具栏', '显示 / 隐藏右侧文件·终端·预览', el('span', { className: 'settings-capability-value mono' }, ['Ctrl+J'])),
      settingRow('发送任务', '输入框 Enter 发送，Shift+Enter 换行', el('span', { className: 'settings-capability-value mono' }, ['Enter'])),
      settingRow('关闭弹层', '关闭设置 / 新建任务 / 菜单', el('span', { className: 'settings-capability-value mono' }, ['Esc'])),
    ]),
  ]);
}

function modelStatusText(app: DesktopApp): string {
  if (app.workspaceCapabilities.models.length) return `当前项目可用 ${app.workspaceCapabilities.models.length} 个模型`;
  switch (app.workspaceCapabilities.model_status) {
    case 'not_logged_in': return '尚未登录，或还没有添加本地 Provider。可从「账号」登录或在此添加模型。';
    case 'no_gateway_models': return '已登录，但网关未返回可用模型。请到「账号」同步模型或检查授权。';
    case 'credential_unavailable': return '会话模型存在，但本机凭据不可用。请重新登录。';
    case 'no_authorized_provider': return '已有配置，但没有通过当前项目的 Provider 授权；请检查设置或重新同步。';
    default: return '当前项目没有可用模型。请登录或添加自定义 Provider。';
  }
}

async function settingsAction(state: SettingsState, rerender: () => void, run: () => Promise<void>, success: string) {
  if (state.busy) return;
  state.busy = true;
  state.feedback = '';
  rerender();
  try { await run(); state.feedback = success; }
  catch (error) { state.feedback = error instanceof Error ? error.message : String(error); }
  finally { state.providerForm.apiKey = ''; state.busy = false; rerender(); }
}

function buildAccountSection(app: DesktopApp, state: SettingsState, rerender: () => void): HTMLElement {
  const account = app.workspaceCapabilities.account;
  const loggedIn = account?.logged_in ?? false;
  return settingsSection('账号', '登录后同步网关模型；本地 Provider 不需要登录', [
    settingCard('登录状态', [
      statusRow(loggedIn ? account?.subject || '已登录' : '未登录', loggedIn ? `${account?.models_count || 0} 个网关模型` : '可使用本地模型', loggedIn ? 'ok' : 'neutral', loggedIn ? account?.provider_name || 'sa-ai' : '网关账号'),
      settingRow('网页登录', '在系统浏览器完成授权', el('button', { className: 'btn ghost', disabled: state.busy || loggedIn,
        onclick: () => void settingsAction(state, rerender, async () => { await app.accountLogin(); await pollAccountLogin(app, state, rerender); }, '登录完成，模型已更新'),
      }, ['登录'])),
      settingRow('刷新模型', '从账号网关重新同步授权的模型', el('button', { className: 'btn ghost', disabled: state.busy || !loggedIn,
        onclick: () => void settingsAction(state, rerender, () => app.accountSyncModels(), '模型已同步'),
      }, ['同步模型'])),
      settingRow('退出账号', '移除本机登录凭据；不影响独立配置的 Provider', el('button', { className: 'btn ghost', disabled: state.busy || !loggedIn,
        onclick: () => void settingsAction(state, rerender, () => app.accountLogout(), '已退出登录'),
      }, ['退出登录'])),
    ]),
    el('div', { className: 'settings-note' }, [state.feedback || modelStatusText(app)]),
  ]);
}

async function pollAccountLogin(app: DesktopApp, state: SettingsState, rerender: () => void): Promise<void> {
  for (let attempt = 0; attempt < 150; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    if (!state.open) return;
    const status = await app.accountStatus();
    if (status.login_state === 'completed' && status.account.logged_in) {
      await app.refreshWorkspaceCapabilities();
      return;
    }
    if (status.login_state === 'failed') {
      await app.refreshWorkspaceCapabilities();
      throw new Error(status.account.logged_in ? '登录成功，但模型获取失败；请检查网关并尝试同步模型' : '登录失败或超时，请重试');
    }
    if (!state.open) return;
    if (attempt % 3 === 0) rerender();
  }
  throw new Error('登录等待超时，请重试');
}

function buildExecutionSection(app: DesktopApp, state: SettingsState, rerender: () => void) {
  const backends = app.agents.length ? app.agents : [{ id: app.defaultBackend || 'sacode', display_name: 'SaCode' }];
  return settingsSection('模型与执行', '设置新会话和任务创建器的默认项', [
    settingCard('执行默认值', [
      settingRow('默认模式', '新会话采用的执行模式', settingsSelect(state.draft.defaultMode, [
        ['plan', '规划 — 只分析'], ['build', '构建 — 关键步骤确认'], ['yolo', 'YOLO — 全自动'],
      ], (value) => {
        state.draft.defaultMode = value as ConversationMode;
        markDirty(state);
      })),
      settingRow('默认 Backend', '负责执行新任务的后端', settingsSelect(state.draft.defaultBackend,
        backends.map((backend) => [backend.id, backend.display_name || backend.id]),
        (value) => {
          state.draft.defaultBackend = value;
          markDirty(state);
        },
      )),
      settingRow('默认模型', '来自当前项目有效 Provider 配置', settingsSelect(state.draft.defaultModel, [
        ['', app.workspaceCapabilities.models.length ? '自动选择首个可用模型' : '当前项目未配置模型'],
        ...app.workspaceCapabilities.models.map((model) => [model.id, `${model.provider} / ${model.model}`]),
      ], (value) => {
        state.draft.defaultModel = value;
        markDirty(state);
        rerender();
      })),
      settingRow('思考能力', '由所选模型配置决定', buildThinkingSummary(app, state.draft.defaultModel)),
      settingRow('默认技能', '新建任务和会话输入框的初始技能', settingsSelect(state.draft.defaultSkill, [
        ['', '不使用技能'],
        ...app.workspaceCapabilities.skills.map((skill) => [skill.name, `${skill.name} · ${skillSourceLabel(skill.source)}`]),
      ], (value) => {
        state.draft.defaultSkill = value;
        markDirty(state);
      })),
    ]),
    el('div', { className: 'settings-note' }, [state.feedback || modelStatusText(app)]),
    buildModelManagement(app, state, rerender),
  ]);
}

function buildModelManagement(app: DesktopApp, state: SettingsState, rerender: () => void): HTMLElement {
  const form = state.providerForm;
  const name = el('input', { className: 'settings-input', placeholder: '例如 my-provider', maxLength: 64, value: form.name,
    oninput: (e: Event) => { form.name = (e.target as HTMLInputElement).value; },
  }) as HTMLInputElement;
  const url = el('input', { className: 'settings-input', placeholder: 'https://api.example.com/v1', type: 'url', value: form.baseUrl,
    oninput: (e: Event) => { form.baseUrl = (e.target as HTMLInputElement).value; },
  }) as HTMLInputElement;
  const key = el('input', { className: 'settings-input', placeholder: 'API Key（仅发送到 daemon）', type: 'password', autocomplete: 'off', value: form.apiKey,
    oninput: (e: Event) => { form.apiKey = (e.target as HTMLInputElement).value; },
  }) as HTMLInputElement;
  const model = el('input', { className: 'settings-input', placeholder: '实际模型 ID', maxLength: 128, value: form.model,
    oninput: (e: Event) => { form.model = (e.target as HTMLInputElement).value; },
  }) as HTMLInputElement;
  const upstream = el('input', { className: 'settings-input', placeholder: '上游模型 ID（可选）', maxLength: 128, value: form.upstream,
    oninput: (e: Event) => { form.upstream = (e.target as HTMLInputElement).value; },
  }) as HTMLInputElement;
  const thinking = el('input', { type: 'checkbox', checked: form.thinking,
    onchange: (e: Event) => { form.thinking = (e.target as HTMLInputElement).checked; },
  }) as HTMLInputElement;
  return settingCard('添加自己的模型', [
    settingRow('连接方式', '本地直连无需账号；网关注册需要先登录', settingsSegmented(state.connectionMode, [
      ['local', '本地直连'], ['gateway', '网关注册'],
    ], (value) => { state.providerForm.apiKey = ''; state.connectionMode = value as 'local' | 'gateway'; rerender(); })),
    settingRow('Provider 名称', '英文、数字、- 或 _；项目内唯一', name),
    settingRow('OpenAI 兼容地址', '输入服务提供方给出的 API base URL', url),
    settingRow('API Key', '不会存入浏览器 localStorage', key),
    settingRow('模型 ID', '从服务商的模型列表复制真实 ID', model),
    ...(state.connectionMode === 'gateway' ? [settingRow('上游模型 ID', '不填写则与模型 ID 相同', upstream)] : [settingRow('思考能力', '仅当该模型实际支持时开启', thinking)]),
    el('button', { className: 'btn settings-provider-submit', disabled: state.busy,
      onclick: () => {
        const entry = { name: form.name.trim(), base_url: form.baseUrl.trim(), api_key: form.apiKey.trim(), model: form.model.trim() };
        form.apiKey = '';
        key.value = '';
        void settingsAction(state, rerender, async () => {
        if (!entry.name || !entry.base_url || !entry.api_key || !entry.model) throw new Error('请填写完整 Provider 名称、URL、API Key 和模型 ID');
        if (state.connectionMode === 'local') {
          await app.createLocalProvider({ name: entry.name, base_url: entry.base_url, api_key: entry.api_key, models: [entry.model], thinking: form.thinking });
          state.localProviders = (await app.listLocalProviders()).providers;
        } else {
          await app.registerModelConnection({ name: entry.name, base_url: entry.base_url, upstream_api_key: entry.api_key,
            models: [{ client_model: entry.model, upstream_model: form.upstream.trim() || entry.model }] });
        }
        state.providerForm = { name: '', baseUrl: '', apiKey: '', model: '', upstream: '', thinking: false };
        }, '模型已添加，可在上方选择');
      },
    }, ['添加模型']),
    ...state.localProviders.map((provider) => el('div', { className: 'settings-recent-project' }, [
      el('div', { className: 'settings-recent-copy' }, [el('strong', {}, [provider.name]), el('span', {}, [`${provider.models.join('、')} · ${provider.base_url}`])]),
      el('button', { className: 'settings-link-button danger-text', disabled: state.busy, onclick: () => {
        if (!window.confirm(`删除本地 Provider「${provider.name}」及其本机密钥？`)) return;
        void settingsAction(state, rerender, async () => {
          await app.deleteLocalProvider(provider.name);
          state.localProviders = (await app.listLocalProviders()).providers;
        }, 'Provider 已移除');
      } }, ['移除']),
    ])),
  ]);
}

function buildThinkingSummary(app: DesktopApp, modelId: string): HTMLElement {
  const model = app.workspaceCapabilities.models.find((item) => item.id === modelId)
    || app.workspaceCapabilities.models[0];
  if (!model) return el('span', { className: 'settings-capability-value muted' }, ['无可用模型']);
  if (!model.thinking) return el('span', { className: 'settings-capability-value' }, ['此模型未启用思考']);
  return el('span', { className: 'settings-thinking-value' }, [
    model.reasoning_effort ? `已启用 · ${model.reasoning_effort}` : '已启用 · 使用模型默认强度',
  ]);
}

function buildAppearanceSection(state: SettingsState, rerender: () => void) {
  return settingsSection('界面', '调整桌面端布局与信息密度', [
    settingCard('显示', [
      settingRow('界面密度', '控制列表、工具栏和卡片的间距', settingsSegmented(state.draft.density, [
        ['comfortable', '舒适'], ['compact', '紧凑'],
      ], (value) => {
        state.draft.density = value as InterfaceDensity;
        markDirty(state);
        applyInterfacePreferences(state.draft);
        rerender();
      })),
      settingToggle('默认展开左侧栏', '启动时显示项目和会话列表', state.draft.sidebarOpen, (checked) => {
        state.draft.sidebarOpen = checked;
        markDirty(state);
        rerender();
      }),
      settingToggle('默认展开右侧栏', '启动时显示变更、终端和设计上下文', state.draft.contextOpen, (checked) => {
        state.draft.contextOpen = checked;
        markDirty(state);
        rerender();
      }),
    ]),
    settingCard('主题', [
      settingRow('颜色主题', '开发工作台默认深色', settingsSegmented(state.draft.theme, [
        ['dark', '深色'], ['light', '浅色'], ['system', '跟随系统'],
      ], (value) => {
        state.draft.theme = value as ThemePreference;
        markDirty(state);
        applyInterfacePreferences(state.draft);
        rerender();
      })),
    ]),
    settingCard('终端', [
      settingRow('默认终端', '新建终端时使用的本机 Shell', settingsSelect(state.draft.defaultTerminal, [
        ['system-default', '系统默认'],
        ['powershell', 'Windows PowerShell'],
        ['pwsh', 'PowerShell 7+'],
        ['cmd', '命令提示符 CMD'],
        ['windows-terminal', 'Windows Terminal'],
        ['bash', 'Git Bash / WSL Bash'],
        ['wsl', 'WSL'],
      ], (value) => {
        state.draft.defaultTerminal = value as TerminalShell;
        markDirty(state);
      })),
      settingRow('多终端', '可在工具栏中同时打开多个终端并切换', el('span', { className: 'settings-capability-value' }, ['已启用 · 每分屏独立'])),
    ]),
  ]);
}

function buildProjectSection(app: DesktopApp, state: SettingsState, actions: SettingsActions) {
  return settingsSection('项目', '管理当前工作区和最近项目', [
    settingCard('当前项目', [
      el('div', { className: 'settings-project-current' }, [
        el('div', { className: 'settings-project-icon' }, ['□']),
        el('div', { className: 'settings-project-copy' }, [
          el('strong', {}, [workspaceName(app.workspace) || '未选择项目']),
          el('span', {}, [app.workspace || '请选择一个工作目录']),
        ]),
        el('button', {
          className: 'btn ghost',
          disabled: state.switchingProject,
          onclick: () => void (async () => {
            const workspace = await selectWorkspaceFolder();
            if (!workspace || workspace === app.workspace) return;
            state.switchingProject = true;
            actions.rerender();
            try {
              await actions.onSwitchProject(workspace);
            } finally {
              state.switchingProject = false;
            }
          })(),
        }, [state.switchingProject ? '切换中…' : '切换项目']),
      ]),
    ]),
    settingCard('最近项目', buildRecentProjectRows(app, state, actions)),
  ]);
}

function buildRecentProjectRows(app: DesktopApp, state: SettingsState, actions: SettingsActions): Node[] {
  const projects = readRecentProjects(app.workspace);
  if (projects.length === 0) return [el('div', { className: 'settings-empty' }, ['暂无最近项目'])];
  return projects.map((project) => el('div', { className: 'settings-recent-project' }, [
    el('div', { className: 'settings-recent-copy' }, [
      el('strong', {}, [workspaceName(project)]),
      el('span', {}, [project]),
    ]),
    el('button', {
      className: 'settings-link-button',
      disabled: project === app.workspace || state.switchingProject,
      onclick: () => void actions.onSwitchProject(project),
    }, [project === app.workspace ? '当前' : '打开']),
    el('button', {
      className: 'settings-link-button danger-text',
      disabled: project === app.workspace,
      onclick: () => {
        const next = projects.filter((item) => item !== project);
        localStorage.setItem('sacode.recentProjects', JSON.stringify(next));
        actions.rerender();
      },
    }, ['移除']),
  ]));
}

function buildServicesSection(app: DesktopApp) {
  const healthLabel = app.health?.status === 'healthy' ? '运行正常' : app.health?.status === 'degraded' ? '服务异常' : '正在连接';
  const providers = new Map<string, number>();
  for (const model of app.workspaceCapabilities.models) {
    providers.set(model.provider, (providers.get(model.provider) || 0) + 1);
  }
  return settingsSection('服务状态', '查看 daemon、执行后端和当前项目 Provider 状态', [
    settingCard('本地服务', [
      statusRow('SaCode daemon', healthLabel, app.health?.status === 'healthy' ? 'ok' : 'warn', app.handle ? `${app.handle.host}:${app.handle.port}` : '尚未就绪'),
      ...app.agents.map((agent) => statusRow(agent.display_name || agent.id, agent.health || 'unknown', agent.health === 'ready' ? 'ok' : 'neutral', agent.id)),
    ]),
    settingCard('当前项目 Provider', providers.size > 0
      ? [...providers.entries()].map(([provider, count]) => statusRow(provider, '已授权', 'ok', `${count} 个可用模型`))
      : [el('div', { className: 'settings-empty' }, ['当前项目没有已授权的 Provider'])]),
    settingCard('凭据安全', [
      el('div', { className: 'settings-provider-warning' }, [
        el('strong', {}, ['凭据由安全配置层管理']),
        el('span', {}, ['桌面端不会读取或把 API Key 保存到 localStorage。此处仅展示 daemon 返回的已授权能力。']),
      ]),
    ]),
  ]);
}

function buildAboutSection(app: DesktopApp) {
  return settingsSection('关于', 'SaCode Desktop 运行信息', [
    el('div', { className: 'settings-about-card' }, [
      brandLogo({ className: 'settings-about-logo rounded', size: 44 }),
      el('div', {}, [
        el('h3', {}, ['SaCode Desktop']),
        el('p', {}, [`版本 ${app.handle?.version || '1.1.1'}`]),
        el('p', {}, [`运行模式：${app.mode === 'tauri' ? 'Tauri Desktop' : 'Vite Browser'}`]),
      ]),
    ]),
    el('div', { className: 'settings-note' }, ['本软件以本地优先方式运行，任务数据与项目文件保留在当前设备和项目工作区。']),
  ]);
}

/* ---------- Git 平台分区 ---------- */

function buildGitSection(app: DesktopApp, state: SettingsState, rerender: () => void) {
  const git = state.gitAuth;
  const platformLabel = (host: string) => (host === 'github' ? 'GitHub' : host === 'gitee' ? 'Gitee' : host);
  return settingsSection('Git 平台', '关联代码托管账号以启用 PR 审查与仓库操作', [
    settingCard('平台授权', [
      ...git.platforms.map((platform) => el('div', { className: 'settings-git-platform' }, [
        el('span', { className: `settings-dot ${platform.configured ? 'ok' : 'muted'}` }),
        el('div', { className: 'settings-git-copy' }, [
          el('strong', {}, [platformLabel(platform.host)]),
          el('span', { className: 'muted' }, [
            platform.configured
              ? `已关联${platform.login ? `：${platform.login}` : ''}`
              : '未关联',
          ]),
        ]),
        el('button', {
          className: `btn ${platform.configured ? 'ghost' : ''}`,
          disabled: git.loading || git.polling,
          onclick: () => {
            if (platform.configured) {
              void (async () => {
                try { await app.gitAuthLogout(platform.host as 'github' | 'gitee'); await refreshGitAuthSection(app, state); }
                catch (e) { git.error = String(e); rerender(); }
              })();
            } else if (platform.host === 'github') {
              void (async () => {
                try {
                  const flow = await app.startGithubDeviceFlow();
                  git.deviceFlow = flow;
                  git.polling = true;
                  rerender();
                  const result = await app.pollGithubDeviceFlow(flow.device_code);
                  git.polling = false;
                  git.deviceFlow = null;
                  if (result.status === 'ok') await refreshGitAuthSection(app, state);
                } catch (e) {
                  git.polling = false;
                  git.error = String(e);
                  rerender();
                }
              })();
            } else {
              void (async () => {
                try {
                  const flow = await app.authorizeGitee();
                  window.open(flow.authorize_url, '_blank', 'noopener');
                  git.error = null;
                  rerender();
                } catch (e) {
                  git.error = String(e);
                  rerender();
                }
              })();
            }
          },
        }, [platform.configured ? '断开' : platform.host === 'github' ? '关联' : '授权']),
      ])),
      ...(git.loading ? [el('div', { className: 'settings-empty' }, ['正在读取授权状态…'])] : []),
      ...(git.platforms.length === 0 && !git.loading ? [el('div', { className: 'settings-empty' }, ['没有任何 Git 平台可配置'])] : []),
    ]),
    ...(git.deviceFlow ? [settingCard('GitHub 设备授权', [
      el('div', { className: 'settings-device-flow' }, [
        el('div', { className: 'settings-device-code' }, [git.deviceFlow.user_code]),
        el('div', { className: 'settings-hint' }, [
          '请在浏览器打开 ',
          el('a', { href: git.deviceFlow.verification_uri, target: '_blank', rel: 'noopener' }, [git.deviceFlow.verification_uri]),
          ' 并输入上面的设备码。等待授权中…',
        ]),
        ...(git.deviceFlow.verification_uri_complete
          ? [el('a', { className: 'btn', href: git.deviceFlow.verification_uri_complete, target: '_blank', rel: 'noopener' }, ['一键打开授权页'])]
          : []),
      ]),
    ])] : []),
    ...(platformHostIsGitee(git) ? [settingCard('Gitee 授权码', [
      el('div', { className: 'settings-inline' }, [
        el('input', {
          className: 'settings-input',
          placeholder: '粘贴 Gitee 授权码',
          value: git.giteeCode,
          oninput: (event: Event) => { git.giteeCode = (event.target as HTMLInputElement).value; },
        }),
        el('button', {
          className: 'btn',
          disabled: !git.giteeCode.trim(),
          onclick: () => void (async () => {
            try { await app.completeGiteeAuth(git.giteeCode.trim()); git.giteeCode = ''; await refreshGitAuthSection(app, state); }
            catch (e) { git.error = String(e); rerender(); }
          })(),
        }, ['完成关联']),
      ]),
    ])] : []),
    ...(git.error ? [el('div', { className: 'settings-error' }, [git.error])] : []),
  ]);
}

function platformHostIsGitee(git: SettingsState['gitAuth']): boolean {
  return git.platforms.some((p) => p.host === 'gitee' && !p.configured);
}

/* ---------- 安全扫描分区 ---------- */

function buildSecuritySection(app: DesktopApp, state: SettingsState) {
  const tiers: Array<[AuditScanTier, string, string]> = [
    ['static', '静态扫描', '本地高危模式匹配，不调用模型，秒级完成'],
    ['lightweight', '轻量扫描', '静态规则 + 少量 AI 复核，适合日常提交'],
    ['deep', '深度扫描', '全量启发式 + AI 完整审计，适合发布前'],
  ];
  const activeIndex = tiers.findIndex(([id]) => id === app.auditTier);
  return settingsSection('安全扫描', '选择扫描层级并查看历史报告', [
    settingCard('扫描层级', tiers.map(([id, name, description]) => el('button', {
      className: `settings-tier-card ${app.auditTier === id ? 'active' : ''}`,
      onclick: () => {
        if (app.auditTier === id) return;
        void app.runAudit(id);
      },
    }, [
      el('div', { className: 'settings-tier-head' }, [
        el('span', { className: `settings-tier-badge tier-${id}` }, [String(activeIndex + 1)]),
        el('strong', {}, [name]),
      ]),
      el('span', { className: 'muted' }, [description]),
    ]))),
    settingCard('历史报告', app.auditReports.length === 0
      ? [el('div', { className: 'settings-empty' }, ['暂无扫描报告'])]
      : [el('div', { className: 'settings-report-list' }, app.auditReports.map((report) => el('button', {
          className: `settings-report-row ${app.currentAuditId === report.audit_id ? 'active' : ''}`,
          onclick: () => void app.selectAudit(report.audit_id),
        }, [
          el('span', { className: `settings-dot ${report.high > 0 ? 'bad' : report.finding_count > 0 ? 'warn' : 'ok'}` }),
          el('span', { className: 'settings-report-id mono' }, [report.audit_id.slice(0, 19)]),
          el('span', { className: 'muted' }, [report.created_at.replace('T', ' ').slice(0, 19)]),
          el('span', { className: 'settings-report-counts' }, [
            el('span', { className: 'count high' }, [`高 ${report.high}`]),
            el('span', { className: 'count medium' }, [`中 ${report.medium}`]),
          ]),
        ])))]),
    ...(state.busy || app.auditRunning ? [el('div', { className: 'settings-note' }, ['扫描进行中，请稍候…'])] : []),
  ]);
}

/* ---------- Hooks 分区 ---------- */

function buildHooksSection(app: DesktopApp, state: SettingsState, rerender: () => void) {
  const hooks = state.hooks;
  return settingsSection('Hooks', '只读查看用户级 hooks 配置', [
    settingCard('配置来源', [
      el('div', { className: 'settings-mono-row' }, [
        el('span', { className: 'mono' }, [hooks.configPath || '未找到配置文件']),
        el('span', { className: 'settings-count-badge' }, [String(hooks.entries.length)]),
      ]),
    ]),
    settingCard('已配置 Hooks', hooks.entries.length === 0
      ? [el('div', { className: 'settings-empty' }, ['暂无 hooks。可在 ~/.sacode/settings.json 中配置。'])]
      : hooks.entries.map((hook) => el('div', { className: 'settings-hook-row' }, [
          el('span', { className: `settings-dot ${hook.enabled ? 'ok' : 'muted'}` }),
          el('div', { className: 'settings-hook-copy' }, [
            el('strong', {}, [hook.name]),
            el('span', { className: 'mono' }, [hook.command]),
          ]),
          el('span', { className: 'settings-hook-event' }, [hook.event]),
        ])),
    ),
    el('div', { className: 'settings-note' }, ['SaCode 只在此展示配置内容；hooks 的加载与执行由 CLI 负责。']),
    ...(hooks.error ? [el('div', { className: 'settings-error' }, [hooks.error])] : []),
  ]);
}

/* ---------- 配置导入分区 ---------- */

function buildImportSection(app: DesktopApp, state: SettingsState, rerender: () => void) {
  const imp = state.importTools;
  return settingsSection('配置导入', '从其他编码工具导入 Provider 配置', [
    settingCard('检测到的工具', imp.tools.length === 0
      ? [el('div', { className: 'settings-empty' }, ['未检测到已安装的外部工具'])]
      : imp.tools.map((tool) => el('button', {
          className: `settings-tool-card ${imp.activeTool === tool.id ? 'active' : ''}`,
          onclick: () => void (async () => {
            imp.activeTool = tool.id;
            imp.selected = [];
            imp.busy = true;
            imp.error = null;
            imp.feedback = null;
            rerender();
            try {
              imp.providers = await app.listImportProviders(tool.id);
              imp.selected = imp.providers.map((p) => p.name);
            } catch (e) {
              imp.error = String(e);
            } finally {
              imp.busy = false;
              rerender();
            }
          })(),
        }, [
          el('strong', {}, [tool.label]),
          el('span', { className: 'mono muted' }, [tool.config_path]),
          el('span', { className: 'settings-count-badge' }, [`${tool.provider_count} 个 Provider`]),
        ]))),
    ...(imp.activeTool && imp.providers.length > 0 ? [settingCard('选择要导入的 Provider',
      imp.providers.map((provider) => el('label', { className: 'settings-import-row' }, [
        el('input', {
          type: 'checkbox',
          checked: imp.selected.includes(provider.name),
          onchange: (event: Event) => {
            const checked = (event.target as HTMLInputElement).checked;
            imp.selected = checked
              ? [...imp.selected, provider.name]
              : imp.selected.filter((name) => name !== provider.name);
            markDirty(state);
          },
        }),
        el('div', { className: 'settings-import-copy' }, [
          el('strong', {}, [provider.name]),
          el('span', { className: 'mono muted' }, [provider.base_url]),
          el('span', { className: 'muted' }, [provider.model || '未指定模型']),
        ]),
        ...(provider.has_api_key ? [el('span', { className: 'settings-count-badge' }, ['含密钥'])] : []),
      ])),
    )] : []),
    ...(imp.activeTool && imp.providers.length > 0 ? [el('div', { className: 'settings-footer-actions' }, [
      el('button', {
        className: 'btn',
        disabled: imp.busy || imp.selected.length === 0,
        onclick: () => void (async () => {
          imp.busy = true;
          imp.error = null;
          imp.feedback = null;
          rerender();
          try {
            await app.applyImport(imp.activeTool!, imp.selected);
            imp.feedback = `已导入 ${imp.selected.length} 个 Provider`;
          } catch (e) {
            imp.error = String(e);
          } finally {
            imp.busy = false;
            rerender();
          }
        })(),
      }, [imp.busy ? '导入中…' : `导入 ${imp.selected.length} 项`]),
    ])] : []),
    el('div', { className: 'settings-note' }, ['导入只写入本项目的 provider.json；不会读取或回写外部工具配置。密钥不会明文落盘。']),
    ...(imp.error ? [el('div', { className: 'settings-error' }, [imp.error])] : []),
    ...(imp.feedback ? [el('div', { className: 'settings-success' }, [imp.feedback])] : []),
  ]);
}

function settingsSection(title: string, subtitle: string, children: Node[]): HTMLElement {
  return el('div', { className: 'settings-section' }, [
    el('div', { className: 'settings-section-heading' }, [
      el('h3', {}, [title]),
      el('p', {}, [subtitle]),
    ]),
    ...children,
  ]);
}

function settingCard(title: string, children: Node[]): HTMLElement {
  return el('section', { className: 'settings-card' }, [
    el('h4', { className: 'settings-card-title' }, [title]),
    ...children,
  ]);
}

function settingRow(label: string, description: string, control: Node): HTMLElement {
  return el('div', { className: 'settings-row' }, [
    el('div', { className: 'settings-row-copy' }, [
      el('strong', {}, [label]),
      el('span', {}, [description]),
    ]),
    el('div', { className: 'settings-row-control' }, [control]),
  ]);
}

function settingToggle(label: string, description: string, checked: boolean, onChange: (checked: boolean) => void): HTMLElement {
  return settingRow(label, description, el('label', { className: 'settings-toggle' }, [
    el('input', {
      type: 'checkbox',
      checked,
      onchange: (event: Event) => onChange((event.target as HTMLInputElement).checked),
    }),
    el('span', { className: 'settings-toggle-track' }),
  ]));
}

function settingsSelect(value: string, options: string[][], onChange: (value: string) => void): HTMLSelectElement {
  return el('select', {
    className: 'settings-select',
    value,
    onchange: (event: Event) => onChange((event.target as HTMLSelectElement).value),
  }, options.map(([optionValue, label]) => el('option', {
    value: optionValue,
    selected: optionValue === value,
  }, [label])));
}

function settingsSegmented(value: string, options: string[][], onChange: (value: string) => void): HTMLElement {
  return el('div', { className: 'settings-segmented' }, options.map(([optionValue, label]) =>
    el('button', {
      className: value === optionValue ? 'active' : '',
      onclick: () => onChange(optionValue),
    }, [label]),
  ));
}

function statusRow(name: string, status: string, tone: 'ok' | 'warn' | 'neutral', detail: string): HTMLElement {
  return el('div', { className: 'settings-status-row' }, [
    el('span', { className: `settings-status-dot ${tone}` }),
    el('div', { className: 'settings-status-copy' }, [
      el('strong', {}, [name]),
      el('span', {}, [detail]),
    ]),
    el('span', { className: 'settings-status-label' }, [status]),
  ]);
}

function markDirty(state: SettingsState) {
  state.dirty = true;
  const saveButton = document.querySelector('.settings-footer .btn:not(.ghost)') as HTMLButtonElement | null;
  if (saveButton) saveButton.disabled = false;
  const status = document.querySelector('.settings-save-status');
  if (status) {
    status.classList.add('dirty');
    status.textContent = '有未保存的更改';
  }
}

function skillSourceLabel(source: string): string {
  if (source === 'project') return '项目';
  if (source === 'workspace') return '工作区';
  if (source === 'user') return '用户';
  return source;
}

function workspaceName(path: string): string {
  return path.replace(/[\\/]+$/, '').replace(/\\/g, '/').split('/').pop() || path;
}

function readRecentProjects(current: string): string[] {
  let stored: string[] = [];
  try {
    stored = JSON.parse(localStorage.getItem('sacode.recentProjects') || '[]') as string[];
  } catch {
    stored = [];
  }
  return [current, ...stored]
    .map((item) => item?.trim())
    .filter((item, index, all): item is string => Boolean(item) && all.indexOf(item) === index)
    .slice(0, 8);
}
