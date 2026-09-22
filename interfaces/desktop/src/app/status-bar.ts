/** StatusBar — 底部状态条 */
import { el } from '../dom.ts';
import type { DesktopApp } from './service.ts';

export function buildStatusBar(app: DesktopApp) {
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
      el('span', { className: 'muted' }, ['mode:']),
      el('span', { className: 'mono' }, [app.mode]),
    ]),

    // 右侧填充
    el('span', { className: 'statusbar-spacer' }, []),

    el('span', { className: 'statusbar-item' }, [
      el('span', { className: 'muted' }, ['git:']),
      el('span', { className: 'mono' }, ['dev']),
    ]),

    app.currentTaskId
      ? el('span', { className: 'statusbar-item' }, [
          el('span', { className: 'muted' }, ['task:']),
          el('span', { className: 'mono' }, [app.currentTaskId.slice(0, 8)]),
        ])
      : '',
  ].filter(Boolean) as Node[]);
}
