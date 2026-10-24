import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
const require = createRequire(import.meta.url);
const owner = { sessionId: 's1', projectId: 'project-one' };
function fixture() {
  const sessions = [], views = [], handlers = new Map();
  class Contents extends EventEmitter {
    destroyed = false; url = ''; title = ''; history = []; index = -1;
    navigationHistory = {
      canGoBack: () => this.index > 0, canGoForward: () => this.index < this.history.length - 1,
      getAllEntries: () => this.history.map(url => ({ url })), getActiveIndex: () => this.index,
      goBack: () => { this.url = this.history[--this.index]; this.emit('did-stop-loading'); },
      goForward: () => { this.url = this.history[++this.index]; this.emit('did-stop-loading'); },
    };
    isDestroyed() { return this.destroyed; }
    getURL() { return this.url; } getTitle() { return this.title; }
    isLoading() { return false; }
    async loadURL(url) { this.url = url; this.title = '真实标题'; this.history = this.history.slice(0, this.index + 1); this.history.push(url); this.index++; this.emit('did-stop-loading'); }
    reload() { this.emit('did-stop-loading'); }
    stop() {} close() { this.destroyed = true; this.emit('destroyed'); }
    setWindowOpenHandler(fn) { this.openWindow = fn; }
  }
  class View {
    constructor(options) { this.options = options; this.webContents = new Contents(); views.push(this); }
    setVisible(value) { this.visible = value; } setBounds(value) { this.bounds = value; }
  }
  const win = new EventEmitter(); win.webContents = new Contents(); win.webContents.mainFrame = {};
  win.isDestroyed = () => false; win.isMinimized = () => false; win.getContentBounds = () => ({ width: 1000, height: 800 });
  const children = new Set(); win.contentView = { addChildView: v => children.add(v), removeChildView: v => children.delete(v) };
  const session = { fromPartition(partition) {
    const value = { partition, setPermissionRequestHandler(fn) { this.permission = fn; }, setPermissionCheckHandler(fn) { this.check = fn; }, setDevicePermissionHandler(fn) { this.device = fn; }, on: EventEmitter.prototype.on, _events: {}, webRequest: { onBeforeRequest(fn) { value.request = fn; } }, closeAllConnections: async () => {}, clearStorageData: async () => {} };
    sessions.push(value); return value;
  } };
  const path = '../../browser-view.cjs';
  assert.ok(existsSync(new URL(path, import.meta.url)), '内置浏览器控制器尚未实现');
  const { registerBrowserViewIpc } = require(path);
  const controller = registerBrowserViewIpc({ ipcMain: { handle: (key, fn) => handlers.set(key, fn) }, WebContentsView: View, session, getWindow: () => win });
  const event = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  const call = (action, args = {}) => handlers.get('sacode:browserView' + action)(event, { ...owner, ...args });
  return { views, sessions, win, children, handlers, controller, call, event };
}
test('人工浏览创建隔离视图并只返回真实页面与历史状态', async () => {
  const f = fixture();
  await f.call('Open');
  assert.equal(f.views.length, 1); assert.equal(f.views[0].visible, false);
  const preferences = f.views[0].options.webPreferences;
  assert.equal(preferences.sandbox, true); assert.equal(preferences.contextIsolation, true); assert.equal(preferences.nodeIntegration, false);
  assert.equal(preferences.preload, undefined); assert.ok(!f.sessions[0].partition.startsWith('persist:'));
  const first = await f.call('Navigate', { url: 'https://one.test/a' });
  assert.equal(first.page.url, 'https://one.test/a'); assert.equal(first.page.title, '真实标题'); assert.equal(first.page.canGoBack, false);
  await f.call('Navigate', { url: 'https://one.test/b' });
  assert.equal((await f.call('Back')).page.url, 'https://one.test/a');
  assert.equal((await f.call('Forward')).page.url, 'https://one.test/b');
  await f.call('Close'); assert.equal(f.children.size, 0); assert.equal(f.views[0].webContents.destroyed, true);
});
test('拒绝外部来源和子框架 IPC，非法参数不创建视图', async () => {
  const f = fixture(), handler = f.handlers.get('sacode:browserViewOpen');
  assert.throws(() => handler({ sender: {}, senderFrame: {} }, owner), /browser-view-sender/);
  assert.throws(() => handler({ ...f.event, senderFrame: {} }, owner), /browser-view-sender/);
  for (const args of [{ ...owner, extra: true }, { ...owner, sessionId: '' }]) assert.throws(() => handler(f.event, args), /browser-view-arguments/);
  assert.equal(f.views.length, 0);
});
test('危险 URL、跨域重定向、下载、权限与新窗口均被拒绝', async () => {
  const f = fixture(); await f.call('Open');
  for (const url of ['file:///secret', 'javascript:alert(1)', 'https://user:password@one.test/', 'data:text/html,x']) await assert.rejects(async () => f.call('Navigate', { url }), /browser-view-url/);
  await f.call('Navigate', { url: 'https://one.test/a' });
  const wc = f.views[0].webContents, ses = f.sessions[0];
  let prevented = false; wc.emit('will-redirect', { preventDefault: () => { prevented = true; } }, 'https://other.test/'); assert.equal(prevented, true);
  assert.deepEqual(wc.openWindow(), { action: 'deny' });
  let permission; ses.permission(wc, 'media', value => { permission = value; }); assert.equal(permission, false); assert.equal(ses.check(), false); assert.equal(ses.device(), false);
  let cancelled = false; ses.emit = EventEmitter.prototype.emit; ses.emit('will-download', { preventDefault() {} }, { cancel: () => { cancelled = true; } }); assert.equal(cancelled, true);
  let request; ses.request({ url: 'http://127.0.0.1/private', resourceType: 'xhr' }, result => { request = result; }); assert.deepEqual(request, { cancel: true });
});
test('布局裁剪在窗口内、隐藏不销毁，旧归属不能驱动新视图', async () => {
  const f = fixture(); await f.call('Open');
  await f.call('Layout', { visible: true, bounds: { x: 900, y: 700, width: 300, height: 300 } });
  assert.deepEqual(f.views[0].bounds, { x: 900, y: 700, width: 100, height: 100 }); assert.equal(f.views[0].visible, true);
  await f.call('Layout', { visible: false, bounds: { x: 0, y: 0, width: 0, height: 0 } }); assert.equal(f.views[0].visible, false); assert.equal(f.views[0].webContents.destroyed, false);
  await f.call('Open', { projectId: 'project-two' }); assert.equal(f.views[0].webContents.destroyed, true);
  await assert.rejects(async () => f.call('Navigate', { url: 'https://one.test/' }), /browser-view-owner/);
  f.win.emit('closed'); assert.equal(f.views[1].webContents.destroyed, true); assert.equal(f.children.size, 0);
});
