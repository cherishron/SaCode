import { el } from '../dom.ts';
import type { DesktopApp } from './service.ts';
import { brandLogo } from '../brand.ts';
import {
  closeTerminal, isNativeTerminalAvailable, listenTerminalExit, listenTerminalOutput,
  resizeTerminal, setAutostart, setTrayEnabled, startTerminal, writeTerminal,
} from '../tauri-bridge.ts';
import { buildConnectionError } from './splash.ts';
import { buildConfirmDialog, buildSidebar, createSidebarState, type SidebarState, type WorkspaceView } from './sidebar.ts';
import type { ExecutionModeInput } from '@cherishron/sacode-client-core';
import { buildConversationHeader, buildMoreMenu, defaultMoreMenuItems, type MoreMenuItem, type ConversationMode } from './top-bar.ts';
import { buildConversation } from './conversation.ts';
import { buildContextPanel, type ContextTab } from './context-panel.ts';
import { buildStatusBar } from './status-bar.ts';
import { buildSaDesignWorkspace, buildSaDesignPrompt } from './sadesign.ts';
import { createSaDesignState, undoUiCommand, redoUiCommand, applyUiCommand, type SaDesignState } from './sadesign-state.ts';
import { findUiNode, findUiNodeLocation } from './ui-document-editor.ts';
import { createSaNativeState, buildSaNativeWorkspace, refreshSaNative, type SaNativeState } from './sanative.ts';
import { createAutomationState, buildAutomationWorkspace, loadAutomationData, type AutomationState } from './automation.ts';
import { createInputAreaState, type InputAreaState } from '../components/input-area.ts';
import { AT_BOTTOM_THRESHOLD, JUMP_VISIBLE_THRESHOLD } from '../components/timeline-rail.ts';
import { closePane, closeSessionView, openTaskInActivePane, showNewTaskPage } from './new-task-page.ts';
import { layoutPanes, resizeSplit, restoreWorkbenchLayout, splitPane, swapPanePositions, type SplitLayout } from './split-layout.ts';
import { setSessionArchived } from './session-visibility.ts';
import { terminalDimensions } from './terminal-input.ts';
import {
  buildNewTaskDialog,
  createNewTaskDialogState,
  openNewTaskDialog,
  type NewTaskDialogState,
} from './new-task-dialog.ts';
import {
  applyInterfacePreferences,
  buildSettingsCenter,
  createSettingsState,
  loadDesktopPreferences,
  openSettings,
  saveDesktopPreferences,
  type SettingsState,
} from './settings.ts';

export interface PaneState {
  taskId: string | null;
  inputArea: InputAreaState;
  conversationMode: ConversationMode;
  activeTab: ContextTab;
  contextOpen: boolean;
  panelSize: 'sm' | 'md' | 'lg';
  /** 浮层工具栏位置（相对 pane） */
  panelPos: { x: number; y: number };
}

export interface UiState {
  shell: { sidebarOpen: boolean; contextOpen: boolean; connection: 'starting' | 'healthy' | 'error' };
  activeTab: ContextTab;
  activeTaskFilter: string | null;
  activeView: WorkspaceView;
  sidebar: SidebarState;
  design: SaDesignState;
  native: SaNativeState;
  automation: AutomationState;
  inputArea: InputAreaState;
  newTaskDialog: NewTaskDialogState;
  settings: SettingsState;
  moreMenuOpen: boolean;
  moreMenuPosition: { x: number; y: number };
  moreMenuItems: MoreMenuItem[];
  sessionDialog: null | { kind: 'open' | 'rename'; paneIndex: number };
  conversationMode: ConversationMode;
  /** 分屏面板：独立会话 + 独立工具栏，最多 4 */
  panes: PaneState[];
  activePane: number;
  layout: SplitLayout;
  maximizedPane: number | null;
  /** 弹窗：知识库 / 自动化 / 个人信息 */
  modal: null | 'knowledge' | 'automation' | 'profile';
  /** 当前面板的多终端 */
  terminals: TerminalSession[];
  activeTerminalId: string | null;
  terminalNotice: string | null;
  createTerminal?: () => Promise<void>;
}

export interface TerminalSession {
  id: string;
  name: string;
  lines: { text: string; tone: 'out' | 'ok' | 'err' | 'muted' }[];
  cwd: string;
  shell: string;
  exited?: boolean;
}

function readRecentProjects(): string[] {
  try {
    return JSON.parse(localStorage.getItem('sacode.recentProjects') || '[]') as string[];
  } catch {
    return [];
  }
}

function buildProfileModal(
  app: DesktopApp,
  onClose: () => void,
  onOpenSettings: () => void,
): HTMLElement {
  const prefs = loadDesktopPreferences(app);
  const nickname = prefs.nickname || 'SaCode 用户';
  const initial = nickname.slice(0, 1).toUpperCase();
  const status = app.health?.status === 'healthy' ? '在线' : app.health?.status === 'degraded' ? '异常' : '连接中';
  const statusClass = app.health?.status === 'healthy' ? 'ok' : app.health?.status === 'degraded' ? 'bad' : 'warn';

  return el('div', { className: 'profile-card' }, [
    el('div', { className: 'profile-hero' }, [
      brandLogo({ className: 'profile-avatar-img rounded', size: 64 }),
      el('div', { className: 'profile-identity' }, [
        el('div', { className: 'profile-name' }, [nickname]),
        el('div', { className: 'profile-meta muted' }, [
          el('span', { className: `badge ${statusClass}` }, [status]),
          el('span', {}, [app.workspace || '未选择项目']),
        ]),
      ]),
    ]),
    el('div', { className: 'profile-rows' }, [
      profileRow('默认模式', prefs.defaultMode === 'plan' ? '规划' : prefs.defaultMode === 'yolo' ? 'YOLO' : '构建'),
      profileRow('默认 Backend', prefs.defaultBackend || 'sacode'),
      profileRow('默认模型', prefs.defaultModel || '未配置'),
      profileRow('主题', prefs.theme === 'light' ? '浅色' : prefs.theme === 'system' ? '跟随系统' : '深色'),
      profileRow('终端', prefs.defaultTerminal || '系统默认'),
      profileRow('会话数', String(app.desktopConversations.length)),
    ]),
    el('div', { className: 'profile-actions' }, [
      el('button', {
        className: 'btn ghost',
        onclick: () => {
          const next = window.prompt('修改昵称', nickname);
          if (next?.trim()) {
            localStorage.setItem('sacode.user.nickname', next.trim());
            const saved = loadDesktopPreferences(app);
            saved.nickname = next.trim();
            saveDesktopPreferences(saved);
          }
          onClose();
        },
      }, ['编辑昵称']),
      el('button', {
        className: 'btn',
        onclick: onOpenSettings,
      }, ['打开设置']),
    ]),
  ]);
}

