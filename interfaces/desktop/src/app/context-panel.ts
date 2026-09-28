/** ContextPanel — 右侧工具栏：文件/变更/终端/设计/预览 */
import { el } from '../dom.ts';
import type { TaskFileChange, WorkspaceFileOption, WorkspaceFilePreview } from '@cherishron/sacode-client-core';
import { buildDiffView, parseDiff } from '../components/diff-view.ts';
import type { DesktopApp } from './service.ts';
import { terminalKeyData } from './terminal-input.ts';

export type ContextTab = 'files' | 'changes' | 'terminal' | 'design' | 'preview';

export interface TerminalLine {
  text: string;
  tone: 'out' | 'ok' | 'err' | 'muted';
}

export interface TerminalSession {
  id: string;
  name: string;
  lines: TerminalLine[];
  cwd: string;
  shell: string;
  exited?: boolean;
}

export interface ContextPanelActions {
  taskId?: string | null;
  onTabChange: (tab: ContextTab) => void;
  onOpenDesign: () => void;
  terminals?: TerminalSession[];
  activeTerminalId?: string | null;
  terminalNotice?: string | null;
  terminalAvailable?: boolean;
  onTerminalSelect?: (id: string) => void;
  onTerminalCreate?: () => void;
  onTerminalClose?: (id: string) => void;
  onTerminalRun?: (id: string, cmd: string) => void;
  onTerminalWrite?: (id: string, data: string) => void;
  panelSize?: 'sm' | 'md' | 'lg';
  panelPos?: { x: number; y: number };
  onPanelSize?: (size: 'sm' | 'md' | 'lg') => void;
  onPanelMove?: (pos: { x: number; y: number }) => void;
  onClosePanel?: () => void;
}

/** 共享拖拽状态，避免每次 render 叠加 window 监听 */
const dragState: {
  handle: HTMLElement | null;
  onMove: ((x: number, y: number) => void) | null;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
} = {
  handle: null,
  onMove: null,
  startX: 0,
  startY: 0,
  originX: 0,
  originY: 0,
};

function ensureDragListeners() {
  window.addEventListener('mousemove', (event: MouseEvent) => {
    if (!dragState.handle || !dragState.onMove) return;
    dragState.onMove(
      dragState.originX + (event.clientX - dragState.startX),
      dragState.originY + (event.clientY - dragState.startY),
    );
  });
  window.addEventListener('mouseup', () => {
    dragState.handle = null;
    dragState.onMove = null;
  });
}

if (typeof window !== 'undefined') ensureDragListeners();

interface FileTreeEntry {
  path: string;
  name: string;
  depth: number;
  directory: boolean;
  size: number;
}

interface PanelDataState {
  workspace: string;
  taskId: string | null;
  filter: string;
  expanded: Set<string>;
  selectedFile: string | null;
  filePreview: WorkspaceFilePreview | null;
  fileLoading: boolean;
  fileError: string | null;
  fileRequest: number;
  filesRefreshing: boolean;
  filesError: string | null;
  selectedChange: string | null;
  changesRefreshing: boolean;
  changesError: string | null;
}

const panelData: PanelDataState = {
  workspace: '', taskId: null, filter: '', expanded: new Set(),
  selectedFile: null, filePreview: null, fileLoading: false, fileError: null,
  fileRequest: 0, filesRefreshing: false, filesError: null,
  selectedChange: null, changesRefreshing: false, changesError: null,
};

const changesByTask = new Map<string, TaskFileChange[]>();
const requestedChanges = new Set<string>();

function syncPanelData(app: DesktopApp, taskId: string | null) {
  if (panelData.workspace !== app.workspace) {
    panelData.workspace = app.workspace;
    panelData.filter = '';
    panelData.expanded.clear();
    panelData.selectedFile = null;
    panelData.filePreview = null;
    panelData.fileLoading = false;
    panelData.fileError = null;
    panelData.filesError = null;
    panelData.fileRequest++;
    changesByTask.clear();
    requestedChanges.clear();
  }
  if (panelData.taskId !== taskId) {
    panelData.taskId = taskId;
    panelData.selectedChange = null;
    panelData.changesError = null;
  }
}

