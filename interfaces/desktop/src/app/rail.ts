/** Rail — 64px 图标轨：SaCode、SaDesign、设置、帮助 */
import { el } from '../dom.ts';
import type { DesktopApp } from './service.ts';

export type WorkspaceView = 'agent' | 'design';

export function buildRail(
  app: DesktopApp,
  activeView: WorkspaceView,
  onViewChange: (view: WorkspaceView) => void,
) {
  return el('nav', { className: 'rail' }, [
    el('div', { className: 'rail-logo' }, [
      el('span', { className: 'rail-logo-text' }, ['S']),
    ]),
    el('div', { className: 'rail-items' }, [
      el('button', {
        className: `rail-btn ${activeView === 'agent' ? 'active' : ''}`,
        title: 'SaCode Agent',
        onclick: () => onViewChange('agent'),
      }, ['A']),
      el('button', {
        className: `rail-btn ${activeView === 'design' ? 'active' : ''}`,
        title: 'SaDesign',
        onclick: () => {
          onViewChange('design');
          void app.refreshDesignData();
        },
      }, ['◇']),
      el('button', {
        className: 'rail-btn',
        title: '新建任务',
        onclick: () => {
          if (activeView === 'design') onViewChange('design');
          else app.onChange?.();
        },
      }, ['+']),
    ]),
    el('div', { className: 'rail-bottom' }, [
      el('button', {
        className: 'rail-btn',
        title: '设置',
      }, ['⚙']),
      el('button', {
        className: 'rail-btn',
        title: '帮助',
      }, ['?']),
    ]),
  ]);
}
