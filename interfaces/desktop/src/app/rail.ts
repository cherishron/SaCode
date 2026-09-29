/** Rail — 左侧 48px 图标轨：SaCode、SaDesign、SaNative、设置 */
import { el } from '../dom.ts';
import type { DesktopApp } from './service.ts';
import { brandLogo } from '../brand.ts';

export type WorkspaceView = 'agent' | 'design' | 'native' | 'automation';

export function buildRail(
  app: DesktopApp,
  activeView: WorkspaceView,
  onViewChange: (view: WorkspaceView) => void,
  onOpenSettings?: () => void,
) {
  return el('nav', { className: 'rail' }, [
    el('div', { className: 'rail-logo' }, [
      brandLogo({ className: 'rounded', size: 28 }),
    ]),
    el('div', { className: 'rail-items' }, [
      el('button', {
        className: `rail-btn ${activeView === 'agent' ? 'active' : ''}`,
        title: 'SaCode 会话',
        onclick: () => onViewChange('agent'),
      }, ['💬']),
      el('button', {
        className: `rail-btn ${activeView === 'design' ? 'active' : ''}`,
        title: 'SaDesign 设计',
        onclick: () => {
          onViewChange('design');
          void app.refreshDesignData();
        },
      }, ['◇']),
      el('button', {
        className: `rail-btn ${activeView === 'native' ? 'active' : ''}`,
        title: 'SaNative 知识库',
        onclick: () => onViewChange('native'),
      }, ['📚']),
      el('button', {
        className: `rail-btn ${activeView === 'automation' ? 'active' : ''}`,
        title: '自动化',
        onclick: () => onViewChange('automation'),
      }, ['⏰']),
    ]),
    el('div', { className: 'rail-bottom' }, [
      el('button', {
        className: 'rail-btn-icon',
        title: '设置',
        onclick: () => onOpenSettings?.(),
      }, ['⚙']),
    ]),
  ]);
}