function profileRow(label: string, value: string) {
  return el('div', { className: 'profile-row' }, [
    el('span', { className: 'profile-label' }, [label]),
    el('span', { className: 'profile-value' }, [value]),
  ]);
}

function appendTerminalOutput(terminal: TerminalSession, chunk: string) {
  // The panel is a readable transcript, not a full VT emulator. Strip styling
  // sequences while retaining line boundaries and commands from the PTY.
  const plain = chunk.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\r(?!\n)/g, '\n').replace(/\r\n/g, '\n');
  const parts = plain.split('\n');
  if (!terminal.lines.length) terminal.lines.push({ text: '', tone: 'out' });
  terminal.lines[terminal.lines.length - 1]!.text += parts[0] || '';
  for (const part of parts.slice(1)) terminal.lines.push({ text: part, tone: 'out' });
  if (terminal.lines.length > 2000) terminal.lines.splice(0, terminal.lines.length - 2000);
}

function createPaneState(prefs: ReturnType<typeof loadDesktopPreferences>): PaneState {
  return {
    taskId: null,
    inputArea: {
      ...createInputAreaState(),
      executionMode: prefs.defaultMode,
      model: prefs.defaultModel,
      skill: prefs.defaultSkill,
    },
    conversationMode: prefs.defaultMode,
    activeTab: 'changes',
    contextOpen: true,
    panelSize: 'md',
    panelPos: { x: -1, y: 12 },
  };
}

function validModelId(app: DesktopApp, preferred: string): string {
  return app.workspaceCapabilities.models.some((model) => model.id === preferred)
    ? preferred
    : app.workspaceCapabilities.models[0]?.id || '';
}

function finishClosingView(root: HTMLElement, app: DesktopApp, state: UiState, nextId: string | null) {
  if (nextId && app.currentConversationId !== nextId) {
    void app.selectDesktopConversation(nextId)
      .then(() => render(root, app, state))
      .catch((error) => app.error(`打开会话失败: ${error}`));
  }
  render(root, app, state);
}

function buildPaneMoreMenu(
  state: UiState,
  app: DesktopApp,
  index: number,
  rerender: () => void,
): MoreMenuItem[] {
  const pane = state.panes[index];
  return [
    {
      label: '在此分屏新建任务',
      onclick: () => {
        pane.taskId = null;
        state.activePane = index;
        openNewTaskDialog(state.newTaskDialog, app);
        state.moreMenuOpen = false;
        rerender();
      },
    },
    {
      label: '打开其他会话…',
      onclick: () => {
        state.sessionDialog = { kind: 'open', paneIndex: index };
        state.moreMenuOpen = false;
        rerender();
      },
    },
    {
      label: '重命名会话',
      onclick: () => {
        if (pane.taskId) state.sessionDialog = { kind: 'rename', paneIndex: index };
        state.moreMenuOpen = false;
        rerender();
      },
    },
    {
      label: '向右分屏',
      onclick: () => {
        if (state.panes.length >= 4) return;
        const next = state.panes.length;
        state.panes.push(createPaneState(loadDesktopPreferences(app)));
        state.layout = splitPane(state.layout, index, next, 'column');
        state.activePane = next;
        state.maximizedPane = null;
        state.moreMenuOpen = false;
        rerender();
      },
    },
    {
      label: '向下分屏',
      onclick: () => {
        if (state.panes.length >= 4) return;
        const next = state.panes.length;
        state.panes.push(createPaneState(loadDesktopPreferences(app)));
        state.layout = splitPane(state.layout, index, next, 'row');
        state.activePane = next;
        state.maximizedPane = null;
        state.moreMenuOpen = false;
        rerender();
      },
    },
    {
      label: '与下一分屏交换位置',
      onclick: () => {
        const order = layoutPanes(state.layout);
        if (order.length < 2) return;
        const position = order.indexOf(index);
        const next = order[(position + 1) % order.length]!;
        state.layout = swapPanePositions(state.layout, index, next);
        state.moreMenuOpen = false;
        rerender();
      },
    },
    {
      label: state.maximizedPane === index ? '还原分屏' : '放大此分屏',
      onclick: () => {
        state.maximizedPane = state.maximizedPane === index ? null : index;
        state.moreMenuOpen = false;
        rerender();
      },
    },
    { separator: true },
    {
      label: '打开右侧工具栏',
      onclick: () => {
        pane.contextOpen = true;
        state.moreMenuOpen = false;
        rerender();
      },
    },
    {
      label: '关闭右侧工具栏',
      onclick: () => {
        pane.contextOpen = false;
        state.moreMenuOpen = false;
        rerender();
      },
    },
    { separator: true },
    {
      label: '关闭此分屏',
      onclick: () => {
        const nextId = closePane(state, app, index);
        state.moreMenuOpen = false;
        if (nextId && app.currentConversationId !== nextId) {
          void app.selectDesktopConversation(nextId).then(rerender).catch((error) => app.error(`打开会话失败: ${error}`));
        }
        rerender();
      },
    },
    {
      label: '删除会话',
      danger: true,
      onclick: () => {
        const conversationId = pane.taskId;
        state.moreMenuOpen = false;
        if (conversationId) state.sidebar.confirmDialog = {
          title: '删除会话',
          message: '删除该会话？此操作不可撤销。',
          confirmLabel: '删除',
          danger: true,
          onConfirm: () => {
            void app.deleteDesktopConversation(conversationId).then(() => {
              for (const item of state.panes) if (item.taskId === conversationId) item.taskId = null;
              if (state.sidebar.activeSessionId === conversationId) state.sidebar.activeSessionId = null;
              rerender();
            }).catch((e) => app.error(`删除会话失败: ${e}`));
          },
        };
        rerender();
      },
    },
  ];
}

