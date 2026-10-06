import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

async function runWindow(source, hidden) {
  const base = join(here, '../.tmp-test/window-visibility');
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, 'run-'));
  writeFileSync(join(dir, 'visibility.cjs'), source);
  writeFileSync(join(dir, 'index.html'), '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'"><title>启动显示验收</title><p>已加载</p>');
  writeFileSync(join(dir, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron');
    const { installWindowVisibility } = require('./visibility.cjs');
    app.setPath('userData', ${JSON.stringify(join(dir, 'user-data'))});
    app.whenReady().then(async () => {
      const win = new BrowserWindow({ show: false });
      // 控制输入：真实页面加载，但不送达首次绘制事件。
      const emit = win.emit.bind(win);
      win.emit = (name, ...args) => name === 'ready-to-show' ? false : emit(name, ...args);
      installWindowVisibility(win, { hidden: ${hidden} });
      const loaded = new Promise(resolve => win.webContents.once('did-stop-loading', resolve));
      await win.loadFile(${JSON.stringify(join(dir, 'index.html'))});
      await loaded;
      // 等加载停止后的事件队列结算，不能在 native Promise 刚返回时读窗口状态。
      await new Promise(resolve => setTimeout(resolve, 150));
      console.log('WINDOW_RESULT ' + JSON.stringify({ visible: win.isVisible(), loading: win.webContents.isLoading() }));
      app.exit(0);
    }).catch(e => { console.error(e); app.exit(1); });
  `);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return await new Promise((resolve, reject) => {
    // 可指定已核验发布包的同版本 Electron 运行时，不跳过真实窗口断言。
    const child = spawn(process.env.SACODE_ELECTRON_TEST_EXE || require('electron'), [join(dir, 'main.cjs')], { env, windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('真实窗口验收超时')); }, 20000);
    child.stdout.on('data', data => { out += data; });
    child.stderr.on('data', data => { err += data; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`Electron rc=${code}: ${err}`));
      const match = out.match(/WINDOW_RESULT (.+)/);
      if (!match) return reject(new Error(`缺少窗口验收结果: ${err}`));
      resolve(JSON.parse(match[1]));
    });
  });
}

const source = readFileSync(join(here, '../window-visibility.cjs'), 'utf8');
test('真实 Electron：没有 ready-to-show 时仍显示加载完成的窗口', { timeout: 25000 }, async () => {
  assert.deepEqual(await runWindow(source, false), { visible: true, loading: false });
});
test('真实 Electron：隐藏冒烟窗口保持隐藏', { timeout: 25000 }, async () => {
  assert.deepEqual(await runWindow(source, true), { visible: false, loading: false });
});
test('变异反证：删除加载完成兜底后窗口仍隐藏', { timeout: 25000 }, async () => {
  const mutant = source.replace("win.webContents.once('did-stop-loading', show);", '');
  assert.notEqual(mutant, source);
  assert.deepEqual(await runWindow(mutant, false), { visible: false, loading: false });
});