function taskChanges(app: DesktopApp, taskId: string | null): TaskFileChange[] {
  if (!taskId) return [];
  return taskId === app.currentTaskId ? app.changes : (changesByTask.get(taskId) || []);
}

async function refreshTaskChanges(app: DesktopApp, taskId: string) {
  if (!app.client || panelData.changesRefreshing) return;
  panelData.changesRefreshing = true;
  panelData.changesError = null;
  requestedChanges.add(taskId);
  try {
    const response = await app.client.getTaskChanges(taskId);
    changesByTask.set(taskId, response.changes);
    if (taskId === app.currentTaskId) app.changes = response.changes;
  } catch (error) {
    if (panelData.taskId === taskId) panelData.changesError = displayError(error);
  } finally {
    panelData.changesRefreshing = false;
    app.onChange?.();
  }
}

/** Visible rows from the workspace file index, with derived folders and search ancestors. */
export function workspaceFileRows(
  files: WorkspaceFileOption[],
  expanded: ReadonlySet<string>,
  filter = '',
): FileTreeEntry[] {
  const entries = new Map<string, Omit<FileTreeEntry, 'depth'>>();
  for (const file of files) {
    const path = file.path.replace(/\\/g, '/');
    const parts = path.split('/');
    if (parts.some((part) => !part || part === '.' || part === '..')) continue;
    for (let index = 1; index < parts.length; index++) {
      const directory = parts.slice(0, index).join('/');
      entries.set(directory, { path: directory, name: parts[index - 1]!, directory: true, size: 0 });
    }
    entries.set(path, {
      path, name: parts[parts.length - 1]!, directory: file.is_dir,
      size: file.size,
    });
  }
  const children = new Map<string, Array<Omit<FileTreeEntry, 'depth'>>>();
  for (const entry of entries.values()) {
    const parent = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : '';
    const group = children.get(parent) || [];
    group.push(entry);
    children.set(parent, group);
  }
  for (const group of children.values()) {
    group.sort((left, right) => Number(right.directory) - Number(left.directory) || left.name.localeCompare(right.name));
  }
  const query = filter.trim().toLocaleLowerCase();
  const visible = new Set<string>();
  if (query) {
    for (const entry of entries.values()) {
      if (!entry.path.toLocaleLowerCase().includes(query)) continue;
      let ancestor = entry.path;
      while (ancestor) {
        visible.add(ancestor);
        ancestor = ancestor.includes('/') ? ancestor.slice(0, ancestor.lastIndexOf('/')) : '';
      }
      if (entry.directory) {
        for (const candidate of entries.keys()) {
          if (candidate.startsWith(`${entry.path}/`)) visible.add(candidate);
        }
      }
    }
  }
  const rows: FileTreeEntry[] = [];
  const visit = (parent: string, depth: number) => {
    for (const entry of children.get(parent) || []) {
      if (query && !visible.has(entry.path)) continue;
      rows.push({ ...entry, depth });
      if (entry.directory && (query || expanded.has(entry.path))) visit(entry.path, depth + 1);
    }
  };
  visit('', 0);
  return rows;
}

function displayError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function refreshFiles(app: DesktopApp) {
  if (panelData.filesRefreshing) return;
  if (!app.client) {
    panelData.filesError = 'daemon 尚未连接';
    app.onChange?.();
    return;
  }
  const workspace = app.workspace;
  panelData.filesRefreshing = true;
  panelData.filesError = null;
  app.onChange?.();
  try {
    const capabilities = await app.client.getWorkspaceCapabilities();
    if (app.workspace !== workspace) return;
    app.workspaceCapabilities = capabilities;
    if (panelData.selectedFile && !capabilities.files.some((file) => file.path === panelData.selectedFile)) {
      panelData.selectedFile = null;
      panelData.filePreview = null;
    }
  } catch (error) {
    if (app.workspace === workspace) panelData.filesError = displayError(error);
  } finally {
    panelData.filesRefreshing = false;
    app.onChange?.();
  }
}

