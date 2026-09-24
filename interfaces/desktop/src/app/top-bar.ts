/** TopBar — 顶部信息条：项目名 · 分支 · Agent · 模式 · 运行状态 · 设置 */
import { el } from '../dom.ts';
import type { DesktopApp } from './service.ts';
import type { AppShellState } from './app-shell.ts';
import type { WorkspaceView } from './rail.ts';

export function buildTopBar(app: DesktopApp, shell: AppShellState, activeView: WorkspaceView = 'agent') {
  const healthClass =
    shell.connection === 'healthy' ? 'ok' :
    shell.connection === 'checking' ? 'warn' : 'bad';

  const statusDot = el('span', {
    className: `status-dot ${healthClass}`,
  });

  const statusText = shell.connection === 'healthy'
    ? 'Running'
    : shell.connection === 'checking'
    ? 'Starting…'
    : 'Disconnected';

  const agentLabel = app.agents.length > 0
    ? (app.agents.find(a => a.id === app.defaultBackend)?.display_name || app.defaultBackend)
    : 'No agent';

  return el('header', { className: 'topbar' }, [
    // 左：项目 + 分支
    el('div', { className: 'topbar-left' }, [
      el('span', { className: 'topbar-project truncate' }, [
        activeView === 'design' ? 'SaDesign' : (app.workspace || 'No workspace'),
      ]),
      el('span', { className: 'topbar-sep' }, ['·']),
      el('span', { className: 'topbar-branch mono' }, [activeView === 'design' ? 'Design Workspace' : 'dev']),
    ]),

    // 中：Agent + 模式
    el('div', { className: 'topbar-center' }, [
      el('span', { className: 'badge accent' }, [activeView === 'design' ? 'SaDesign' : agentLabel]),
      el('span', { className: 'badge' }, [app.mode === 'tauri' ? 'Tauri' : 'Vite']),
    ]),

    // 右：运行状态 + 设置
    el('div', { className: 'topbar-right' }, [
      el('span', { className: 'topbar-status' }, [
        statusDot,
        el('span', { className: 'muted' }, [statusText]),
      ]),
      el('button', {
        className: 'btn ghost topbar-btn-icon',
        title: '设置',
        onclick: () => { shell.sidebarOpen = !shell.sidebarOpen; app.onChange?.(); },
      }, ['⚙']),
    ]),
  ]);
}