function buildSessionDialog(app: DesktopApp, state: UiState, rerender: () => void): HTMLElement {
  const dialog = state.sessionDialog!;
  const pane = state.panes[dialog.paneIndex];
  const close = () => { state.sessionDialog = null; rerender(); };
  const overlay = el('div', {
    className: 'session-dialog-overlay',
    onclick: (event: Event) => { if (event.target === overlay) close(); },
  });
  const panel = el('div', { className: 'session-dialog', role: 'dialog', 'aria-label': dialog.kind === 'open' ? '打开会话' : '重命名会话' });
  panel.append(el('div', { className: 'session-dialog-header' }, [
    el('strong', {}, [dialog.kind === 'open' ? '在此分屏打开会话' : '重命名会话']),
    el('button', { className: 'session-dialog-close', title: '关闭', onclick: close }, ['×']),
  ]));
  if (dialog.kind === 'rename') {
    const id = pane?.taskId;
    const current = id ? localStorage.getItem(`sacode.session.title.${id}`)
      || app.desktopConversations.find((item) => item.id === id)?.title || '' : '';
    const input = el('input', { className: 'session-dialog-input', value: current, placeholder: '会话标题' });
    const save = () => {
      const title = input.value.trim();
      if (id && title) localStorage.setItem(`sacode.session.title.${id}`, title);
      close();
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') save();
      if (event.key === 'Escape') close();
    });
    panel.append(input, el('div', { className: 'session-dialog-actions' }, [
      el('button', { className: 'btn ghost', onclick: close }, ['取消']),
      el('button', { className: 'btn primary', onclick: save }, ['保存']),
    ]));
    queueMicrotask(() => { input.focus(); input.select(); });
  } else {
    const input = el('input', { className: 'session-dialog-input', placeholder: '搜索标题或会话 ID…' });
    const list = el('div', { className: 'session-dialog-list' });
    const update = () => {
      const query = input.value.trim().toLocaleLowerCase();
      const matches = app.desktopConversations.filter((item) =>
        !query || item.title.toLocaleLowerCase().includes(query) || item.id.toLocaleLowerCase().includes(query));
      list.replaceChildren(...(matches.length ? matches.map((item) =>
        el('button', {
          className: 'session-dialog-item',
          onclick: () => {
            pane.taskId = item.id;
            state.activePane = dialog.paneIndex;
            state.sidebar.activeSessionId = item.id;
            state.activeTaskFilter = item.id;
            state.sessionDialog = null;
            rerender();
            void app.selectDesktopConversation(item.id).then(rerender).catch((error) => app.error(`打开会话失败: ${error}`));
          },
        }, [
          el('span', { className: 'session-dialog-item-title' }, [localStorage.getItem(`sacode.session.title.${item.id}`) || item.title]),
          el('span', { className: 'session-dialog-item-id mono' }, [item.id.slice(0, 10)]),
        ])) : [el('div', { className: 'session-dialog-empty' }, ['没有匹配的会话'])]));
    };
    input.addEventListener('input', update);
    input.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
    update();
    panel.append(input, list);
    queueMicrotask(() => input.focus());
  }
  overlay.append(panel);
  return overlay;
}

function validSkillName(app: DesktopApp, preferred: string): string {
  return app.workspaceCapabilities.skills.some((skill) => skill.name === preferred) ? preferred : '';
}

function syncDesign(app: DesktopApp, state: SaDesignState) {
  state.context = app.designContext;
  if (app.designResources) state.catalog = app.designResources;
  state.loading = app.designLoading;
  state.error = app.designError;
  state.extractions = app.extractions;
  state.sessions = app.sessions;
  if (state.previewMode === 'session') state.currentSession = app.currentSession;
  state.imageResults = app.imageResults;
  state.imageLoading = app.imageLoading;
}

export function mountApp(root: HTMLElement, app: DesktopApp) {
  const preferences = loadDesktopPreferences(app);
  applyInterfacePreferences(preferences);
  const state: UiState = {
    shell: { sidebarOpen: preferences.sidebarOpen, contextOpen: preferences.contextOpen, connection: 'starting' },
    activeTab: 'changes',
    activeTaskFilter: null,
    activeView: 'agent',
    sidebar: createSidebarState(),
    design: createSaDesignState(app.defaultBackend),
    native: createSaNativeState(),
    automation: createAutomationState(),
    inputArea: {
      ...createInputAreaState(),
      executionMode: preferences.defaultMode,
      model: preferences.defaultModel,
      skill: preferences.defaultSkill,
    },
    newTaskDialog: {
      ...createNewTaskDialogState(),
      model: preferences.defaultModel,
      skill: preferences.defaultSkill,
    },
    settings: createSettingsState(app),
    moreMenuOpen: false,
    moreMenuPosition: { x: 0, y: 0 },
    moreMenuItems: defaultMoreMenuItems(),
    sessionDialog: null,
    conversationMode: preferences.defaultMode,
    /** 深色多面板工作台：默认双分屏 + 右栏 */
    panes: [createPaneState(preferences), createPaneState(preferences)],
    activePane: 0,
    layout: { axis: 'column', ratio: 0.5, first: { pane: 0 }, second: { pane: 1 } },
    maximizedPane: null,
    modal: null,
    terminals: [],
    activeTerminalId: null,
    terminalNotice: null,
  };

  const rerender = () => render(root, app, state);
  const pendingTerminalOutput = new Map<string, string>();
  let terminalRenderQueued = false;
  const scheduleTerminalRender = () => {
    if (terminalRenderQueued) return;
    terminalRenderQueued = true;
    requestAnimationFrame(() => {
      terminalRenderQueued = false;
      rerender();
    });
  };
  const terminalListenersReady = Promise.all([
    listenTerminalOutput(({ terminal_id, data }) => {
      const term = state.terminals.find((item) => item.id === terminal_id);
      if (term) {
        appendTerminalOutput(term, data);
        scheduleTerminalRender();
      } else {
        pendingTerminalOutput.set(terminal_id, (pendingTerminalOutput.get(terminal_id) || '') + data);
      }
    }),
    listenTerminalExit(({ terminal_id, code, reason }) => {
      const term = state.terminals.find((item) => item.id === terminal_id);
      if (!term) return;
      term.exited = true;
      term.lines.push({ text: `终端已结束${code === null ? '' : ` · exit ${code}`} (${reason})`, tone: 'muted' });
      scheduleTerminalRender();
    }),
  ]);
  state.createTerminal = async () => {
    if (!isNativeTerminalAvailable()) {
      state.terminalNotice = '终端仅在 SaCode Desktop 客户端中可用';
      rerender();
      return;
    }
    try {
      await terminalListenersReady;
      const info = await startTerminal();
      if (!info) throw new Error('无法启动原生终端');
      const term: TerminalSession = {
        id: info.terminal_id,
        name: `终端 ${state.terminals.length + 1}`,
        lines: [],
        cwd: info.workspace,
        shell: info.shell,
      };
      const buffered = pendingTerminalOutput.get(info.terminal_id);
      if (buffered) appendTerminalOutput(term, buffered);
      pendingTerminalOutput.delete(info.terminal_id);
      state.terminals.push(term);
      state.activeTerminalId = term.id;
      state.terminalNotice = null;
      rerender();
    } catch (error) {
      state.terminalNotice = `终端启动失败：${String(error)}`;
      rerender();
    }
  };
  let terminalWorkspace = app.workspace;

  app.onChange = () => {
    if (terminalWorkspace !== app.workspace) {
      terminalWorkspace = app.workspace;
      state.terminals = [];
      state.activeTerminalId = null;
      state.terminalNotice = null;
      pendingTerminalOutput.clear();
    }
    if (state.shell.connection === 'starting' && app.mode === 'tauri' && app.handle) {
      state.shell.connection = 'healthy';
    }
    if (state.shell.connection === 'starting' && app.health?.status === 'degraded') {
      state.shell.connection = 'error';
    }
    syncDesign(app, state.design);
    if (!state.design.draft.backendId || state.design.draft.backendId === 'sacode') {
      state.design.draft.backendId = app.defaultBackend;
    }
    if (app.approvals.length > 0) {
      state.activeTab = 'changes';
      if (!state.shell.contextOpen) state.shell.contextOpen = true;
    }
    const savedPreferences = loadDesktopPreferences(app);
    if (app.agents.length === 0 || app.agents.some((agent) => agent.id === savedPreferences.defaultBackend)) {
      app.defaultBackend = savedPreferences.defaultBackend;
    }
    if (!state.inputArea.model || !app.workspaceCapabilities.models.some((model) => model.id === state.inputArea.model)) {
      state.inputArea.model = validModelId(app, savedPreferences.defaultModel);
    }
    if (!state.inputArea.skill && savedPreferences.defaultSkill) {
      state.inputArea.skill = validSkillName(app, savedPreferences.defaultSkill);
    }
    if (!state.newTaskDialog.open) {
      state.newTaskDialog.model = validModelId(app, savedPreferences.defaultModel);
      state.newTaskDialog.skill = validSkillName(app, savedPreferences.defaultSkill);
    }
    rerender();
  };

  setupKeyboard(root, app, state);
  setupResponsive(root, app, state);
  rerender();

  void app.init(preferences.restoreLastProject ? localStorage.getItem('sacode.workspace') || undefined : undefined)
    .then(() => {
      if (state.shell.connection === 'starting') {
        if (app.health?.status === 'healthy') state.shell.connection = 'healthy';
        else if (app.health?.status === 'degraded') state.shell.connection = 'error';
      }
      syncDesign(app, state.design);
      rerender();
    })
    .catch((error) => {
      app.error(`初始化失败: ${String(error)}`);
      state.shell.connection = 'error';
      rerender();
    });

  setTimeout(() => {
    if (state.shell.connection === 'starting') {
      app.error('daemon 启动超时 (30秒)');
      state.shell.connection = 'error';
      rerender();
    }
  }, 30000);
}

