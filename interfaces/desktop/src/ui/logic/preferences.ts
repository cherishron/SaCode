/**
 * 桌面端偏好设置模型 — 纯逻辑，无 DOM 渲染依赖。
 *
 * 从旧 app/settings.ts 中抽出的「可复用部分」：类型、localStorage 读写、
 * 主题落盘。旧文件中的 `el()` 渲染函数属于待删除的 DOM 遗留树。
 */

/** 执行模式：与 top-bar 的 ConversationMode 同构，避免依赖遗留模块。 */
export type ConversationMode = 'plan' | 'build' | 'yolo';

export type InterfaceDensity = 'comfortable' | 'compact';
export type ThemePreference = 'system' | 'dark' | 'light';
export type TerminalShell =
  | 'powershell'
  | 'cmd'
  | 'pwsh'
  | 'bash'
  | 'wsl'
  | 'windows-terminal'
  | 'system-default';

export type SettingsSection =
  | 'general'
  | 'account'
  | 'agent-backends'
  | 'execution'
  | 'appearance'
  | 'project'
  | 'git'
  | 'security'
  | 'hooks'
  | 'import'
  | 'services'
  | 'skills'
  | 'about';

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

/** 读取偏好时可注入的最小应用画像，避免硬依赖 DesktopApp 实现。 */
export interface PreferencesHost {
  defaultBackend?: string;
  workspaceCapabilities?: { models: { id: string }[] };
}

/**
 * 「关于」常量。版本跟踪根 Cargo.toml `[workspace.package].version`
 * （release 真源），桌面壳 tauri.conf / package.json 版本可另计。
 */
export const ABOUT_INFO = {
  productName: 'SaCode',
  desktopName: 'SaCode Desktop',
  version: '1.1.1',
  license: 'MulanPSL-2.0',
  licenseText: '木兰宽松许可证第 2 版',
  /** 源码仓库（docs/guides/getting-started.md 记载的发布仓库） */
  sourceUrl: 'https://github.com/cherishron/SaCode',
  sourceLabel: 'github.com/cherishron/SaCode',
} as const;

const STORAGE_KEY = 'sacode.desktop.preferences';

export function loadDesktopPreferences(host?: PreferencesHost): DesktopPreferences {
  const fallback: DesktopPreferences = {
    nickname: localStorage.getItem('sacode.user.nickname')?.trim() || 'SaCode 用户',
    defaultMode: 'build',
    defaultBackend: host?.defaultBackend || 'sacode',
    defaultModel: host?.workspaceCapabilities?.models[0]?.id || '',
    defaultSkill: '',
    density: 'comfortable',
    theme: 'system',
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

/** 品牌图标：深底用浅色笔画，浅底用深色笔画。 */
const LOGO_ON_DARK = '/sa-logo.png';
const LOGO_ON_LIGHT = '/sa-logo-dark.png';

function themeLogoUrl(): string {
  return document.documentElement.dataset.theme === 'dark' ? LOGO_ON_DARK : LOGO_ON_LIGHT;
}

function refreshBrandAssets() {
  const logo = themeLogoUrl();
  document.querySelectorAll<HTMLImageElement>('img.sa-logo').forEach(image => { image.src = logo; });
  const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (favicon) favicon.href = logo;
}

/** 将主题写到 html：TDesign 走 theme-mode + .dark，壳走 data-theme */
export function applyTDesignTheme(mode: 'light' | 'dark') {
  const root = document.documentElement;
  root.setAttribute('theme-mode', mode);
  root.classList.toggle('dark', mode === 'dark');
  root.dataset.theme = mode;
}

export function resolveThemeMode(preference: ThemePreference): 'light' | 'dark' {
  if (preference === 'dark' || preference === 'light') return preference;
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return 'light';
}

export function applyInterfacePreferences(preferences: DesktopPreferences) {
  const root = document.documentElement;
  root.dataset.density = preferences.density;
  // 语言：仅记录偏好并标注文档语言；完整 i18n 文案切换见设置项说明
  root.lang = preferences.locale;
  applyTDesignTheme(resolveThemeMode(preferences.theme));
  refreshBrandAssets();
  if (!systemThemeListenerRegistered && typeof window.matchMedia === 'function') {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      const saved = loadDesktopPreferences();
      if (saved.theme === 'system') applyTDesignTheme(resolveThemeMode('system'));
      refreshBrandAssets();
    });
    systemThemeListenerRegistered = true;
  }
  // 启动/保存时把托盘、自启同步到桌面壳（非 Tauri 静默跳过）
  void syncSystemIntegrations(preferences);
}

export interface SystemSyncResult {
  /** false = 壳不支持或调用失败（偏好仍已落盘，但不假装生效） */
  tray: boolean;
  autostart: boolean;
  errors: string[];
}

/**
 * 把托盘 / 开机自启偏好同步到 Tauri 壳。
 * 非 Tauri 环境返回两项 false + 说明，调用方应展示「暂不支持」而非假开关。
 */
export async function syncSystemIntegrations(
  preferences: DesktopPreferences,
): Promise<SystemSyncResult> {
  const errors: string[] = [];
  let tray = false;
  let autostart = false;
  // 动态取 invoke，避免 preferences 单测硬依赖 Tauri 全局
  const api = (globalThis as { __TAURI__?: { core?: { invoke?: Function }; invoke?: Function } }).__TAURI__;
  const invoke = api?.core?.invoke ?? api?.invoke ?? null;
  if (!invoke) {
    return {
      tray: false,
      autostart: false,
      errors: ['非桌面壳环境：系统托盘 / 开机自启暂不支持'],
    };
  }
  try {
    tray = Boolean(await invoke('set_tray_enabled', { enabled: preferences.trayEnabled }));
  } catch (e) {
    errors.push(`系统托盘：${String(e)}`);
  }
  try {
    await invoke('set_autostart', { enabled: preferences.autostart });
    autostart = true;
  } catch (e) {
    errors.push(`开机自启：${String(e)}`);
  }
  return { tray, autostart, errors };
}