async function openFile(app: DesktopApp, path: string) {
  const request = ++panelData.fileRequest;
  const workspace = app.workspace;
  panelData.selectedFile = path;
  panelData.filePreview = null;
  panelData.fileError = null;
  panelData.fileLoading = true;
  app.onChange?.();
  try {
    if (!app.client) throw new Error('daemon 尚未连接');
    const preview = await app.client.getWorkspaceFile(path);
    if (request === panelData.fileRequest && workspace === app.workspace) panelData.filePreview = preview;
  } catch (error) {
    if (request === panelData.fileRequest && workspace === app.workspace) panelData.fileError = displayError(error);
  } finally {
    if (request === panelData.fileRequest && workspace === app.workspace) {
      panelData.fileLoading = false;
      app.onChange?.();
    }
  }
}

function attachDrag(handle: HTMLElement, onMove: (x: number, y: number) => void) {
  handle.addEventListener('mousedown', (event: MouseEvent) => {
    if ((event.target as HTMLElement).closest('button')) return;
    const panel = handle.closest('.context-panel') as HTMLElement | null;
    dragState.handle = handle;
    dragState.onMove = onMove;
    dragState.startX = event.clientX;
    dragState.startY = event.clientY;
    dragState.originX = panel?.offsetLeft ?? 0;
    dragState.originY = panel?.offsetTop ?? 0;
    event.preventDefault();
  });
}

export function buildContextPanel(
  app: DesktopApp,
  activeTab: ContextTab = 'files',
  actions: ContextPanelActions,
) {
  const taskId = actions.taskId ?? null;
  syncPanelData(app, taskId);
  if (activeTab === 'changes' && taskId && taskId !== app.currentTaskId && !requestedChanges.has(taskId)) {
    void refreshTaskChanges(app, taskId);
  }
  const pendingCount = app.approvals.length;
  const changeCount = taskChanges(app, taskId).length;
  const size = actions.panelSize || 'md';
  const pos = actions.panelPos || { x: 0, y: 0 };

  const tabs: { key: ContextTab; label: string; badge?: number }[] = [
    { key: 'files', label: '文件' },
    { key: 'changes', label: '变更', badge: changeCount },
    { key: 'terminal', label: '终端', badge: actions.terminals?.length },
    { key: 'design', label: '设计' },
    { key: 'preview', label: '预览' },
  ];

  const floatBar = el('div', {
    className: 'context-float-bar',
    title: '拖拽移动工具栏',
  }, [
    el('span', { className: 'context-float-grip' }, ['⋮⋮']),
    el('span', { className: 'context-float-title' }, ['工具栏']),
    el('button', {
      className: `context-float-btn ${size === 'sm' ? 'active' : ''}`,
      title: '缩小',
      onclick: () => actions.onPanelSize?.('sm'),
    }, ['–']),
    el('button', {
      className: `context-float-btn ${size === 'md' ? 'active' : ''}`,
      title: '中等',
      onclick: () => actions.onPanelSize?.('md'),
    }, ['□']),
    el('button', {
      className: `context-float-btn ${size === 'lg' ? 'active' : ''}`,
      title: '放大',
      onclick: () => actions.onPanelSize?.('lg'),
    }, ['+']),
    el('button', {
      className: 'context-float-btn',
      title: '关闭工具栏',
      onclick: () => actions.onClosePanel?.(),
    }, ['×']),
  ]);

  attachDrag(floatBar, (x, y) => actions.onPanelMove?.({ x, y }));

  const style = pos.x < 0
    ? `right:12px;top:${Math.max(0, pos.y)}px`
    : `left:${Math.max(0, pos.x)}px;top:${Math.max(0, pos.y)}px`;

  return el('aside', {
    className: `context-panel size-${size}`,
    style,
  }, [
    floatBar,
    el('div', { className: 'context-tabs' },
      tabs.map((tab) =>
        el('button', {
          className: `context-tab ${activeTab === tab.key ? 'active' : ''}`,
          onclick: () => actions.onTabChange(tab.key),
        }, [
          el('span', {}, [tab.label]),
          tab.badge
            ? el('span', { className: 'context-tab-count' }, [String(tab.badge)])
            : '',
        ].filter(Boolean) as Node[]),
      ),
    ),
    el('div', { className: 'context-content' }, [
      activeTab === 'files' ? buildFilesTab(app) : '',
      activeTab === 'changes' ? buildChangesTab(app, taskId) : '',
      activeTab === 'terminal' ? buildTerminalTab(app, actions) : '',
      activeTab === 'design' ? buildDesignTab(app, actions.onOpenDesign) : '',
      activeTab === 'preview' ? buildPreviewTab(app) : '',
    ].filter(Boolean) as Node[]),
  ]);
}

