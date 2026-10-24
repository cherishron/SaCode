'use strict';
const { randomUUID } = require('node:crypto');
const ownerFields = ['sessionId', 'projectId'];
const bad = code => { throw Error('browser-view-' + code); };
function record(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) bad('arguments');
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => !keys.includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))) bad('arguments');
}
function validUrl(value) {
  if (typeof value !== 'string' || value.length > 8192 || /[\x00-\x20\x7f]/.test(value)) bad('url');
  let url; try { url = new URL(value); } catch { bad('url'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) bad('url');
  return url;
}
function registerBrowserViewIpc({ ipcMain, WebContentsView, session, getWindow }) {
  let current = null;
  const windows = new WeakSet();
  function close() {
    const state = current; current = null;
    if (!state) return;
    state.disposed = true;
    clearTimeout(state.timer);
    if (state.finish) state.finish(false);
    state.win.contentView.removeChildView(state.view);
    if (!state.view.webContents.isDestroyed()) state.view.webContents.close({ waitForBeforeUnload: false });
    void state.session.closeAllConnections().then(() => state.session.clearStorageData()).catch(() => {});
  }
  function check(event, args, extra = []) {
    const win = getWindow();
    if (!win || win.isDestroyed() || event?.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) bad('sender');
    record(args, [...ownerFields, ...extra]);
    for (const key of ownerFields) if (typeof args[key] !== 'string' || !args[key] || args[key].length > 32768 || /[\x00-\x1f]/.test(args[key])) bad('arguments');
    return win;
  }
  function target(args) {
    if (!current || current.disposed || current.view.webContents.isDestroyed() || ownerFields.some(key => current[key] !== args[key])) bad('owner');
    return current;
  }
  const page = state => {
    const wc = state.view.webContents;
    return { url: wc.getURL(), title: wc.getTitle().slice(0, 512), canGoBack: wc.navigationHistory.canGoBack(), canGoForward: wc.navigationHistory.canGoForward() };
  };
  function reply(state) {
    return { ok: !state.failure, page: page(state), failureKind: state.failure || '', loading: state.busy };
  }
  const allowed = (state, value) => {
    try { return !state.disposed && !!state.origin && validUrl(value).origin === state.origin; } catch { return false; }
  };
  function open(win, args) {
    if (current && ownerFields.every(key => current[key] === args[key]) && !current.view.webContents.isDestroyed()) return reply(current);
    close();
    const isolated = session.fromPartition('browser-view-' + randomUUID());
    isolated.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    isolated.setPermissionCheckHandler(() => false);
    isolated.setDevicePermissionHandler(() => false);
    isolated.on('will-download', (event, item) => { event.preventDefault(); item.cancel(); });
    const view = new WebContentsView({ webPreferences: { session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, webviewTag: false, navigateOnDragDrop: false, safeDialogs: true, disableDialogs: true } });
    const state = { ...args, win, session: isolated, view, origin: '', failure: '', busy: false, disposed: false, finish: null, timer: null };
    current = state;
    isolated.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !allowed(state, details.url) }));
    const wc = view.webContents;
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-attach-webview', event => event.preventDefault());
    const guard = (event, url) => {
      if (!allowed(state, url)) { event.preventDefault(); state.failure = 'navigation-blocked'; }
    };
    wc.on('will-navigate', guard);
    wc.on('will-frame-navigate', event => guard(event, event.url));
    wc.on('will-redirect', guard);
    wc.on('did-fail-load', (_e, code, _text, _url, mainFrame) => {
      if (mainFrame && code !== -3) state.failure = 'navigation-failed';
    });
    wc.on('render-process-gone', () => { state.failure = 'view-crashed'; if (state.finish) state.finish(false); });
    wc.on('destroyed', () => { if (state.finish) state.finish(false); });
    view.setVisible(false);
    win.contentView.addChildView(view);
    if (!windows.has(win)) {
      windows.add(win);
      win.on('closed', () => { if (current?.win === win) close(); });
      win.webContents.on('render-process-gone', () => { if (current?.win === win) close(); });
      win.webContents.on('did-start-navigation', (_e, _url, _inPlace, mainFrame) => { if (mainFrame && current?.win === win) close(); });
      win.on('resize', () => { if (current?.win === win) current.view.setVisible(false); });
      win.on('minimize', () => { if (current?.win === win) current.view.setVisible(false); });
    }
    return reply(state);
  }
  async function operate(state, action, url) {
    if (state.busy) bad('busy');
    const wc = state.view.webContents;
    if (action === 'Back' && !wc.navigationHistory.canGoBack() || action === 'Forward' && !wc.navigationHistory.canGoForward()) return reply(state);
    if (action !== 'Navigate' && !wc.getURL()) bad('page');
    state.busy = true; state.failure = '';
    return new Promise(resolve => {
      const stopped = () => finish(true);
      const finish = success => {
        if (!state.finish) return;
        state.finish = null; clearTimeout(state.timer); wc.removeListener('did-stop-loading', stopped); state.busy = false;
        if (!success || state.disposed || wc.isDestroyed()) resolve({ ok: false, failureKind: state.failure || 'navigation-unknown' });
        else resolve(reply(state));
      };
      state.finish = finish;
      wc.once('did-stop-loading', stopped);
      state.timer = setTimeout(() => { state.failure = 'navigation-timeout'; wc.stop(); finish(false); }, 20000);
      try {
        if (action === 'Navigate') {
          state.origin = url.origin;
          Promise.resolve(wc.loadURL(url.href)).then(() => { if (!wc.isLoading()) finish(true); }, () => { state.failure ||= 'navigation-failed'; finish(false); });
        } else if (action === 'Reload') wc.reload();
        else {
          const entries = wc.navigationHistory.getAllEntries();
          const index = wc.navigationHistory.getActiveIndex() + (action === 'Back' ? -1 : 1);
          state.origin = validUrl(entries[index].url).origin;
          wc.navigationHistory[action === 'Back' ? 'goBack' : 'goForward']();
        }
      } catch { state.failure = 'navigation-failed'; finish(false); }
    });
  }
  ipcMain.handle('sacode:browserViewOpen', (event, args) => open(check(event, args), args));
  ipcMain.handle('sacode:browserViewNavigate', (event, args) => {
    check(event, args, ['url']);
    return operate(target(args), 'Navigate', validUrl(args.url));
  });
  ipcMain.handle('sacode:browserViewBack', (event, args) => { check(event, args); return operate(target(args), 'Back'); });
  ipcMain.handle('sacode:browserViewForward', (event, args) => { check(event, args); return operate(target(args), 'Forward'); });
  ipcMain.handle('sacode:browserViewReload', (event, args) => { check(event, args); return operate(target(args), 'Reload'); });
  ipcMain.handle('sacode:browserViewDescribe', (event, args) => { check(event, args); return reply(target(args)); });
  ipcMain.handle('sacode:browserViewClose', (event, args) => { check(event, args); target(args); close(); return { ok: true }; });
  ipcMain.handle('sacode:browserViewLayout', (event, args) => {
    const win = check(event, args, ['visible', 'bounds']);
    if (typeof args.visible !== 'boolean') bad('arguments');
    record(args.bounds, ['x', 'y', 'width', 'height']);
    if (Object.values(args.bounds).some(value => !Number.isSafeInteger(value) || value < 0 || value > 32768)) bad('arguments');
    const state = target(args), size = win.getContentBounds();
    const x = Math.min(args.bounds.x, size.width), y = Math.min(args.bounds.y, size.height);
    const bounds = { x, y, width: Math.min(args.bounds.width, size.width - x), height: Math.min(args.bounds.height, size.height - y) };
    state.view.setBounds(bounds);
    state.view.setVisible(args.visible && bounds.width > 0 && bounds.height > 0 && !win.isMinimized());
    return { ok: true };
  });
  return { dispose: close };
}
module.exports = { registerBrowserViewIpc };
