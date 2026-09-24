/** Sidebar — 240px 可折叠侧栏：项目信息、Daemon/Agents、Sessions、诊断
 * Phase 4: 会话点击过滤、状态透传
 */
import { el } from '../dom.ts';
import type { DesktopApp } from './service.ts';
import { buildSessionList, type SessionItem } from '../components/session-list.ts';

export interface SidebarCallbacks {
  onSessionSelect: (taskId: string | null) => void;
}

export function buildSidebar(
  app: DesktopApp,
  state: { activeTaskFilter: string | null },
  rerender: () => void,
) {
  const sessions = app.tasks.map((task) => ({
    id: task.task_id,
    title: task.prompt.slice(0, 60) || task.task_id.slice(0, 8),
    status: sessionStatus(task.status),
    updatedAt: formatTaskTime(task.created_at),
  }));

  return el('aside', { className: 'sidebar' }, [
    // 项目信息区
    el('div', { className: 'sidebar-section' }, [
      el('div', { className: 'sidebar-title' }, ['Workspace']),
      el('label', {}, [
        '路径',
        el('input', {
          id: 'workspace',
          className: 'input',
          value: app.workspace || '',
          placeholder: '项目根目录（默认自动）',
        }),
      ]),
      el('div', { className: 'sidebar-row' }, [
        el('button', { id: 'btn-init', className: 'btn' }, ['启动 Daemon']),
        el('button', { id: 'btn-stop-sidecar', className: 'btn ghost' }, ['停止']),
      ]),
    ]),

    // Daemon / Agents 区
    el('div', { className: 'sidebar-section' }, [
      el('div', { className: 'sidebar-title' }, ['Daemon / Agents']),
      el('div', { className: 'muted' }, [
        app.handle
          ? `${app.handle.base_url} · auth=${app.handle.auth_required}`
          : 'Vite 代理或未启动',
      ]),
      el('div', { id: 'agents', className: 'agent-list' },
        app.agents.length === 0
          ? [el('div', { className: 'muted' }, ['No agents'])]
          : app.agents.map((a) =>
              el('div', { className: 'agent-item' }, [
                el('span', { className: 'agent-dot' }),
                el('span', { className: 'truncate' }, [a.display_name || a.id]),
                a.id === app.defaultBackend
                  ? el('span', { className: 'badge accent' }, ['默认'])
                  : '',
              ].filter(Boolean) as Node[]),
            ),
      ),
    ]),

    // Sessions 区 — 点击过滤 timeline
    el('div', { className: 'sidebar-section flex-1' }, [
      el('div', { className: 'sidebar-title sidebar-title-row' }, [
        'Sessions',
        ...(state.activeTaskFilter
          ? [el('button', {
              className: 'sidebar-clear-btn',
              title: '清除过滤（Esc）',
              onclick: () => {
                state.activeTaskFilter = null;
                rerender();
              },
            }, ['显示全部'])]
          : []),
      ]),
      buildSessionListEl(app, sessions, state, rerender),
    ]),

    // 诊断区
    el('div', { className: 'sidebar-section' }, [
      el('div', { className: 'sidebar-title' }, ['Diagnostics']),
      el('div', { className: 'sidebar-row' }, [
        el('button', { id: 'btn-health', className: 'btn ghost' }, ['Health']),
        el('button', { id: 'btn-agents', className: 'btn ghost' }, ['刷新']),
        el('button', { id: 'btn-diag', className: 'btn ghost' }, ['诊断']),
      ]),
    ]),
  ]);
}

/** SessionList 包装：点击设置过滤器 */
function buildSessionListEl(
  app: DesktopApp,
  sessions: SessionItem[],
  state: { activeTaskFilter: string | null },
  rerender: () => void,
) {
  const list = buildSessionList(sessions, state.activeTaskFilter ?? undefined);
  // 为每个 session-item 绑定点击
  list.querySelectorAll<HTMLElement>('.session-item').forEach((itemEl, idx) => {
    const session = sessions[idx];
    if (!session) return;
    itemEl.addEventListener('click', () => {
      // 再次点击同一个 = 取消过滤
      state.activeTaskFilter = state.activeTaskFilter === session.id ? null : session.id;
      if (state.activeTaskFilter) void app.selectTask(session.id);
      rerender();
    });
  });
  return list;
}

function sessionStatus(status: string): SessionItem['status'] {
  if (status === 'failed') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'completed') return 'completed';
  return 'active';
}

function formatTaskTime(createdAt: string): string {
  const parsed = Date.parse(createdAt);
  if (Number.isNaN(parsed)) return createdAt;
  return new Date(parsed).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
