/** SessionList — 会话历史列表 */
import { el } from '../dom.ts';

export interface SessionItem {
  id: string;
  title: string;
  status: 'active' | 'completed' | 'failed' | 'cancelled';
  updatedAt: string;
}

export function buildSessionList(sessions: SessionItem[], activeId?: string) {
  return el('div', { className: 'session-list' },
    sessions.length === 0
      ? [el('div', { className: 'session-list-empty muted' }, ['无历史会话'])]
      : sessions.map((s) =>
          el('div', {
            className: `session-item ${s.id === activeId ? 'active' : ''}`,
          }, [
            el('span', {
              className: `session-dot session-dot-${s.status}`,
            }),
            el('div', { className: 'session-item-content' }, [
              el('div', { className: 'session-item-title truncate' }, [s.title]),
              el('div', { className: 'session-item-time muted' }, [s.updatedAt]),
            ]),
          ]),
        ),
  );
}
