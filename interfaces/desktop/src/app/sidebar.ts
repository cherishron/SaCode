/** Sidebar — 唯一左侧栏
 * 展开：品牌 + 项目/会话树 + 功能入口
 * 收缩：自身变成 52px 图标栏，不再叠加独立 Rail
 */
import { el } from '../dom.ts';
import type { DesktopApp } from './service.ts';
import { brandLogo } from '../brand.ts';
import { readArchivedSessions, updateUnreadSessions } from './session-visibility.ts';

export type WorkspaceView = 'agent' | 'design' | 'native' | 'automation';

export interface SidebarState {
  expandedProjects: Set<string>;
  searchQuery: string;
  showArchived: boolean;
  unreadSessions: Set<string>;
  previousSessionStatuses: Map<string, string>;
  visibleSessionIds: Set<string>;
  activeSessionId: string | null;
  contextMenu: {
    x: number;
    y: number;
    kind: 'project' | 'session';
    path: string;
    sessionId?: string;
  } | null;
  renamingPath: string | null;
  renameValue: string;
  /** 确认弹窗 */
  confirmDialog: {
    title: string;
    message: string;
    confirmLabel: string;
    danger: boolean;
    onConfirm: () => void;
  } | null;
  /** 拖拽排序 */
  dragSessionId: string | null;
  dropTargetId: string | null;
}

export interface SidebarActions {
  onViewChange: (view: WorkspaceView) => void;
  onNewSession: (workspace?: string) => void;
  onToggleCollapsed: () => void;
  onOpenSettings: () => void;
  onOpenProfile?: () => void;
  onOpenModal?: (modal: 'knowledge' | 'automation') => void;
  onRemoveProject?: (path: string) => void;
  onRenameProject?: (path: string, name: string) => void;
  onCloseSession?: (sessionId: string) => void;
  canCloseSession?: (sessionId: string) => boolean;
  onRemoveSession?: (sessionId: string) => void;
  onArchiveSession?: (sessionId: string, archived: boolean) => void;
  onRenameSession?: (sessionId: string) => void;
  onSelectSession?: (sessionId: string) => void;
  onReorderSessions?: (projectPath: string, fromId: string, toId: string) => void;
  rerender: () => void;
}

export function createSidebarState(): SidebarState {
  return {
    expandedProjects: new Set(),
    searchQuery: '',
    showArchived: false,
    unreadSessions: new Set(),
    previousSessionStatuses: new Map(),
    visibleSessionIds: new Set(),
    activeSessionId: null,
    contextMenu: null,
    renamingPath: null,
    renameValue: '',
    confirmDialog: null,
    dragSessionId: null,
    dropTargetId: null,
  };
}

