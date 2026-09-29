import { DesktopApp } from './app/service.ts';
import { mountApp } from './app/ui.ts';
import { isTauri } from './tauri-bridge.ts';

import './styles/base.css';
import './components/components.css';
import './app/app-shell.css';
import './app/top-bar.css';
import './app/sidebar.css';
import './app/new-task-dialog.css';
import './app/settings.css';
import './app/conversation.css';
import './app/context-panel.css';
import './app/status-bar.css';
import './app/sadesign.css';
import './app/splash.css';
import './app/sanative.css';
import './app/automation.css';

// Tauri WebView 不显示浏览器自带的「检查/调试」右键菜单；
// 现有侧栏自定义右键菜单仍会收到 contextmenu 事件。
if (isTauri()) {
  window.addEventListener('contextmenu', (event) => event.preventDefault());
}

// Global error trap — if anything throws during mount, show it on screen
// instead of leaving the user with a blank white window.
window.addEventListener('error', (event) => {
  const root = document.querySelector<HTMLDivElement>('#app');
  if (root && root.children.length === 0) {
    root.innerHTML = '';
    const pre = document.createElement('pre');
    pre.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;background:#1a1a2e;color:#ff6b6b;font:14px monospace;padding:24px;white-space:pre-wrap;overflow:auto';
    pre.textContent = `Fatal error:\n${event.error?.stack || event.message}`;
    root.appendChild(pre);
  }
});
window.addEventListener('unhandledrejection', (event) => {
  const root = document.querySelector<HTMLDivElement>('#app');
  if (root && root.children.length === 0) {
    root.innerHTML = '';
    const pre = document.createElement('pre');
    pre.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;background:#1a1a2e;color:#ffb347;font:14px monospace;padding:24px;white-space:pre-wrap;overflow:auto';
    pre.textContent = `Unhandled rejection:\n${event.reason?.stack || String(event.reason)}`;
    root.appendChild(pre);
  }
});

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('#app missing');

const app = new DesktopApp();
mountApp(root, app);
