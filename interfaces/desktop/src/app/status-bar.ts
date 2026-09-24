/** StatusBar — 底部状态条 */
import { el } from '../dom.ts';
import type { DesktopApp } from './service.ts';

import type { WorkspaceView } from './rail.ts';

export function buildStatusBar(app: DesktopApp, activeView: WorkspaceView = 'agent') {
  const health = app.health;
  const healthLabel = app.healthLabel();
  const isHealthy = health?.status === 'healthy';

  return el('footer', { className: 'statusbar' }, [
    el('span', { className: 'statusbar-item' }, [
      el('span', {
        className: `status-dot ${isHealthy ? 'ok' : 'bad'}`,
      }),
      el('span', { className: 'mono' }, [
        app.handle
          ? `${app.handle.host}:${app.handle.port}`
          : 'no daemon',
      ]),
    ]),

    el('span', { className: 'statusbar-sep' }, []),

    el('span', { className: 'statusbar-item' }, [
      el('span', { className: 'muted' }, ['health:']),
      el('span', {}, [healthLabel]),
    ]),

    el('span', { className: 'statusbar-sep' }, []),

    el('span', { className: 'statusbar-item' }, [
      el('span', { className: 'muted' }, ['workspace:']),
      el('span', { className: 'mono' }, [activeView === 'design' ? 'SaDesign' : 'Agent']),
    ]),

    // 右侧填充
    el('span', { className: 'statusbar-spacer' }, []),

    el('span', { className: 'statusbar-item' }, [
      el('span', { className: 'muted' }, ['runtime:']),
      el('span', { className: 'mono' }, [app.mode]),
    ]),

    app.currentTaskId
      ? el('span', { className: 'statusbar-item' }, [
          el('span', { className: 'muted' }, ['task:']),
          el('span', { className: 'mono' }, [app.currentTaskId.slice(0, 8)]),
        ])
      : '',
  ].filter(Boolean) as Node[]);
}
