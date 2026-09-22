/** Splash — 启动品牌动画 */
import { el } from '../dom.ts';

export function buildSplash() {
  return el('div', { className: 'splash' }, [
    el('div', { className: 'splash-logo' }, [
      el('span', { className: 'splash-logo-text' }, ['SaCode']),
    ]),
    el('div', { className: 'splash-subtitle muted' }, ['正在启动…']),
  ]);
}

export function buildConnectionError(app: { healthLabel: () => string }) {
  return el('div', { className: 'connection-error' }, [
    el('div', { className: 'connection-error-icon' }, ['⚠']),
    el('div', { className: 'connection-error-title' }, ['无法连接 Daemon']),
    el('div', { className: 'connection-error-detail muted' }, [
      app.healthLabel(),
    ]),
    el('div', { className: 'connection-error-actions' }, [
      el('button', {
        className: 'btn',
        onclick: () => location.reload(),
      }, ['重试']),
      el('button', {
        className: 'btn ghost',
        onclick: () => {
          const json = JSON.stringify({ error: 'daemon unreachable', time: new Date().toISOString() }, null, 2);
          const blob = new Blob([json], { type: 'application/json' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `sacode-desktop-error-${Date.now()}.json`;
          a.click();
          URL.revokeObjectURL(a.href);
        },
      }, ['导出诊断']),
    ]),
  ]);
}
