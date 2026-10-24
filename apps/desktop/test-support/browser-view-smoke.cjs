'use strict';
const { app, BrowserWindow, WebContentsView, session, ipcMain } = require('electron');
const { join } = require('node:path');
const { writeFileSync } = require('node:fs');
const http = require('node:http');
const assert = require('node:assert/strict');
const { registerBrowserViewIpc } = require('../browser-view.cjs');
let win, controller, server;
const views = [], checks = [], errors = [];
const root = process.argv[2];
const watchdog = setTimeout(() => { console.error('BROWSER_SMOKE timeout'); app.exit(2); }, 45000);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(condition, label) {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) { if (await condition()) return; await pause(30); }
  throw Error('等待失败：' + label);
}
function check(label, condition) { assert.ok(condition, label); checks.push(label); }
app.setPath('userData', join(root, 'user-data'));
app.whenReady().then(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { Location: '/two' }); res.end(); return; }
    if (req.url === '/cross') { res.writeHead(302, { Location: 'http://localhost:' + server.address().port + '/blocked' }); res.end(); return; }
    if (req.url === '/download') { res.writeHead(200, { 'Content-Disposition': 'attachment; filename="test.txt"' }); res.end('fixture'); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!doctype html><title>' + (req.url === '/two' ? '第二页' : '测试首页') + '</title><h1>自有测试页面</h1><a id="next" href="/two">下一页</a><script>document.cookie="fixture=one; SameSite=Strict"</script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  function TrackedView(options) {
    const view = new WebContentsView(options);
    const setVisible = view.setVisible.bind(view);
    view.setVisible = value => { setVisible(value); view.observedVisible = value; };
    views.push(view); return view;
  }
  win = new BrowserWindow({ width: 1100, height: 850, show: true, webPreferences: { preload: join(__dirname, '../preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
  controller = registerBrowserViewIpc({ ipcMain, WebContentsView: TrackedView, session, getWindow: () => win });
  await win.loadFile(join(root, 'fixture.html'));
  win.setAlwaysOnTop(true); win.show(); win.focus();
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
  const js = code => win.webContents.executeJavaScript(code, true);
  await until(() => js('!!globalThis.browserTest'), '页面组件装配');
  await until(() => views.length === 1, '视图创建');
  const wc = views[0].webContents;
  try { await until(() => views[0].observedVisible, '原生视图可见'); } catch(error) { console.error(await js('JSON.stringify([...document.querySelectorAll(".browser-viewport, .browser-panel, main, #app, body, html")].map(e=>({tag:e.tagName,rect:e.getBoundingClientRect().toJSON(),overflow:getComputedStyle(e).overflow,x:getComputedStyle(e).overflowX,y:getComputedStyle(e).overflowY,visibility:document.visibilityState,overlay:document.querySelectorAll(\"dialog[open], [aria-modal=true], [role=alertdialog], .workbench-resource-picker, .t-popup\").length})))')); throw error; }
  await js('browserTest.navigate(' + JSON.stringify(origin + '/one') + ')');
  await until(() => wc.getURL() === origin + '/one' && !wc.isLoading(), '首轮导航');
  await until(() => js('document.querySelector(".browser-page-status").textContent.includes("测试首页")'), '真实标题回执');
  check('页面真实标题回执', true);
  check('隔离网页无工作台桥', await wc.executeJavaScript('typeof window.sacode === "undefined" && typeof require === "undefined"'));
  await js('browserTest.navigate(' + JSON.stringify(origin + '/redirect') + ')');
  await until(() => wc.getURL() === origin + '/two' && !wc.isLoading(), '同源重定向');
  check('同源重定向真实导航', wc.getTitle() === '第二页');
  await js('browserTest.click("后退")');
  await until(() => wc.getURL() === origin + '/one' && !wc.isLoading(), '后退'); check('后退到真实首页', true);
  await js('browserTest.click("前进")');
  await until(() => wc.getURL() === origin + '/two' && !wc.isLoading(), '前进'); check('前进到真实第二页', true);
  await js('browserTest.click("刷新")'); await until(() => !wc.isLoading(), '刷新'); check('刷新保留当前页面', wc.getURL() === origin + '/two');
  try { await until(async () => { try { const image = await wc.capturePage(); writeFileSync(join(root, 'web-page.png'), image.toPNG()); return true; } catch { return false; } }, '网页绘制截图'); }
  catch(error) { errors.push(error.message); }
  const beforeDownload = await wc.session.cookies.get({ url: origin }); check('测试页面确实写入隔离 cookie', beforeDownload.some(cookie => cookie.name === 'fixture'));
  await js('browserTest.modal(true)'); await until(() => !views[0].observedVisible, '弹窗隐藏'); check('原生弹窗打开隐藏网页', true);
  await win.capturePage().then(image => writeFileSync(join(root, 'modal.png'), image.toPNG()));
  await js('browserTest.modal(false)'); await until(() => views[0].observedVisible, '弹窗关闭恢复'); check('弹窗关闭恢复网页', true);
  await js('browserTest.active(false)'); await until(() => !views[0].observedVisible, '切页隐藏'); check('切页隐藏但不销毁', !wc.isDestroyed());
  await js('browserTest.active(true)'); await until(() => views[0].observedVisible, '切回恢复');
  win.setContentSize(700, 700); await until(() => views[0].observedVisible, '缩窗重新布局');
  const bounds = views[0].getBounds(); check('缩窗后视图在内容范围内', bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 700 && bounds.y + bounds.height <= 700);
  await win.capturePage().then(image => writeFileSync(join(root, 'browser.png'), image.toPNG()));
  await js('browserTest.navigate(' + JSON.stringify(origin + '/cross') + ')');
  await until(() => js('document.querySelector("[role=alert]") !== null'), '跨域拒绝提示');
  check('跨域重定向拒绝', !wc.getURL().includes('localhost'));
  let downloadState = '';
  wc.session.once('will-download', (_event, item) => { downloadState = item.getState(); });
  await js('browserTest.navigate(' + JSON.stringify(origin + '/download') + ')');
  await until(() => !!downloadState, '下载拒绝'); check('下载默认取消', downloadState === 'cancelled');
  let popup = false; wc.on('did-create-window', () => { popup = true; }); await wc.executeJavaScript('window.open("' + origin + '/two")'); await pause(100); check('新窗口默认拒绝', !popup);
  const oldSession = wc.session;
  await js('browserTest.project("p2")'); await until(() => views.length === 2 && wc.isDestroyed(), '切项目销毁');
  check('切项目销毁旧视图', wc.isDestroyed());
  check('新项目无旧 cookie', (await views[1].webContents.session.cookies.get({ url: origin })).length === 0);
  check('新项目会话分区不同', oldSession !== views[1].webContents.session);
  await until(async () => (await oldSession.cookies.get({ url: origin })).length === 0, '旧会话清除');
  check('旧分区 cookie 已清除', true);
  const secondContents = views[1].webContents;
  await js('browserTest.close()'); await until(() => secondContents.isDestroyed(), '卸载销毁'); check('关闭资源回收 webContents', true);
  check('无渲染错误', errors.length === 0);
  console.log(JSON.stringify({ checks, errors, electron: process.versions.electron }));
}).then(() => finish(0), error => { console.error(error.stack); console.error(JSON.stringify({ checks, errors })); finish(1); });
function finish(code) {
  clearTimeout(watchdog); controller?.dispose(); if (win && !win.isDestroyed()) win.destroy();
  if (server) { server.closeAllConnections(); server.close(() => app.exit(code)); } else app.exit(code);
}