function buildFilesTab(app: DesktopApp) {
  const files = app.workspaceCapabilities.files;
  const tree = el('div', { className: 'context-file-tree', role: 'tree' });
  const fillTree = () => {
    const rows = workspaceFileRows(files, panelData.expanded, panelData.filter);
    tree.replaceChildren(...(rows.length ? rows.map((entry) => {
      const expanded = panelData.expanded.has(entry.path) || Boolean(panelData.filter.trim());
      return el('button', {
        className: `context-tree-row ${entry.directory ? 'directory' : 'file'} ${panelData.selectedFile === entry.path ? 'selected' : ''}`,
        style: `padding-left:${8 + entry.depth * 15}px`,
        title: entry.path,
        'aria-label': `${entry.directory ? '目录' : '文件'} ${entry.path}`,
        onclick: () => {
          if (entry.directory) {
            if (panelData.expanded.has(entry.path)) panelData.expanded.delete(entry.path);
            else panelData.expanded.add(entry.path);
            fillTree();
          } else {
            void openFile(app, entry.path);
          }
        },
      }, [
        el('span', { className: 'context-tree-icon' }, [entry.directory ? (expanded ? '▾' : '▸') : '·']),
        el('span', { className: 'context-tree-name' }, [entry.name]),
        !entry.directory ? el('span', { className: 'context-tree-size' }, [formatBytes(entry.size)]) : '',
      ].filter(Boolean) as Node[]);
    }) : [el('div', { className: 'context-tree-empty' }, [
      panelData.filter ? '没有匹配的文件' : '当前项目没有可显示的文件',
    ])]));
  };
  fillTree();

  return el('div', { className: 'context-files' }, [
    el('div', { className: 'context-section-heading' }, [
      el('div', { className: 'context-section-title' }, [`项目文件 · ${files.length}`]),
      el('button', {
        className: 'context-icon-button',
        title: '刷新文件树',
        disabled: panelData.filesRefreshing,
        onclick: () => { void refreshFiles(app); },
      }, [panelData.filesRefreshing ? '刷新中…' : '↻']),
    ]),
    el('input', {
      className: 'context-file-search',
      placeholder: '搜索项目文件…',
      value: panelData.filter,
      'aria-label': '搜索项目文件',
      oninput: (event: Event) => {
        panelData.filter = (event.target as HTMLInputElement).value;
        fillTree();
      },
    }),
    panelData.filesError ? el('div', { className: 'context-inline-error' }, [panelData.filesError]) : '',
    !app.workspaceCapabilities.workspace && !files.length && !panelData.filesError
      ? el('div', { className: 'context-tree-empty' }, ['正在加载项目文件…'])
      : tree,
    buildFilePreview(),
  ].filter(Boolean) as Node[]);
}

function formatBytes(size: number): string {
  return size < 1024 ? `${size} B` : `${Math.ceil(size / 1024)} KB`;
}

function buildFilePreview() {
  if (!panelData.selectedFile) {
    return el('div', { className: 'context-preview-empty' }, ['选择文件以只读预览']);
  }
  return el('div', { className: 'context-file-preview' }, [
    el('div', { className: 'context-preview-heading' }, [
      el('span', { className: 'context-preview-path mono', title: panelData.selectedFile }, [panelData.selectedFile]),
      panelData.filePreview
        ? el('span', { className: 'context-preview-meta' }, [formatBytes(panelData.filePreview.size)])
        : '',
    ].filter(Boolean) as Node[]),
    panelData.fileLoading ? el('div', { className: 'context-preview-message' }, ['正在读取文件…']) : '',
    panelData.fileError ? el('div', { className: 'context-inline-error' }, [panelData.fileError]) : '',
    panelData.filePreview ? el('pre', { className: 'context-file-content mono' }, [panelData.filePreview.content]) : '',
  ].filter(Boolean) as Node[]);
}