export function buildSidebar(
  app: DesktopApp,
  sidebar: SidebarState,
  activeView: WorkspaceView,
  collapsed: boolean,
  actions: SidebarActions,
) {
  const projectGroups = groupSessionsByProject(app);
  const archived = readArchivedSessions(localStorage, app.workspace || '');
  updateUnreadSessions(sidebar.previousSessionStatuses, sidebar.unreadSessions, app.desktopConversations, sidebar.visibleSessionIds);

  return el('aside', { className: `sidebar ${collapsed ? 'collapsed' : ''}` }, [
    // 顶部品牌
    el('div', { className: 'sidebar-brand' }, [
      el('div', {
        className: 'sidebar-brand-main',
        title: collapsed ? '展开侧边栏' : '收缩侧边栏',
        onclick: () => actions.onToggleCollapsed(),
      }, [
        brandLogo({ className: 'sidebar-brand-logo rounded', size: 28 }),
        el('span', { className: 'sidebar-brand-name' }, ['SaCode']),
      ]),
      !collapsed
        ? el('button', {
            className: 'sidebar-icon-btn sidebar-collapse-btn',
            title: '收缩侧边栏',
            onclick: actions.onToggleCollapsed,
          }, ['‹'])
        : '',
    ].filter(Boolean) as Node[]),

    // 项目树只在展开时显示
    ...(!collapsed ? [
      el('div', { className: 'sidebar-header' }, [
        el('span', { className: 'sidebar-header-title' }, [sidebar.showArchived ? '归档' : '项目']),
        el('div', { className: 'sidebar-header-actions' }, [
          el('button', {
            className: 'sidebar-icon-btn',
            title: '新建会话',
            onclick: () => actions.onNewSession(app.workspace),
          }, ['+']),
          el('button', {
            className: `sidebar-icon-btn ${sidebar.showArchived ? 'active' : ''}`,
            title: sidebar.showArchived ? '显示当前会话' : '显示归档会话',
            onclick: () => { sidebar.showArchived = !sidebar.showArchived; actions.rerender(); },
          }, [sidebar.showArchived ? '↩' : '▤']),
        ]),
      ]),
      el('div', { className: 'sidebar-search' }, [
        el('input', {
          className: 'sidebar-search-input',
          placeholder: '搜索会话…',
          value: sidebar.searchQuery,
          oninput: (event: Event) => {
            sidebar.searchQuery = (event.target as HTMLInputElement).value;
            actions.rerender();
          },
        }),
      ]),
      el('div', { className: 'sidebar-tree' },
        projectGroups.length === 0
          ? [el('div', { className: 'sidebar-empty' }, [sidebar.showArchived ? '暂无归档会话' : '暂无会话'])]
          : projectGroups.map((group) => buildProjectGroup(group, sidebar, actions, archived)),
      ),
    ] : [el('div', { className: 'sidebar-collapsed-spacer' })]),

    // 知识库 / 自动化
    el('nav', { className: 'sidebar-nav' }, [
      el('button', {
        className: 'sidebar-nav-item',
        title: '知识库',
        onclick: () => actions.onOpenModal?.('knowledge'),
      }, [
        el('span', { className: 'sidebar-nav-icon' }, ['📚']),
        el('span', { className: 'sidebar-nav-label' }, ['知识库']),
      ]),
      el('button', {
        className: 'sidebar-nav-item',
        title: '自动化',
        onclick: () => actions.onOpenModal?.('automation'),
      }, [
        el('span', { className: 'sidebar-nav-icon' }, ['⏰']),
        el('span', { className: 'sidebar-nav-label' }, ['自动化']),
      ]),
    ]),

    // 收缩时：底部独立展开按钮（不与图标挤在一起）
    collapsed
      ? el('button', {
          className: 'sidebar-expand-btn',
          title: '展开侧边栏',
          onclick: actions.onToggleCollapsed,
        }, ['›'])
      : '',

    buildUserFooter(app, collapsed, actions.onOpenSettings, actions.onOpenProfile),

    sidebar.contextMenu ? buildSidebarContextMenu(sidebar, actions) : '',
  ].filter(Boolean) as Node[]);
}

/** 确认弹窗 — 替代 window.confirm。
 * 导出供 ui.ts 挂载到 app 根节点，避免被 .sidebar 的 overflow:hidden 裁切。 */
export function buildConfirmDialog(sidebar: SidebarState, actions: SidebarActions) {
  const dialog = sidebar.confirmDialog!;
  const panel = el('div', {
    className: `sidebar-confirm-dialog ${dialog.danger ? 'danger' : ''}`,
    onclick: (event: Event) => event.stopPropagation(),
  }, [
    el('div', { className: 'sidebar-confirm-title' }, [dialog.title]),
    el('div', { className: 'sidebar-confirm-message' }, [dialog.message]),
    el('div', { className: 'sidebar-confirm-actions' }, [
      el('button', {
        className: 'sidebar-confirm-btn cancel',
        onclick: () => {
          sidebar.confirmDialog = null;
          actions.rerender();
        },
      }, ['取消']),
      el('button', {
        className: `sidebar-confirm-btn ${dialog.danger ? 'danger' : 'primary'}`,
        onclick: () => {
          dialog.onConfirm();
          sidebar.confirmDialog = null;
          actions.rerender();
        },
      }, [dialog.confirmLabel]),
    ]),
  ]);
  // overlay 包裹 panel，确保 panel 在 overlay 之上
  const overlay = el('div', {
    className: 'sidebar-confirm-overlay',
    onclick: () => {
      sidebar.confirmDialog = null;
      actions.rerender();
    },
  });
  overlay.append(panel);
  return overlay as unknown as Node;
}

function workspaceName(path: string): string {
  return path.replace(/[\\/]+$/, '').replace(/\\/g, '/').split('/').pop() || path;
}

