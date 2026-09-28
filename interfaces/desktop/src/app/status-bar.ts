/** StatusBar — 底部状态条 */
import { el } from '../dom.ts';
import type { DesktopApp } from './service.ts';

import type { WorkspaceView } from './rail.ts';

export function buildStatusBar(app: DesktopApp, activeView: WorkspaceView = 'agent') {
  const health = app.health;
  const healthLabel = app.healthLabel();
  const isHealthy = health?.status === 'healthy';
  const isStarting = !app.handle && app.mode === 'tauri';

  return el('footer', { className: 'statusbar' }, [
    el('span', { className: 'statusbar-item' }, [
      el('span', {
        className: `status-dot ${isHealthy ? 'ok' : isStarting ? 'warn' : 'bad'}`,
      }),
      el('span', { className: 'mono' }, [
        app.handle
          ? `${app.handle.host}:${app.handle.port}`
          : isStarting ? '启动中…' : app.mode === 'vite' && isHealthy ? '本地开发代理' : '未连接',
      ]),
    ]),

    el('span', { className: 'statusbar-sep' }, []),

    el('span', { className: 'statusbar-item' }, [
      el('span', { className: 'muted' }, ['状态:']),
      el('span', {}, [healthLabel]),
    ]),

    el('span', { className: 'statusbar-sep' }, []),

    el('span', { className: 'statusbar-item' }, [
      el('span', { className: 'muted' }, ['视图:']),
      el('span', { className: 'mono' }, [activeView === 'design' ? 'SaDesign' : 'Agent']),
    ]),

    el('span', { className: 'statusbar-spacer' }, []),

    el('span', { className: 'statusbar-item' }, [
      el('span', { className: 'muted' }, ['运行:']),
      el('span', { className: 'mono' }, [app.mode]),
    ]),

    app.currentTaskId
      ? el('span', { className: 'statusbar-item' }, [
          el('span', { className: 'muted' }, ['任务:']),
          el('span', { className: 'mono' }, [app.currentTaskId.slice(0, 8)]),
        ])
      : '',
  ].filter(Boolean) as Node[]);
}
