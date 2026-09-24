/** SaCode Desktop — Agent 与 SaDesign 双工作区 UI 入口。 */
import { el } from '../dom.ts';
import type { DesktopApp } from './service.ts';
import { buildTopBar } from './top-bar.ts';
import { buildRail, type WorkspaceView } from './rail.ts';
import { buildSidebar } from './sidebar.ts';
import { buildConversation } from './conversation.ts';
import { buildContextPanel, type ContextTab } from './context-panel.ts';
import { buildStatusBar } from './status-bar.ts';
import { buildSplash, buildConnectionError } from './splash.ts';
import type { AppShellState } from './app-shell.ts';
import { buildSaDesignWorkspace } from './sadesign.ts';
import { buildSaDesignPrompt, createSaDesignState, type SaDesignState } from './sadesign-state.ts';

interface UiState {
  shell: AppShellState;
  activeTab: ContextTab;
  activeTaskFilter: string | null;
  activeView: WorkspaceView;
  design: SaDesignState;
}

export function mountApp(root: HTMLElement, app: DesktopApp) {
  const state: UiState = {
    shell: { sidebarOpen: true, contextOpen: true, connection: 'checking' },
    activeTab: 'changes',
    activeTaskFilter: null,
    activeView: 'agent',
    design: createSaDesignState(app.defaultBackend),
  };

  const rerender = () => render(root, app, state);

  app.onChange = () => {
    state.design.context = app.designContext;
    if (app.designResources) state.design.catalog = app.designResources;
    state.design.loading = app.designLoading;
    state.design.error = app.designError;
    state.design.extractions = app.extractions;
    state.design.sessions = app.sessions;
    state.design.currentSession = app.currentSession;
    state.design.imageResults = app.imageResults;
    state.design.imageLoading = app.imageLoading;
    if (!state.design.draft.backendId || state.design.draft.backendId === 'sacode') {
      state.design.draft.backendId = app.defaultBackend;
    }
    if (app.approvals.length > 0 && state.activeTab !== 'approvals') {
      state.activeTab = 'approvals';
    }
    rerender();
  };

  setupKeyboard(root, app, state);
  setupResponsive(root, app, state);
  rerender();

  void app.init(localStorage.getItem('sacode.workspace') || undefined).then(() => {
    const healthy = app.health?.status === 'healthy';
    state.shell.connection = healthy ? 'healthy' : 'error';
    syncDesignState(app, state.design);
    rerender();
  });
}

function render(root: HTMLElement, app: DesktopApp, state: UiState) {
  if (state.shell.connection === 'checking') {
    root.replaceChildren(buildSplash());
    return;
  }
  if (state.shell.connection === 'error') {
    root.replaceChildren(buildConnectionError(app));
    return;
  }

  syncDesignState(app, state.design);
  const className = [
    'app-shell',
    state.activeView === 'design' ? 'design-view' : '',
    !state.shell.sidebarOpen ? 'sidebar-closed' : '',
    !state.shell.contextOpen ? 'context-closed' : '',
  ].filter(Boolean).join(' ');
  const scrollTimeline = root.querySelector('#timeline')?.scrollTop ?? 0;
  const mainContent = state.activeView === 'design'
    ? [buildSaDesignWorkspace(app, state.design, {
        rerender: () => render(root, app, state),
        onRun: () => runSaDesignTask(app, state, root),
      })]
    : [
        buildSidebar(app, state, () => render(root, app, state)),
        buildConversation(app, state.activeTaskFilter),
        buildContextPanel(app, state.activeTab),
      ];

  root.replaceChildren(
    el('div', { className }, [
      buildTopBar(app, state.shell, state.activeView),
      buildRail(app, state.activeView, (view) => {
        state.activeView = view;
        render(root, app, state);
      }),
      ...mainContent,
      buildStatusBar(app, state.activeView),
    ]),
  );

  const timeline = root.querySelector('#timeline');
  if (timeline) timeline.scrollTop = scrollTimeline;

  if (state.activeView === 'agent') {
    root.querySelectorAll<HTMLElement>('.context-tab').forEach((tab) => {
      const key = tab.dataset.tab as ContextTab | undefined;
      if (key) {
        tab.addEventListener('click', () => {
          state.activeTab = key;
          render(root, app, state);
        });
      }
    });
    bindSidebarEvents(root, app);
  }
}