function buildSidebarContextMenu(sidebar: SidebarState, actions: SidebarActions) {
  const menu = sidebar.contextMenu!;
  const overlay = el('div', {
    className: 'more-menu-overlay',
    onclick: () => {
      sidebar.contextMenu = null;
      actions.rerender();
    },
    oncontextmenu: (event: Event) => {
      event.preventDefault();
      sidebar.contextMenu = null;
      actions.rerender();
    },
  });

  const askConfirm = (title: string, message: string, confirmLabel: string, danger: boolean, onConfirm: () => void) => {
    sidebar.contextMenu = null;
    sidebar.confirmDialog = { title, message, confirmLabel, danger, onConfirm };
    actions.rerender();
  };

  const items: Node[] = menu.kind === 'project'
    ? [
        el('button', {
          className: 'sidebar-menu-item',
          onclick: () => {
            actions.onNewSession(menu.path);
            sidebar.contextMenu = null;
            actions.rerender();
          },
        }, ['在此项目新建任务']),
        el('button', {
          className: 'sidebar-menu-item',
          onclick: () => {
            sidebar.renamingPath = menu.path;
            sidebar.renameValue = workspaceName(menu.path);
            sidebar.contextMenu = null;
            actions.rerender();
          },
        }, ['重命名项目']),
        el('div', { className: 'sidebar-menu-sep' }),
        el('button', {
          className: 'sidebar-menu-item danger',
          onclick: () => {
            askConfirm(
              '移除项目',
              '从侧栏移除该项目？（不会删除磁盘文件）',
              '移除',
              true,
              () => actions.onRemoveProject?.(menu.path),
            );
          },
        }, ['移除项目']),
      ]
    : [
        el('button', {
          className: 'sidebar-menu-item',
          onclick: () => {
            sidebar.contextMenu = null;
            if (menu.sessionId) actions.onRenameSession?.(menu.sessionId);
          },
        }, ['重命名会话']),
        el('button', {
          className: 'sidebar-menu-item',
          onclick: () => {
            sidebar.contextMenu = null;
            if (menu.sessionId) actions.onArchiveSession?.(menu.sessionId, !sidebar.showArchived);
          },
        }, [sidebar.showArchived ? '移出归档' : '归档会话']),
        ...(menu.sessionId && actions.canCloseSession?.(menu.sessionId) ? [el('button', {
          className: 'sidebar-menu-item',
          onclick: () => {
            sidebar.contextMenu = null;
            actions.onCloseSession?.(menu.sessionId!);
            actions.rerender();
          },
        }, ['关闭会话'])] : []),
        el('button', {
          className: 'sidebar-menu-item danger',
          onclick: () => {
            if (menu.sessionId) {
              askConfirm(
                '删除会话',
                '删除该会话？此操作不可撤销。',
                '删除',
                true,
                () => actions.onRemoveSession?.(menu.sessionId!),
              );
            }
          },
        }, ['删除会话']),
      ];

  const panel = el('div', {
    className: 'sidebar-menu',
    style: `left:${menu.x}px;top:${menu.y}px`,
  }, items);

  const fragment = document.createDocumentFragment();
  fragment.append(overlay, panel);
  return fragment as unknown as Node;
}

function buildUserFooter(
  app: DesktopApp,
  collapsed: boolean,
  onOpenSettings: () => void,
  onOpenProfile?: () => void,
) {
  const nickname = localStorage.getItem('sacode.user.nickname')?.trim() || 'SaCode 用户';
  const initial = nickname.slice(0, 1).toUpperCase();
  const connectionClass = app.health?.status === 'healthy'
    ? 'online'
    : app.health?.status === 'degraded'
    ? 'error'
    : 'connecting';

  return el('div', { className: 'sidebar-user' }, [
    el('div', {
      className: 'sidebar-user-avatar-wrap clickable',
      title: collapsed ? `${nickname} · 个人信息` : '个人信息',
      onclick: () => onOpenProfile?.(),
    }, [
      el('span', { className: 'sidebar-user-avatar' }, [initial]),
      el('span', { className: `sidebar-user-status ${connectionClass}` }),
    ]),
    el('span', {
      className: 'sidebar-user-name clickable',
      title: '个人信息',
      onclick: () => onOpenProfile?.(),
    }, [nickname]),
    el('button', {
      className: 'sidebar-user-settings',
      title: '设置',
      onclick: onOpenSettings,
    }, ['⚙']),
  ]);
}

