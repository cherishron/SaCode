/** ContextPanel — 右侧工具栏：文件/变更/终端/设计/预览 */
import { el } from '../dom.ts';
import type { DesktopApp } from './service.ts';

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
}

export interface ContextPanelActions {
  onTabChange: (tab: ContextTab) => void;
  onOpenDesign: () => void;
  terminals?: TerminalSession[];
  activeTerminalId?: string | null;
  onTerminalSelect?: (id: string) => void;
  onTerminalCreate?: () => void;
  onTerminalClose?: (id: string) => void;
  onTerminalRun?: (id: string, cmd: string) => void;
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

ensureDragListeners();

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
  const pendingCount = app.approvals.length;
  const changeCount = app.changes.length;
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
      activeTab === 'changes' ? buildChangesTab(app) : '',
      activeTab === 'terminal' ? buildTerminalTab(app, actions) : '',
      activeTab === 'design' ? buildDesignTab(app, actions.onOpenDesign) : '',
      activeTab === 'preview' ? buildPreviewTab(app) : '',
    ].filter(Boolean) as Node[]),
  ]);
}

function buildFilesTab(app: DesktopApp) {
  if (app.changes.length === 0) {
    return el('div', { className: 'context-empty' }, [
      el('div', { className: 'context-empty-icon' }, ['📄']),
      el('div', {}, ['当前会话暂无文件变更']),
    ]);
  }
  return el('div', {}, app.changes.map((change) =>
    el('div', {
      className: 'context-file-row',
    }, [
      el('span', { className: 'mono' }, [
        change.additions > 0 ? `+${change.additions}` : '  0',
        ' / ',
        change.deletions > 0 ? `-${change.deletions}` : '  0',
      ]),
      el('span', {
        className: 'truncate',
      }, [change.path]),
    ]),
  ));
}

function buildChangesTab(app: DesktopApp) {
  if (app.changes.length === 0) {
    return el('div', { className: 'context-empty' }, [
      el('div', { className: 'context-empty-icon' }, ['📝']),
      el('div', {}, ['暂无变更']),
    ]);
  }
  return el('div', {}, app.changes.map((change) =>
    el('div', {
      className: 'change-row',
    }, [
      el('div', {
        className: 'mono',
      }, [change.path]),
      el('div', {
        className: 'muted',
      }, [`+${change.additions} / -${change.deletions}`]),
    ]),
  ));
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
        title: '新建终端',
        onclick: () => actions.onTerminalCreate?.(),
      }, ['+']),
    ]),
    active
      ? el('div', { id: 'terminal-history', className: 'terminal-history mono' },
          active.lines.map((line) => el('div', { className: `terminal-line ${line.tone}` }, [line.text])),
        )
      : el('div', { className: 'terminal-history mono' }, [
          el('div', { className: 'terminal-line muted' }, ['点击 + 新建终端']),
        ]),
    el('div', { className: 'terminal-input-row' }, [
      el('span', { className: 'terminal-prompt mono' }, [`$ ${active?.shell || 'sh'}`]),
      el('input', {
        id: 'terminal-input',
        className: 'terminal-input mono',
        placeholder: '输入命令后回车',
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
  const candidates = [
    'http://localhost:5173',
    'http://localhost:3000',
    'http://localhost:8080',
  ];
  return el('div', { className: 'context-preview' }, [
    el('div', { className: 'preview-toolbar' }, [
      el('input', {
        id: 'preview-url',
        className: 'preview-url mono',
        value: candidates[0],
        placeholder: 'http://localhost:3000',
      }),
      el('button', {
        className: 'btn sm',
        onclick: () => {
          const url = (document.getElementById('preview-url') as HTMLInputElement | null)?.value?.trim();
          const frame = document.getElementById('preview-frame') as HTMLIFrameElement | null;
          if (url && frame) frame.src = url;
        },
      }, ['打开']),
    ]),
    el('iframe', {
      id: 'preview-frame',
      className: 'preview-frame',
      src: candidates[0],
      title: '预览',
    }),
    el('div', { className: 'preview-hint muted' }, [
      `当前项目：${app.workspace || '未选择'} · 可填入本地 dev server 地址`,
    ]),
  ]);
}