const terminalObservers = new WeakMap<HTMLElement, ResizeObserver>();
const terminalSizes = new Map<string, string>();
const renderedWorkspaces = new WeakMap<HTMLElement, string>();
const savedLayouts = new WeakMap<HTMLElement, string>();

function syncWorkbenchWorkspace(root: HTMLElement, app: DesktopApp, state: UiState) {
  if (renderedWorkspaces.get(root) === app.workspace) return;
  renderedWorkspaces.set(root, app.workspace);
  const prefs = loadDesktopPreferences(app);
  let saved = null;
  try {
    if (app.workspace) saved = restoreWorkbenchLayout(localStorage.getItem(`sacode.desktop.layout.v1.${encodeURIComponent(app.workspace)}`));
  } catch { /* Storage can be unavailable. */ }
  state.panes = (saved?.taskIds ?? [null, null]).map((taskId) => ({ ...createPaneState(prefs), taskId }));
  state.layout = saved?.layout ?? { axis: 'column', ratio: 0.5, first: { pane: 0 }, second: { pane: 1 } };
  state.activePane = saved?.activePane ?? 0;
  state.maximizedPane = null;
  const activeId = state.panes[state.activePane]?.taskId ?? null;
  state.sidebar.activeSessionId = activeId;
  state.activeTaskFilter = activeId;
  if (activeId && app.client) {
    void app.selectDesktopConversation(activeId).catch((error) => app.error(`恢复会话失败: ${error}`));
  }
}

function saveWorkbenchLayout(root: HTMLElement, app: DesktopApp, state: UiState) {
  if (!app.workspace) return;
  const raw = JSON.stringify({ layout: state.layout, taskIds: state.panes.map((pane) => pane.taskId), activePane: state.activePane });
  const cacheKey = `${app.workspace}\0${raw}`;
  if (savedLayouts.get(root) === cacheKey) return;
  try {
    localStorage.setItem(`sacode.desktop.layout.v1.${encodeURIComponent(app.workspace)}`, raw);
    savedLayouts.set(root, cacheKey);
  } catch { /* Keep the active layout when storage is unavailable. */ }
}

function syncTerminalSize(root: HTMLElement) {
  terminalObservers.get(root)?.disconnect();
  const history = root.querySelector<HTMLElement>('.terminal-history[data-terminal-id]');
  if (!history || typeof ResizeObserver === 'undefined') return;
  const measure = () => {
    if (!history.isConnected) return;
    const terminalId = history.dataset.terminalId;
    if (!terminalId || !history.clientWidth || !history.clientHeight) return;
    const style = getComputedStyle(history);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return;
    context.font = style.font;
    const charWidth = context.measureText('M').width || 8;
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4 || 16;
    const { rows, cols } = terminalDimensions(history.clientWidth, history.clientHeight, charWidth, lineHeight);
    const size = `${rows}:${cols}`;
    if (terminalSizes.get(terminalId) === size) return;
    terminalSizes.set(terminalId, size);
    void resizeTerminal(terminalId, rows, cols).catch(() => terminalSizes.delete(terminalId));
  };
  const observer = new ResizeObserver(measure);
  terminalObservers.set(root, observer);
  observer.observe(history);
  measure();
}