function buildChangesTab(app: DesktopApp, taskId: string | null) {
  const changes = taskChanges(app, taskId);
  const selected = changes.find((change) => change.path === panelData.selectedChange) || changes[0];
  return el('div', { className: 'context-changes' }, [
    el('div', { className: 'context-section-heading' }, [
      el('div', { className: 'context-section-title' }, [`任务变更 · ${changes.length}`]),
      el('button', {
        className: 'context-icon-button',
        title: '刷新任务变更',
        disabled: !taskId || panelData.changesRefreshing,
        onclick: () => {
          if (taskId) void refreshTaskChanges(app, taskId);
        },
      }, [panelData.changesRefreshing ? '刷新中…' : '↻']),
    ]),
    panelData.changesError ? el('div', { className: 'context-inline-error' }, [panelData.changesError]) : '',
    changes.length
      ? el('div', { className: 'context-change-list' }, changes.map((change) =>
          el('button', {
            className: `context-change-row ${selected?.path === change.path ? 'selected' : ''}`,
            title: change.path,
            onclick: () => {
              panelData.selectedChange = change.path;
              app.onChange?.();
            },
          }, [
            el('span', { className: 'context-change-kind' }, [changeKind(change.kind)]),
            el('span', { className: 'context-change-path mono' }, [change.path]),
            el('span', { className: 'context-change-stats mono' }, [`+${change.additions} −${change.deletions}`]),
          ])))
      : el('div', { className: 'context-empty' }, [
          el('div', { className: 'context-empty-icon' }, ['📝']),
          el('div', {}, [panelData.changesRefreshing ? '正在读取变更…' : taskId ? '当前任务暂无文件变更' : '选择任务后查看文件变更']),
        ]),
    selected ? buildSelectedDiff(selected) : '',
  ].filter(Boolean) as Node[]);
}

function changeKind(kind: string): string {
  switch (kind) {
    case 'added': return 'A';
    case 'deleted': return 'D';
    case 'renamed': return 'R';
    case 'copied': return 'C';
    default: return 'M';
  }
}

function buildSelectedDiff(change: DesktopApp['changes'][number]) {
  const hunk = change.diff.indexOf('@@');
  const lines = hunk >= 0 ? parseDiff(change.diff.slice(hunk).trimEnd()) : [];
  return el('div', { className: 'context-change-preview' }, [
    el('div', { className: 'context-preview-heading' }, [
      el('span', { className: 'context-preview-path mono', title: change.path }, [change.path]),
      el('span', { className: 'context-preview-meta' }, [`+${change.additions} / −${change.deletions}`]),
    ]),
    change.previous_path ? el('div', { className: 'context-preview-message' }, [`原路径：${change.previous_path}`]) : '',
    change.binary
      ? el('div', { className: 'context-preview-message' }, ['二进制变更无法预览 Diff'])
      : lines.length
        ? buildDiffView(lines)
        : el('div', { className: 'context-preview-message' }, ['此变更没有可显示的文本 Diff']),
  ].filter(Boolean) as Node[]);
}