function syncDesignState(app: DesktopApp, state: SaDesignState) {
  state.context = app.designContext;
  if (app.designResources) state.catalog = app.designResources;
  state.loading = app.designLoading;
  state.error = app.designError;
  state.extractions = app.extractions;
  state.sessions = app.sessions;
  state.currentSession = app.currentSession;
  state.imageResults = app.imageResults;
  state.imageLoading = app.imageLoading;
}

function runSaDesignTask(app: DesktopApp, state: UiState, root: HTMLElement) {
  const prompt = buildSaDesignPrompt(state.design);
  const { mode, backendId } = state.design.draft;
  void app.runTask({ prompt, mode, backendId }).then((created) => {
    if (!created || !app.currentTaskId) {
      state.activeView = 'design';
      render(root, app, state);
      return;
    }
    state.design.lastTaskId = app.currentTaskId;
    state.activeView = 'agent';
    state.activeTaskFilter = app.currentTaskId;
    render(root, app, state);
  });
}

function bindSidebarEvents(root: HTMLElement, app: DesktopApp) {
  root.querySelector('#btn-init')?.addEventListener('click', () => {
    const ws = (root.querySelector('#workspace') as HTMLInputElement | null)?.value?.trim();
    if (ws) localStorage.setItem('sacode.workspace', ws);
    app.workspace = ws || app.workspace;
    void app.init(ws || undefined);
  });
  root.querySelector('#btn-stop-sidecar')?.addEventListener('click', () => void app.stopSidecar());
  root.querySelector('#btn-health')?.addEventListener('click', () => void app.refreshHealth());
  root.querySelector('#btn-agents')?.addEventListener('click', () => void app.refreshAgents());
  root.querySelector('#btn-diag')?.addEventListener('click', () => {
    const json = app.exportDiagnostics();
    const blob = new Blob([json], { type: 'application/json' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `sacode-desktop-diag-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
    app.log('diagnostics exported');
  });
}

function setupKeyboard(root: HTMLElement, app: DesktopApp, state: UiState) {
  document.addEventListener('keydown', (event) => {
    if (state.shell.connection !== 'healthy') return;
    const target = event.target as HTMLElement;
    const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
    if (inInput && event.key !== 'Escape') return;

    if (state.activeView === 'agent' && event.ctrlKey && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      state.shell.sidebarOpen = !state.shell.sidebarOpen;
      render(root, app, state);
    } else if (state.activeView === 'agent' && event.ctrlKey && event.key.toLowerCase() === 'j') {
      event.preventDefault();
      state.shell.contextOpen = !state.shell.contextOpen;
      render(root, app, state);
    } else if (event.key === 'Escape' && state.activeTaskFilter) {
      state.activeTaskFilter = null;
      render(root, app, state);
    }
  });
}

function setupResponsive(root: HTMLElement, app: DesktopApp, state: UiState) {
  let lastBreakpoint = '';
  const check = () => {
    if (state.shell.connection !== 'healthy' || state.activeView === 'design') return;
    const width = window.innerWidth;
    const breakpoint = width < 700 ? 'xs' : width < 900 ? 'sm' : width < 1200 ? 'md' : 'lg';
    if (breakpoint === lastBreakpoint) return;
    lastBreakpoint = breakpoint;
    if (breakpoint === 'xs') {
      state.shell.sidebarOpen = false;
      state.shell.contextOpen = false;
    } else if (breakpoint === 'sm' || breakpoint === 'md') {
      state.shell.sidebarOpen = true;
      state.shell.contextOpen = false;
    } else {
      state.shell.sidebarOpen = true;
      state.shell.contextOpen = true;
    }
    render(root, app, state);
  };
  window.addEventListener('resize', check);
  setTimeout(check, 0);
}