function render(root: HTMLElement, app: DesktopApp, state: UiState) {
  syncWorkbenchWorkspace(root, app, state);
  if (state.shell.connection === 'error' && !app.handle) {
    root.replaceChildren(buildConnectionError(app));
    return;
  }

  // 清理更多菜单
  root.querySelectorAll('.more-menu-overlay, .more-menu').forEach((el) => el.remove());

  syncDesign(app, state.design);
  const className = [
    'app-shell',
    state.activeView === 'design' ? 'design-view' : state.activeView === 'native' ? 'native-view' : state.activeView === 'automation' ? 'automation-view' : '',
    !state.shell.sidebarOpen ? 'sidebar-closed' : '',
    state.shell.contextOpen ? 'context-open' : '',
    `splits-${Math.min(4, Math.max(1, state.panes.length))}`,
  ].filter(Boolean).join(' ');
  const scrollStates = new Map<string, { conversation: string; top: number; atBottom: boolean }>();
  const oldTerminalHistory = root.querySelector<HTMLElement>('.terminal-history');
  const terminalScroll = oldTerminalHistory ? {
    top: oldTerminalHistory.scrollTop,
    atBottom: oldTerminalHistory.scrollHeight - oldTerminalHistory.scrollTop - oldTerminalHistory.clientHeight < 40,
  } : null;
  // SSE and polling rebuild the shell frequently. Keep an in-progress edit in
  // the same pane focused, including its caret, across those redraws.
  const focused = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
  const focusSelector = focused?.matches('.input-prompt') ? '.input-prompt'
    : focused?.matches('.sidebar-search-input') ? '.sidebar-search-input'
    : focused?.matches('.terminal-input') ? '.terminal-input'
    : focused?.matches('.terminal-history[data-terminal-id]') ? '.terminal-history[data-terminal-id]'
    : null;
  const focusedPane = focused?.closest('.pane');
  const focusPaneIndex = focusedPane ? Number((focusedPane as HTMLElement).dataset.paneIndex) : -1;
  const focusConversation = focusedPane?.querySelector<HTMLElement>('.timeline')?.dataset.conversation ?? null;
  const focusStart = focusSelector === '.terminal-history[data-terminal-id]' ? null : focused?.selectionStart ?? null;
  const focusEnd = focusSelector === '.terminal-history[data-terminal-id]' ? null : focused?.selectionEnd ?? null;
  const terminalDraft = focusSelector === '.terminal-input' ? (focused?.value ?? '') : null;
  root.querySelectorAll<HTMLElement>('.timeline[data-pane]').forEach((timeline) => {
    const distance = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight;
    scrollStates.set(timeline.dataset.pane!, {
      conversation: timeline.dataset.conversation ?? '',
      top: timeline.scrollTop,
      atBottom: distance < AT_BOTTOM_THRESHOLD,
    });
  });
  if (state.activeView === 'agent') {
    const visibleConversationIds = new Set(state.panes.map((pane) => pane.taskId).filter((id): id is string => !!id));
    for (const id of visibleConversationIds) {
      if (!app.conversationDetails.has(id) && app.conversationTurns?.id !== id) {
        void app.loadDesktopConversationDetail(id).catch((error) => app.error(`打开会话失败: ${error}`));
      }
    }
  }

  const changeView = (view: WorkspaceView) => {
    state.activeView = view;
    if (view === 'agent' && state.sidebar.activeSessionId && state.panes[state.activePane].taskId !== state.sidebar.activeSessionId) {
      const conversationId = state.sidebar.activeSessionId;
      state.panes[state.activePane].taskId = conversationId;
      state.activeTaskFilter = conversationId;
      void app.selectDesktopConversation(conversationId).catch((e) => app.error(`打开会话失败: ${e}`));
    }
    if (view === 'design') void app.refreshDesignData();
    if (view === 'native') {
      void refreshSaNative(app, state.native, () => render(root, app, state));
    }
    if (view === 'automation') {
      void loadAutomationData(app, state.automation, () => render(root, app, state));
    }
    render(root, app, state);
  };

  state.sidebar.visibleSessionIds = new Set(state.activeView === 'agent'
    ? state.panes.map((pane) => pane.taskId).filter((id): id is string => !!id)
    : []);
  const sidebar = buildSidebar(
    app,
    state.sidebar,
    state.activeView,
    !state.shell.sidebarOpen,
    {
      onViewChange: changeView,
      onNewSession: (workspace?: string) => {
        const target = workspace || app.workspace;
        if (target && target !== app.workspace) {
          void app.changeWorkspace(target).then(() => app.refreshWorkspaceCapabilities()).then(() => {
            openNewTaskDialog(state.newTaskDialog, app);
            state.newTaskDialog.workspace = target;
            render(root, app, state);
            requestAnimationFrame(() => {
              const prompt = root.querySelector('#new-task-prompt') as HTMLTextAreaElement | null;
              prompt?.focus();
            });
          });
          return;
        }
        openNewTaskDialog(state.newTaskDialog, app);
        if (target) state.newTaskDialog.workspace = target;
        render(root, app, state);
        requestAnimationFrame(() => {
          const prompt = root.querySelector('#new-task-prompt') as HTMLTextAreaElement | null;
          prompt?.focus();
        });
      },
      onToggleCollapsed: () => {
        state.shell.sidebarOpen = !state.shell.sidebarOpen;
        render(root, app, state);
      },
      onOpenSettings: () => {
        openSettings(state.settings, app);
        render(root, app, state);
      },
      onOpenProfile: () => {
        state.modal = 'profile';
        render(root, app, state);
      },
      onOpenModal: (modal: 'knowledge' | 'automation') => {
        state.modal = modal;
        if (modal === 'knowledge') {
          void refreshSaNative(app, state.native, () => render(root, app, state));
        }
        if (modal === 'automation') {
          void loadAutomationData(app, state.automation, () => render(root, app, state));
        }
        render(root, app, state);
      },
      onRemoveProject: (path: string) => {
        const recent = readRecentProjects().filter((item) => item !== path);
        localStorage.setItem('sacode.recentProjects', JSON.stringify(recent));
        if (app.workspace === path && recent[0]) {
          void app.changeWorkspace(recent[0]).then(() => render(root, app, state));
        } else {
          render(root, app, state);
        }
      },
      onRenameProject: (path: string, name: string) => {
        localStorage.setItem(`sacode.project.name.${path}`, name);
        render(root, app, state);
      },
      onSelectSession: (sessionId: string) => {
        state.panes[state.activePane].taskId = sessionId;
        state.sidebar.activeSessionId = sessionId;
        state.activeTaskFilter = sessionId;
        void app.selectDesktopConversation(sessionId).then(() => render(root, app, state)).catch((e) => app.error(`打开会话失败: ${e}`));
      },
      onRenameSession: (sessionId: string) => {
        const paneIndex = state.panes.findIndex((pane) => pane.taskId === sessionId);
        const target = paneIndex < 0 ? state.activePane : paneIndex;
        state.panes[target].taskId = sessionId;
        state.activePane = target;
        state.sidebar.activeSessionId = sessionId;
        state.sessionDialog = { kind: 'rename', paneIndex: target };
        render(root, app, state);
      },
      onArchiveSession: (sessionId: string, archived: boolean) => {
        setSessionArchived(localStorage, app.workspace || '', sessionId, archived);
        state.sidebar.unreadSessions.delete(sessionId);
        render(root, app, state);
      },
      canCloseSession: (sessionId: string) => state.panes.some((pane) => pane.taskId === sessionId),
      onCloseSession: (sessionId: string) => {
        finishClosingView(root, app, state, closeSessionView(state, app, sessionId));
      },
      onRemoveSession: (sessionId: string) => {
        void (async () => {
          try {
            await app.deleteDesktopConversation(sessionId);
          } catch (e) {
            app.error(`删除会话失败: ${e}`);
            return;
          }
          for (const pane of state.panes) {
            if (pane.taskId === sessionId) pane.taskId = null;
          }
          setSessionArchived(localStorage, app.workspace || '', sessionId, false);
          state.sidebar.unreadSessions.delete(sessionId);
          if (state.sidebar.activeSessionId === sessionId) {
            state.sidebar.activeSessionId = null;
            state.activeTaskFilter = null;
            app.currentTaskId = null;
          }
          // 同时清理本地保存的排序记录，避免删除后顺序键残留脏 id
          const orderKey = `sacode.session.order.${app.workspace || ''}`;
          try {
            const stored = JSON.parse(localStorage.getItem(orderKey) || '[]') as string[];
            const next = stored.filter((id) => id !== sessionId);
            localStorage.setItem(orderKey, JSON.stringify(next));
          } catch {
            /* 忽略排序记录清理失败，不影响删除主流程 */
          }
          render(root, app, state);
        })();
      },
      onReorderSessions: (projectPath: string, fromId: string, toId: string) => {
        const storageKey = `sacode.session.order.${projectPath}`;
        const ids = app.desktopConversations.map((t) => t.id);
        const stored = JSON.parse(localStorage.getItem(storageKey) || '[]') as string[];
        const order = stored.length === ids.length && ids.every((id) => stored.includes(id))
          ? stored
          : ids;
        const fromIdx = order.indexOf(fromId);
        const toIdx = order.indexOf(toId);
        if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
        order.splice(fromIdx, 1);
        order.splice(toIdx, 0, fromId);
        localStorage.setItem(storageKey, JSON.stringify(order));
        render(root, app, state);
      },
      rerender: () => render(root, app, state),
    },
  );

  const buildAgentPane = (index: number) => {
    const pane = state.panes[index];
    const taskId = pane.taskId;
    const title = taskId
      ? (localStorage.getItem(`sacode.session.title.${taskId}`)
          || app.desktopConversations.find((t) => t.id === taskId)?.title.slice(0, 32)
          || taskId.slice(0, 8))
      : '新会话';

    return el('div', {
      className: `pane ${state.activePane === index ? 'pane-active' : ''} mode-${pane.conversationMode}`,
      dataset: { paneIndex: String(index) },
      onclick: () => {
        if (state.activePane !== index) {
          state.activePane = index;
          const id = pane.taskId;
          state.sidebar.activeSessionId = id;
          state.activeTaskFilter = id;
          if (id && app.currentConversationId !== id) {
            void app.selectDesktopConversation(id).catch((e) => app.error(`打开会话失败: ${e}`));
          } else if (!id) {
            app.currentConversationId = null;
            app.conversationTurns = null;
            app.currentTaskId = null;
          }
          render(root, app, state);
        }
      },
    }, [
      el('div', { className: 'pane-header' }, [
        el('div', {
          className: 'pane-header-title',
          title: taskId ? '双击重命名会话' : '新会话',
          ondblclick: () => {
            if (!taskId) return;
            state.sessionDialog = { kind: 'rename', paneIndex: index };
            render(root, app, state);
          },
        }, [title]),
        el('button', {
          className: `header-btn ${pane.contextOpen ? 'active' : ''}`,
          title: '本分屏工具栏',
          onclick: () => {
            pane.contextOpen = !pane.contextOpen;
            state.activePane = index;
            render(root, app, state);
          },
        }, ['▦']),
        el('button', {
          className: 'header-btn',
          title: '更多',
          onclick: (event: Event) => {
            const btn = event.currentTarget as HTMLElement;
            const rect = btn.getBoundingClientRect();
            state.moreMenuOpen = true;
            state.moreMenuPosition = { x: Math.min(rect.right - 200, window.innerWidth - 220), y: rect.bottom + 6 };
            state.activePane = index;
            state.moreMenuItems = buildPaneMoreMenu(state, app, index, () => render(root, app, state));
            render(root, app, state);
          },
        }, ['⋯']),
        el('button', {
          className: 'pane-close',
          title: state.panes.length > 1 ? '关闭此分屏' : '关闭会话',
          onclick: (event: Event) => {
            event.stopPropagation();
            finishClosingView(root, app, state, closePane(state, app, index));
          },
        }, ['×']),
      ]),
      buildConversation(app, taskId, pane.inputArea, (mode) => {
        pane.conversationMode = mode as ConversationMode;
        pane.inputArea.executionMode = mode as ExecutionModeInput;
        if (index === 0) state.conversationMode = pane.conversationMode;
      }, () => {
        openSettings(state.settings, app);
        state.settings.section = 'execution';
        render(root, app, state);
      }, (newTaskId) => {
        if (!taskId) {
          state.panes[index].taskId = app.currentConversationId || newTaskId;
          state.sidebar.activeSessionId = state.panes[index].taskId;
          state.activeTaskFilter = state.panes[index].taskId;
        }
        render(root, app, state);
      }, index),
      ...(pane.contextOpen && state.activePane === index
        ? [buildContextPanel(app, pane.activeTab, {
            taskId: (taskId && (app.conversationTurns?.id === taskId
              ? app.conversationTurns
              : app.conversationDetails.get(taskId))?.turns.at(-1)?.task_id)
              || (taskId === app.currentConversationId ? app.currentTaskId : null),
            onTabChange: (tab) => {
              pane.activeTab = tab;
              render(root, app, state);
              if (tab === 'terminal' && state.terminals.length === 0) void state.createTerminal?.();
            },
            onOpenDesign: () => {
              pane.activeTab = 'design';
              void app.refreshDesignData();
              render(root, app, state);
            },
            terminals: state.terminals,
            activeTerminalId: state.activeTerminalId,
            terminalNotice: state.terminalNotice,
            terminalAvailable: isNativeTerminalAvailable(),
            onTerminalSelect: (id) => {
              state.activeTerminalId = id;
              render(root, app, state);
            },
            onTerminalCreate: () => {
              void state.createTerminal?.();
            },
            onTerminalClose: (id) => {
              void closeTerminal(id).catch((error) => { state.terminalNotice = `关闭终端失败：${String(error)}`; render(root, app, state); });
              state.terminals = state.terminals.filter((term) => term.id !== id);
              if (state.activeTerminalId === id) {
                state.activeTerminalId = state.terminals[0]?.id || null;
              }
              render(root, app, state);
            },
            onTerminalRun: (id, cmd) => {
              const term = state.terminals.find((item) => item.id === id);
              if (!term || term.exited) return;
              void writeTerminal(id, `${cmd}\r`).then((written) => {
                if (!written) throw new Error('原生终端不可用');
              }).catch((error: unknown) => {
                term.lines.push({ text: `! ${String(error)}`, tone: 'err' });
                app.onChange?.();
              });
            },
            onTerminalWrite: (id, data) => {
              const term = state.terminals.find((item) => item.id === id);
              if (!term || term.exited) return;
              void writeTerminal(id, data).then((written) => {
                if (!written) throw new Error('原生终端不可用');
              }).catch((error: unknown) => {
                term.lines.push({ text: `! ${String(error)}`, tone: 'err' });
                app.onChange?.();
              });
            },
            panelSize: pane.panelSize,
            panelPos: pane.panelPos,
            onPanelSize: (size) => {
              pane.panelSize = size;
              render(root, app, state);
            },
            onPanelMove: (pos) => {
              pane.panelPos = pos;
              render(root, app, state);
            },
            onClosePanel: () => {
              pane.contextOpen = false;
              render(root, app, state);
            },
          })]
        : []),
    ]);
  };

  const buildSplitLayout = (node: SplitLayout, path = ''): HTMLElement => {
    if ('pane' in node) return el('div', { className: 'split-leaf' }, [buildAgentPane(node.pane)]);
    const divider = el('div', {
      className: `split-divider ${node.axis}`,
      role: 'separator',
      title: '拖动调整分屏比例；双击平分',
      ondblclick: () => { state.layout = resizeSplit(state.layout, path, 0.5); render(root, app, state); },
      onpointerdown: (event: PointerEvent) => {
        event.preventDefault();
        const box = (event.currentTarget as HTMLElement).parentElement!.getBoundingClientRect();
        const move = (next: PointerEvent) => {
          const ratio = node.axis === 'column'
            ? (next.clientX - box.left) / box.width
            : (next.clientY - box.top) / box.height;
          state.layout = resizeSplit(state.layout, path, ratio);
          render(root, app, state);
        };
        const stop = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', stop);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', stop, { once: true });
      },
    });
    return el('div', { className: `split-node axis-${node.axis}` }, [
      el('div', { className: 'split-child first', style: `flex-basis:${node.ratio * 100}%` }, [buildSplitLayout(node.first, `${path}a`)]),
      divider,
      el('div', { className: 'split-child second' }, [buildSplitLayout(node.second, `${path}b`)]),
    ]);
  };

  const newTaskPage = showNewTaskPage(state);
  if (newTaskPage && !state.newTaskDialog.open && state.newTaskDialog.workspace !== app.workspace) {
    state.newTaskDialog.workspace = app.workspace;
  }

  const workspaceContent =
    state.activeView === 'design'
    ? [buildSaDesignWorkspace(app, state.design, {
        rerender: () => render(root, app, state),
        onRun: () => {
          const prompt = buildSaDesignPrompt(state.design);
          const { mode, backendId } = state.design.draft;
          void app.runTask({ prompt, mode, backendId }).then((created) => {
            if (created && app.currentTaskId) {
              state.design.lastTaskId = app.currentTaskId;
              state.activeView = 'agent';
              openTaskInActivePane(state, app, app.currentTaskId);
              render(root, app, state);
            }
          });
        },
      })]
    : newTaskPage
    ? [buildTaskCreator('page')]
    : [
        el('div', { className: 'work-area' }, [
          state.maximizedPane === null ? buildSplitLayout(state.layout) : buildAgentPane(state.maximizedPane),
        ]),
      ];

  root.replaceChildren(
    el('div', { className }, [
      sidebar,
      ...workspaceContent,
      buildStatusBar(app, state.activeView),
    ]),
  );

  // 确认弹窗挂到 app-shell 根节点，避免被 .sidebar 的 overflow:hidden 裁切
  if (state.sidebar.confirmDialog) {
    root.querySelector('.app-shell')?.appendChild(
      buildConfirmDialog(state.sidebar, {
        onViewChange: changeView,
        onNewSession: () => {},
        onToggleCollapsed: () => {},
        onOpenSettings: () => {},
        rerender: () => render(root, app, state),
      }),
    );
  }

  function buildTaskCreator(layout: 'dialog' | 'page') {
    return buildNewTaskDialog(app, state.newTaskDialog, {
      layout,
      mode: state.conversationMode,
      onClose: () => {
        if (state.newTaskDialog.creating) return;
        state.newTaskDialog.open = false;
        render(root, app, state);
      },
      onConfigureModels: () => {
        state.newTaskDialog.open = false;
        openSettings(state.settings, app);
        state.settings.section = 'execution';
        render(root, app, state);
      },
      onSwitchWorkspace: async (workspace) => {
        if (workspace !== app.workspace) await app.changeWorkspace(workspace);
        await app.refreshWorkspaceCapabilities();
        const saved = loadDesktopPreferences(app);
        state.newTaskDialog.model = validModelId(app, saved.defaultModel);
        state.newTaskDialog.skill = validSkillName(app, saved.defaultSkill);
      },
      onCreateEmpty: async (workspace) => {
        if (workspace !== app.workspace) await app.changeWorkspace(workspace);
        const saved = loadDesktopPreferences(app);
        state.inputArea.model = validModelId(app, saved.defaultModel);
        state.inputArea.skill = validSkillName(app, saved.defaultSkill);
        state.sidebar.activeSessionId = null;
        state.activeTaskFilter = null;
        app.currentConversationId = null;
        app.conversationTurns = null;
        app.currentTaskId = null;
        state.panes[state.activePane].taskId = null;
        state.activeView = 'agent';
        state.newTaskDialog.open = false;
        render(root, app, state);
        requestAnimationFrame(() => {
          const prompt = root.querySelector('#new-task-prompt') as HTMLTextAreaElement | null;
          prompt?.focus();
        });
      },
      onCreateTask: async ({ workspace, prompt, modelProvider, modelName, skill, contextPaths }) => {
        if (workspace !== app.workspace) await app.changeWorkspace(workspace);
        const created = await app.runTask({
          prompt,
          mode: state.conversationMode,
          backendId: app.defaultBackend || 'sacode',
          modelProvider,
          modelName,
          skill,
          contextPaths,
        });
        if (!created || !app.currentTaskId) throw new Error(app.lastTaskCreateError || '创建任务失败，请检查连接或模型配置');
        openTaskInActivePane(state, app, app.currentTaskId);
        render(root, app, state);
      },
      rerender: () => render(root, app, state),
    });
  }

  if (state.newTaskDialog.open && !newTaskPage) {
    root.querySelector('.app-shell')?.appendChild(buildTaskCreator('dialog'));
  }

  if (state.settings.open) {
    const settingsCenter = buildSettingsCenter(app, state.settings, {
      onClose: () => {
        state.settings.open = false;
        state.settings.providerForm.apiKey = '';
        applyInterfacePreferences(loadDesktopPreferences(app));
        render(root, app, state);
      },
      onSave: (next) => {
        saveDesktopPreferences(next);
        state.settings.draft = { ...next };
        state.settings.dirty = false;
        state.conversationMode = next.defaultMode;
        state.inputArea.executionMode = next.defaultMode;
        state.inputArea.model = validModelId(app, next.defaultModel);
        state.inputArea.skill = validSkillName(app, next.defaultSkill);
        state.newTaskDialog.model = state.inputArea.model;
        state.newTaskDialog.skill = state.inputArea.skill;
        app.defaultBackend = next.defaultBackend;
        state.shell.sidebarOpen = next.sidebarOpen;
        state.shell.contextOpen = next.contextOpen;
        // 托盘与自启动是 Tauri 壳层能力，保存时同步到原生侧；Web 环境忽略。
        void setTrayEnabled(next.trayEnabled).catch(() => {});
        void setAutostart(next.autostart).catch(() => {});
        render(root, app, state);
      },
      onSwitchProject: async (workspace) => {
        state.settings.providerForm.apiKey = '';
        state.settings.localProviders = [];
        await app.changeWorkspace(workspace);
        await app.refreshWorkspaceCapabilities();
        void app.listLocalProviders().then((result) => {
          if (state.settings.open && app.workspace === workspace) {
            state.settings.localProviders = result.providers;
            render(root, app, state);
          }
        }).catch(() => {});
        const saved = loadDesktopPreferences(app);
        state.inputArea.model = validModelId(app, saved.defaultModel);
        state.inputArea.skill = validSkillName(app, saved.defaultSkill);
        state.newTaskDialog.model = state.inputArea.model;
        state.newTaskDialog.skill = state.inputArea.skill;
        state.sidebar.activeSessionId = null;
        state.activeTaskFilter = null;
        for (const pane of state.panes) pane.taskId = null;
        app.currentConversationId = null;
        app.conversationTurns = null;
        app.currentTaskId = null;
        state.activeView = 'agent';
        render(root, app, state);
      },
      rerender: () => render(root, app, state),
    });
    root.querySelector('.app-shell')?.appendChild(settingsCenter);
  }

  // 个人信息 / 知识库 / 自动化 弹窗
  if (state.modal === 'knowledge' || state.modal === 'automation' || state.modal === 'profile') {
    const title = state.modal === 'knowledge' ? '知识库' : state.modal === 'automation' ? '自动化' : '个人信息';
    const body = state.modal === 'knowledge'
      ? buildSaNativeWorkspace(app, state.native, () => render(root, app, state))
      : state.modal === 'automation'
      ? buildAutomationWorkspace(app, state.automation, () => render(root, app, state))
      : buildProfileModal(app, () => {
          state.modal = null;
          render(root, app, state);
        }, () => {
          state.modal = null;
          openSettings(state.settings, app);
          render(root, app, state);
        });
    const modal = el('div', {
      className: 'workspace-modal-overlay',
      onclick: (event: Event) => {
        if (event.target === event.currentTarget) {
          state.modal = null;
          render(root, app, state);
        }
      },
    }, [
      el('div', { className: `workspace-modal ${state.modal === 'profile' ? 'workspace-modal-sm' : ''}` }, [
        el('div', { className: 'workspace-modal-header' }, [
          el('div', { className: 'workspace-modal-title' }, [title]),
          el('button', {
            className: 'workspace-modal-close',
            title: '关闭',
            onclick: () => {
              state.modal = null;
              render(root, app, state);
            },
          }, ['×']),
        ]),
        el('div', { className: 'workspace-modal-body' }, [body]),
      ]),
    ]);
    root.querySelector('.app-shell')?.appendChild(modal);
  }

  // 更多菜单
  if (state.moreMenuOpen) {
    const menu = buildMoreMenu(state.moreMenuItems, state.moreMenuPosition, () => {
      state.moreMenuOpen = false;
      render(root, app, state);
    });
    root.querySelector('.app-shell')?.appendChild(menu);
  }

  if (state.sessionDialog) {
    root.querySelector('.app-shell')?.appendChild(buildSessionDialog(app, state, () => render(root, app, state)));
  }

  root.querySelectorAll<HTMLElement>('.timeline[data-pane]').forEach((timeline) => {
    const previous = scrollStates.get(timeline.dataset.pane!);
    if (previous && previous.conversation === (timeline.dataset.conversation ?? '')) {
      timeline.scrollTop = previous.atBottom ? timeline.scrollHeight : previous.top;
    } else {
      timeline.scrollTop = timeline.scrollHeight;
    }
    const navigation = timeline.parentElement?.querySelector<HTMLElement>('.timeline-jump-latest');
    const distance = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight;
    navigation?.classList.toggle('visible', distance > JUMP_VISIBLE_THRESHOLD);
    if (navigation) navigation.tabIndex = distance > JUMP_VISIBLE_THRESHOLD ? 0 : -1;
    timeline.dispatchEvent(new Event('scroll'));
  });
  const terminalHistory = root.querySelector<HTMLElement>('.terminal-history');
  if (terminalHistory) terminalHistory.scrollTop = terminalScroll && !terminalScroll.atBottom
    ? terminalScroll.top : terminalHistory.scrollHeight;
  syncTerminalSize(root);
  if (focusSelector) {
    const pane = focusPaneIndex >= 0 ? root.querySelector<HTMLElement>(`.pane[data-pane-index="${focusPaneIndex}"]`) : root;
    const sameConversation = focusPaneIndex < 0
      || (pane?.querySelector<HTMLElement>('.timeline')?.dataset.conversation ?? null) === focusConversation;
    const replacement = sameConversation ? pane?.querySelector<HTMLInputElement | HTMLTextAreaElement>(focusSelector) : null;
    if (replacement) {
      if (terminalDraft !== null) replacement.value = terminalDraft;
      replacement.focus();
      if (focusStart !== null && focusEnd !== null) replacement.setSelectionRange(focusStart, focusEnd);
    }
  }
  saveWorkbenchLayout(root, app, state);
}

