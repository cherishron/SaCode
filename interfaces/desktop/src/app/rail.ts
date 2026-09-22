/** Rail — 64px 图标轨：项目、新建、Agent、设置、帮助 */
import { el } from '../dom.ts';
import type { DesktopApp } from './service.ts';

export function buildRail(app: DesktopApp) {
  return el('nav', { className: 'rail' }, [
    el('div', { className: 'rail-logo' }, [
      el('span', { className: 'rail-logo-text' }, ['S']),
    ]),
    el('div', { className: 'rail-items' }, [
      el('button', {
        className: 'rail-btn',
        title: '新建任务',
        onclick: () => { app.onChange?.(); },
      }, ['+']),
      el('button', {
        className: 'rail-btn',
        title: 'Agent 切换',
      }, ['🤖']),
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