function navButton(
  view: WorkspaceView,
  icon: string,
  label: string,
  activeView: WorkspaceView,
  collapsed: boolean,
  onChange: (view: WorkspaceView) => void,
) {
  return el('button', {
    className: `sidebar-nav-item ${activeView === view ? 'active' : ''}`,
    title: collapsed ? label : '',
    onclick: () => onChange(view),
  }, [
    el('span', { className: 'sidebar-nav-icon' }, [icon]),
    el('span', { className: 'sidebar-nav-label' }, [label]),
  ]);
}

interface ProjectGroup {
  name: string;
  path: string;
  sessions: SessionEntry[];
}

interface SessionEntry {
  id: string;
  title: string;
  status: string;
}

function groupSessionsByProject(app: DesktopApp): ProjectGroup[] {
  const workspaceName = app.workspace
    ? app.workspace.replace(/\\/g, '/').split('/').pop() || app.workspace
    : '未命名项目';
  const queryableSessions: SessionEntry[] = sortSessions(
    app.desktopConversations.map((session) => ({
      id: session.id,
      title: (localStorage.getItem(`sacode.session.title.${session.id}`) || session.title).slice(0, 60) || session.id.slice(0, 8),
      status: session.status,
    })),
    app.workspace || '',
  );

  return [{
    name: workspaceName,
    path: app.workspace || '',
    sessions: queryableSessions,
  }];
}

/** 按 localStorage 中当前项目保存的自定义顺序排序，未知 id 追加在末尾。 */
function sortSessions(sessions: SessionEntry[], projectPath: string): SessionEntry[] {
  const key = `sacode.session.order.${projectPath}`;
  let stored: string[] = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    if (Array.isArray(parsed)) stored = parsed.filter((id): id is string => typeof id === 'string');
  } catch {
    stored = [];
  }
  if (stored.length === 0) return sessions;
  const rank = new Map(stored.map((id, index) => [id, index]));
  return sessions
    .map((session, index) => ({ session, rank: rank.get(session.id) ?? Number.MAX_SAFE_INTEGER, index }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.session);
}

function buildProjectGroup(
  group: ProjectGroup,
  sidebar: SidebarState,
  actions: SidebarActions,
  archived: ReadonlySet<string>,
) {
  // expandedProjects 只在用户显式折叠时删除，未折叠的项目保持展开。
  const isExpanded = !sidebar.expandedProjects.has(group.path);
  const search = sidebar.searchQuery.trim().toLowerCase();
  const sessions = group.sessions.filter((session) => archived.has(session.id) === sidebar.showArchived
    && (!search || session.title.toLowerCase().includes(search)));

  const openMenu = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    sidebar.contextMenu = {
      x: event.clientX,
      y: event.clientY,
      kind: 'project',
      path: group.path,
    };
    actions.rerender();
  };

  return el('div', { className: 'project-group' }, [
    sidebar.renamingPath === group.path
      ? el('div', { className: 'project-row' }, [
          el('input', {
            className: 'sidebar-rename-input',
            value: sidebar.renameValue,
            autofocus: true,
            oninput: (event: Event) => { sidebar.renameValue = (event.target as HTMLInputElement).value; },
            onkeydown: (event: KeyboardEvent) => {
              if (event.key === 'Enter') {
                actions.onRenameProject?.(group.path, sidebar.renameValue.trim() || group.name);
                sidebar.renamingPath = null;
                actions.rerender();
              }
              if (event.key === 'Escape') {
                sidebar.renamingPath = null;
                actions.rerender();
              }
            },
            onblur: () => {
              if (sidebar.renamingPath === group.path) {
                actions.onRenameProject?.(group.path, sidebar.renameValue.trim() || group.name);
                sidebar.renamingPath = null;
                actions.rerender();
              }
            },
          }),
        ])
      : el('div', {
          className: 'project-row',
          onclick: () => {
            if (sidebar.expandedProjects.has(group.path)) sidebar.expandedProjects.delete(group.path);
            else sidebar.expandedProjects.add(group.path);
            actions.rerender();
          },
          oncontextmenu: openMenu,
        }, [
          el('span', { className: `project-chevron ${isExpanded ? 'expanded' : ''}` }, ['▶']),
          el('span', { className: 'project-icon' }, ['📂']),
          el('span', { className: 'project-name' }, [group.name]),
          el('span', { className: 'project-badge' }, [String(sessions.length)]),
          el('button', {
            className: 'project-new-session',
            title: `在 ${group.name} 中新建会话`,
            onclick: (event: Event) => {
              event.stopPropagation();
              actions.onNewSession(group.path);
            },
          }, ['+']),
        ]),
    ...(isExpanded
      ? [el('div', { className: 'session-list-children' },
          sessions.length === 0
            ? [el('div', { className: 'sidebar-session-empty' }, [sidebar.showArchived ? '暂无归档会话' : '暂无会话'])]
            : sessions.map((session) => buildSessionItem(session, sidebar, actions, group.path)),
        )]
      : []),
  ]);
}

