/** SaCode Desktop — 四段式布局 UI 入口
 * Phase 4: 会话过滤、审批自动切 Tab、响应式折叠、键盘快捷键
 * 对齐设计文档 docs/design/desktop-ui-design-v1.md
 */
import { el } from '../dom.ts';
import type { DesktopApp } from './service.ts';
import { buildTopBar } from './top-bar.ts';
import { buildRail } from './rail.ts';
import { buildSidebar } from './sidebar.ts';
import { buildConversation } from './conversation.ts';
import { buildContextPanel, type ContextTab } from './context-panel.ts';
import { buildStatusBar } from './status-bar.ts';
import { buildSplash, buildConnectionError } from './splash.ts';
import type { AppShellState } from './app-shell.ts';

interface UiState {
  shell: AppShellState;
  activeTab: ContextTab;
  activeTaskFilter: string | null;
}

export function mountApp(root: HTMLElement, app: DesktopApp) {
  const state: UiState = {
    shell: { sidebarOpen: true, contextOpen: true, connection: 'checking' },
    activeTab: 'changes',
    activeTaskFilter: null,
  };

  const rerender = () => render(root, app, state);

  app.onChange = () => {
    // 新审批到达时自动切到 Approvals Tab
    if (app.approvals.length > 0 && state.activeTab !== 'approvals') {
      state.activeTab = 'approvals';
    }
    rerender();
  };

  // 全局事件
  setupKeyboard(root, app, state);
  setupResponsive(root, app, state);

  rerender();

  // 启动 sidecar
  void app.init(localStorage.getItem('sacode.workspace') || undefined).then(() => {
    const healthy = app.health?.status === 'healthy';
    state.shell.connection = healthy ? 'healthy' : 'error';
    rerender();
  });
}

function render(root: HTMLElement, app: DesktopApp, state: UiState) {
  // 启动门控
  if (state.shell.connection === 'checking') {
    root.replaceChildren(buildSplash());
    return;
  }
  if (state.shell.connection === 'error') {
    root.replaceChildren(buildConnectionError(app));
    return;
  }

  // 主界面
  const className = [
    'app-shell',
    !state.shell.sidebarOpen ? 'sidebar-closed' : '',
    !state.shell.contextOpen ? 'context-closed' : '',
  ].filter(Boolean).join(' ');

  const scrollTimeline = root.querySelector('#timeline')?.scrollTop ?? 0;

  root.replaceChildren(
    el('div', { className }, [
      buildTopBar(app, state.shell),
      buildRail(app),
      buildSidebar(app, state, () => render(root, app, state)),
      buildConversation(app, state.activeTaskFilter),
      buildContextPanel(app, state.activeTab),
      buildStatusBar(app),
    ]),
  );

  // 恢复滚动位置
  const t = root.querySelector('#timeline');
  if (t) t.scrollTop = scrollTimeline;

  // 绑定 Tab 切换
  root.querySelectorAll<HTMLElement>('.context-tab').forEach((tab) => {
    const key = tab.dataset.tab as ContextTab | undefined;
    if (key) {
      tab.addEventListener('click', () => {
        state.activeTab = key;
        render(root, app, state);
      });
    }
  });

  // 绑定侧栏按钮
  bindSidebarEvents(root, app);
}

function bindSidebarEvents(root: HTMLElement, app: DesktopApp) {
  root.querySelector('#btn-init')?.addEventListener('click', () => {
    const ws = (root.querySelector('#workspace') as HTMLInputElement | null)?.value?.trim();
    if (ws) localStorage.setItem('sacode.workspace', ws);
    app.workspace = ws || app.workspace;
    void app.init(ws || undefined);
  });

  root.querySelector('#btn-stop-sidecar')?.addEventListener('click', () => {
    void app.stopSidecar();
  });

  root.querySelector('#btn-health')?.addEventListener('click', () => {
    void app.refreshHealth();
  });

  root.querySelector('#btn-agents')?.addEventListener('click', () => {
    void app.refreshAgents();
  });

  root.querySelector('#btn-diag')?.addEventListener('click', () => {
    const json = app.exportDiagnostics();
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sacode-desktop-diag-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    app.log('diagnostics exported');
  });
}

/** 键盘快捷键：Ctrl+B 侧栏、Ctrl+J 右栏、Escape 关闭面板 */
function setupKeyboard(root: HTMLElement, app: DesktopApp, state: UiState) {
  document.addEventListener('keydown', (e) => {
    if (state.shell.connection !== 'healthy') return;

    // 输入框聚焦时不拦截
    const target = e.target as HTMLElement;
    const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
    if (inInput && e.key !== 'Escape') return;

    if (e.ctrlKey && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      state.shell.sidebarOpen = !state.shell.sidebarOpen;
      render(root, app, state);
    } else if (e.ctrlKey && e.key.toLowerCase() === 'j') {
      e.preventDefault();
      state.shell.contextOpen = !state.shell.contextOpen;
      render(root, app, state);
    } else if (e.key === 'Escape') {
      if (state.activeTaskFilter) {
        state.activeTaskFilter = null;
        render(root, app, state);
      }
    }
  });
}

/** 响应式：窗口缩窄自动折叠面板（只在首次跨越断点时调整） */
function setupResponsive(root: HTMLElement, app: DesktopApp, state: UiState) {
  let lastBreakpoint = '';

  const check = () => {
    if (state.shell.connection !== 'healthy') return;
    const w = window.innerWidth;
    let bp: string;
    if (w < 700) bp = 'xs';
    else if (w < 900) bp = 'sm';
    else if (w < 1200) bp = 'md';
    else bp = 'lg';

    if (bp === lastBreakpoint) return;
    lastBreakpoint = bp;

    if (bp === 'xs') {
      state.shell.sidebarOpen = false;
      state.shell.contextOpen = false;
    } else if (bp === 'sm') {
      state.shell.contextOpen = false;
      state.shell.sidebarOpen = true;
    } else if (bp === 'md') {
      state.shell.contextOpen = false;
      state.shell.sidebarOpen = true;
    } else {
      state.shell.sidebarOpen = true;
      state.shell.contextOpen = true;
    }
    render(root, app, state);
  };

  window.addEventListener('resize', check);
  // 初始检测
  setTimeout(check, 0);
}
