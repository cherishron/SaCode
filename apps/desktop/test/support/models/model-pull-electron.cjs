// 仅测试驱动：实际生产preload/IPC/Host，默认Chromium沙箱开启，无用户配置。
const { app, BrowserWindow, ipcMain } = require('electron');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const config = JSON.parse(readFileSync(process.argv.at(-1), 'utf8'));
const { HostBridge } = require(join(config.desktop, 'host-bridge.cjs'));
const { registerCustomsIpc } = require(join(config.desktop, 'customs-ipc.cjs'));
const guard = require(join(config.desktop, 'customs-guard.cjs'));
app.setPath('userData', join(config.dir, 'user-data'));
const bridge = new HostBridge(config.host, { ...process.env, SACODE_USER_SETTINGS_DIR: join(config.dir, 'settings') });
app.whenReady().then(async () => {
  try {
    await bridge.start(config.dir);
    await bridge.request('model/registry/update', {
      draft: { id: 'fixture', name: '合成供应商', baseUrl: config.baseUrl, protocol: 'openai-completions',
        models: [{ id: 'original', name: '原模型', contextWindow: '', maxTokens: '', image: false }] }, expectedRevision: 0,
    });
    await bridge.request('model/registry/save-credential', { providerId: 'fixture', expectedRevision: 1, key: 'invalid-local-electron-fixture' });
    ipcMain.handle('sacode:modelsDescribe', () => bridge.request('model/registry/describe'));
    ipcMain.handle('sacode:modelsCatalog', () => bridge.request('model/registry/catalog'));
    let pulls = 0, lostOperation = '', uncertainQueries = 0;
    registerCustomsIpc(ipcMain, (method, args, timeout) => {
      // 第三笔用短桥等待模拟丢回执；仍运行生产handler的精确操作查询，绝不重发。
      if (method === 'model/pull' && ++pulls === 3) { timeout = 150; lostOperation = args.operationId; }
      // 让原调用超时后的自动查询与页面第一次手动核对均失联，复现持续未知。
      // 只对合成第三笔操作注入；之后仍由真实Host回答，不伪造其结果。
      if (method === 'model/pull/describe' && args.operationId === lostOperation && uncertainQueries++ < 2) {
        return Promise.reject(new Error('timeout: model/pull/describe'));
      }
      return bridge.request(method, args, timeout);
    }, guard, x => typeof x === 'string');
    const win = new BrowserWindow({ show: false, width: 640, height: 800,
      webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true, preload: join(config.desktop, 'preload.cjs') } });
    await win.loadFile(join(config.dir, 'fixture.html'));
    for (let i = 0; i < 250; i++) {
      const result = await win.webContents.executeJavaScript('window.__pullResult');
      if (result) {
        const exit = await bridge.stop();
        const preferences=win.webContents.getLastWebPreferences();
        console.log('PULL_ELECTRON_RESULT ' + JSON.stringify({ ...result, hostExit: exit,
          sandboxConfigured: preferences.sandbox, contextIsolation: preferences.contextIsolation,
          nodeIntegration: preferences.nodeIntegration }));
        app.exit(result.ok && !exit.forced && exit.code === 0 ? 0 : 1);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 80));
    }
    throw new Error('fixture-timeout');
  } catch {
    await bridge.stop();
    console.error('PULL_ELECTRON_FAILED: 测试未完成，未输出配置或认证材料');
    app.exit(1);
  }
}).catch(() => app.exit(1));