function buildSessionItem(
  session: SessionEntry,
  sidebar: SidebarState,
  actions: SidebarActions,
  projectPath: string,
) {
  const isActive = sidebar.activeSessionId === session.id;
  const dotClass = session.status === 'running' || session.status === 'pending' || session.status === 'ready' || session.status === 'retrying'
    ? 'running'
    : session.status === 'failed' || session.status === 'cancelled'
    ? 'failed'
    : 'completed';

  const startDrag = (event: PointerEvent) => {
    // 鼠标左键按住并移动超过阈值后再进入排序，既保留普通点击切换会话，
    // 也避免与文本选择、滚动条等默认手势冲突。
    if (event.button !== 0) return;
    if (event.pointerType === 'mouse' && event.target instanceof Element
        && event.target.closest('.session-title')) {
      // 标题区域允许直接拖拽，其他区域（如状态点）走点击语义
    }
    const startX = event.clientX;
    const startY = event.clientY;
    let started = false;
    let lastTarget: HTMLElement | null = null;
    const source: HTMLElement = event.currentTarget as HTMLElement;

    const clearMarker = () => {
      document.querySelectorAll('.session-item.drop-target').forEach((node) => node.classList.remove('drop-target'));
      lastTarget = null;
    };

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (!started) {
        if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 6) return;
        started = true;
        sidebar.dragSessionId = session.id;
        source.classList.add('dragging');
        source.setPointerCapture?.(moveEvent.pointerId);
      }
      const over = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
      const item = over?.closest('.session-item') as HTMLElement | null;
      if (!item || item === source) return;
      if (lastTarget !== item) {
        clearMarker();
        lastTarget = item;
        item.classList.add('drop-target');
      }
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      source.classList.remove('dragging');
      if (started) {
        clearMarker();
        const over = document.elementFromPoint(upEvent.clientX, upEvent.clientY);
        const item = over?.closest('.session-item') as HTMLElement | null;
        const fromId = sidebar.dragSessionId;
        const toId = item?.dataset.sessionId ?? null;
        sidebar.dragSessionId = null;
        sidebar.dropTargetId = null;
        // 仅同项目内排序：跨分组的目标不在同一 session-list-children 下则忽略。
        if (fromId && toId && fromId !== toId && item!.parentElement === source.parentElement) {
          actions.onReorderSessions?.(projectPath, fromId, toId);
        } else {
          actions.rerender();
        }
      }
    };

    const onPointerCancel = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      source.classList.remove('dragging');
      clearMarker();
      sidebar.dragSessionId = null;
      sidebar.dropTargetId = null;
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
  };

  return el('div', {
    className: `session-item ${isActive ? 'active' : ''} ${sidebar.unreadSessions.has(session.id) ? 'unread' : ''}`,
    dataset: { sessionId: session.id },
    onpointerdown: startDrag,
    onclick: () => {
      if (sidebar.dragSessionId) return;
      sidebar.activeSessionId = session.id;
      sidebar.unreadSessions.delete(session.id);
      actions.onSelectSession?.(session.id);
      actions.onViewChange('agent');
      void actions.rerender();
    },
    oncontextmenu: (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      sidebar.contextMenu = {
        x: event.clientX,
        y: event.clientY,
        kind: 'session',
        path: '',
        sessionId: session.id,
      };
      actions.rerender();
    },
  }, [
    el('span', { className: `session-dot ${dotClass}` }),
    el('span', { className: 'session-title' }, [session.title]),
    ...(sidebar.unreadSessions.has(session.id) ? [el('span', { className: 'session-unread', title: '有未读结果' }, ['●'])] : []),
  ]);
}