function buildTerminalTab(app: DesktopApp, actions: ContextPanelActions) {
  const terminals = actions.terminals || [];
  const activeId = actions.activeTerminalId || terminals[0]?.id || null;
  const active = terminals.find((term) => term.id === activeId) || terminals[0];

  return el('div', { className: 'context-terminal' }, [
    el('div', { className: 'terminal-tabs' }, [
      ...terminals.map((term) => el('div', {
        className: `terminal-tab ${term.id === activeId ? 'active' : ''}`,
        onclick: () => actions.onTerminalSelect?.(term.id),
      }, [
        el('span', { className: 'terminal-tab-name' }, [term.name]),
        terminals.length > 1
          ? el('button', {
              className: 'terminal-tab-close',
              title: '关闭终端',
              onclick: (event: Event) => {
                event.stopPropagation();
                actions.onTerminalClose?.(term.id);
              },
            }, ['×'])
          : '',
      ].filter(Boolean) as Node[])),
      el('button', {
        className: 'terminal-tab-new',
        title: actions.terminalAvailable === false ? '仅在桌面客户端中可用' : '新建终端',
        onclick: () => actions.onTerminalCreate?.(),
      }, ['+']),
    ]),
    actions.terminalNotice ? el('div', { className: 'context-inline-error' }, [actions.terminalNotice]) : '',
    active
      ? el('div', {
          id: 'terminal-history', className: 'terminal-history mono', tabIndex: active.exited ? -1 : 0,
          role: 'textbox', 'aria-label': '终端输入与输出', dataset: { terminalId: active.id },
          onkeydown: (event: KeyboardEvent) => {
            const data = terminalKeyData(event);
            if (data === null || active.exited) return;
            event.preventDefault();
            event.stopPropagation();
            actions.onTerminalWrite?.(active.id, data);
          },
          onpaste: (event: ClipboardEvent) => {
            const data = event.clipboardData?.getData('text/plain');
            if (!data || active.exited) return;
            event.preventDefault();
            actions.onTerminalWrite?.(active.id, data.replace(/\r?\n/g, '\r'));
          },
        },
          active.lines.map((line) => el('div', { className: `terminal-line ${line.tone}` }, [line.text])),
        )
      : el('div', { className: 'terminal-history mono' }, [
          el('div', { className: 'terminal-line muted' }, ['点击 + 新建终端']),
        ]),
    el('div', { className: 'terminal-input-row' }, [
      el('span', { className: 'terminal-prompt mono' }, [`$ ${active?.shell || 'sh'}`]),
      el('input', {
        className: 'terminal-input mono',
        placeholder: active?.exited ? '终端已结束' : actions.terminalAvailable === false ? '桌面客户端中打开终端' : '输入命令回车，或点击输出区域直接输入',
        disabled: !active || active.exited || actions.terminalAvailable === false,
        onkeydown: (event: KeyboardEvent) => {
          if (event.key !== 'Enter') return;
          const input = event.target as HTMLInputElement;
          const cmd = input.value.trim();
          if (!cmd || !active) return;
          input.value = '';
          actions.onTerminalRun?.(active.id, cmd);
        },
      }),
    ]),
  ]);
}

function buildDesignTab(app: DesktopApp, onOpenDesign: () => void) {
  return el('div', { className: 'context-design' }, [
    el('div', { className: 'context-design-heading' }, [
      el('span', { className: 'context-design-icon' }, ['◇']),
      el('div', {}, [
        el('div', { className: 'context-design-title' }, ['SaDesign 预览']),
        el('div', { className: 'context-design-subtitle' }, [
          '与预览一样在当前右侧窗口查看设计',
        ]),
      ]),
    ]),
    el('div', { className: 'design-preview-frame' }, [
      el('div', { className: 'design-preview-placeholder' }, [
        el('div', { className: 'design-preview-art' }, ['◈']),
        el('div', {}, ['当前会话设计稿']),
        el('div', { className: 'muted' }, [
          app.currentTaskId ? '已关联会话 · 可在设计工作区编辑' : '新建任务或打开会话后生成设计',
        ]),
        el('button', {
          className: 'btn sm',
          onclick: onOpenDesign,
        }, ['打开设计工作区']),
      ]),
    ]),
  ]);
}

function buildPreviewTab(app: DesktopApp) {
  const key = `sacode.preview.url.${app.workspace}`;
  const saved = localStorage.getItem(key) || '';
  const input = el('input', {
    className: 'preview-url mono',
    value: saved,
    placeholder: 'http://localhost:3000',
    'aria-label': '预览地址',
  });
  const frame = el('iframe', {
    className: `preview-frame ${saved ? '' : 'empty'}`,
    src: saved || 'about:blank',
    title: '项目预览',
  });
  const message = el('div', { className: 'preview-hint muted' }, [
    saved ? `当前项目：${app.workspace || '未选择'}` : '输入项目开发服务器的 HTTP 地址后打开预览',
  ]);
  const open = () => {
    try {
      const url = new URL(input.value.trim());
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('仅支持 HTTP 或 HTTPS 地址');
      const value = url.toString();
      localStorage.setItem(key, value);
      frame.src = value;
      frame.classList.remove('empty');
      message.textContent = `当前项目：${app.workspace || '未选择'}`;
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : '预览地址无效';
    }
  };
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter') open(); });
  return el('div', { className: 'context-preview' }, [
    el('div', { className: 'preview-toolbar' }, [
      input,
      el('button', { className: 'btn sm', onclick: open }, ['打开']),
      el('button', { className: 'btn sm ghost', title: '刷新预览', onclick: () => { if (frame.src !== 'about:blank') frame.src = frame.src; } }, ['↻']),
    ]),
    frame,
    message,
  ]);
}
