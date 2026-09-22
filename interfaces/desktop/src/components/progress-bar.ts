/** ProgressBar — 顶部 2px 进度条 */
import { el } from '../dom.ts';

export type ProgressState = 'idle' | 'running' | 'approval' | 'done';

export function buildProgressBar(state: ProgressState) {
  const active = state === 'running' || state === 'approval';
  const dataset = state === 'approval' ? { state: 'approval' } : {};

  return el('div', {
    className: `progress-bar ${active ? 'active' : ''}`,
    ...(Object.keys(dataset).length ? { dataset } : {}),
  }, [
    el('div', { className: 'progress-bar-fill' }),
  ]);
}