function setupKeyboard(root: HTMLElement, app: DesktopApp, state: UiState) {
  document.addEventListener('keydown', (event) => {
    if (state.shell.connection !== 'healthy') return;
    const target = event.target as HTMLElement;
    const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
    if (inInput && event.key !== 'Escape') return;

    if (state.activeView === 'design' && state.design.previewDocument && state.design.previewMode === 'draft') {
      const key = event.key.toLowerCase();
      if (event.ctrlKey && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redoUiCommand(state.design);
        else undoUiCommand(state.design);
        render(root, app, state);
        return;
      }
      if (event.ctrlKey && key === 'y') {
        event.preventDefault();
        redoUiCommand(state.design);
        render(root, app, state);
        return;
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && state.design.selectedNodeId) {
        const selected = findUiNode(state.design.previewDocument, state.design.selectedNodeId);
        const rootId = state.design.previewDocument.pages
          .find((page) => page.id === state.design.selectedPageId)?.root.id
          ?? state.design.previewDocument.pages[0]?.root.id;
        const parentLocked = selected ? findUiNodeLocation(state.design.previewDocument, selected.id)?.parent?.locked : false;
        if (selected && selected.id !== rootId && !selected.locked && !parentLocked) {
          event.preventDefault();
          applyUiCommand(state.design, { type: 'delete-node', nodeId: selected.id });
          render(root, app, state);
          return;
        }
      }
    }

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
    // 窄屏强制收起侧栏/右栏；宽屏不覆盖用户偏好（右栏默认保持关闭）
    if (breakpoint === 'xs') {
      state.shell.sidebarOpen = false;
      state.shell.contextOpen = false;
    } else if (breakpoint === 'sm' || breakpoint === 'md') {
      state.shell.sidebarOpen = true;
      state.shell.contextOpen = false;
    }
    render(root, app, state);
  };
  window.addEventListener('resize', check);
  setTimeout(check, 0);
}
