// 增强这条通道也是「按动作命名、逐字段校验」的有限集合之一：
// 渲染层说不出模型、说不出 baseUrl、也说不出任何别的宿主方法——
// 用哪颗模型只能由宿主在点击那一刻自己定。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join as jj } from 'node:path';
import vm from 'node:vm';

const nodeRequire = createRequire(import.meta.url);

function loadPreload() {
  let api;
  const calls = [];
  vm.runInNewContext(readFileSync(new URL('../preload.cjs', import.meta.url), 'utf8'), {
    require: () => ({
      contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } },
      ipcRenderer: { invoke: (...args) => { calls.push(args); return Promise.resolve(); } },
    }),
  });
  return { api, calls };
}

// 主进程侧要单独起一份：只有真的过一遍 handler，才证得了「校验发生在主进程」
// 而不是只写在渲染层的一句自我约束上。
function loadMain() {
  const handlers = new Map();
  const requests = [];
  const electron = {
    app: {
      isPackaged: false,
      whenReady: () => new Promise(() => {}),
      getPath: (k) => (k === 'temp' ? '/tmp' : `/tmp/sacode-prompt-ipc-${k}`),
      setPath: () => {},
      on: () => {},
      quit: () => {},
    },
    BrowserWindow: class {
      static getAllWindows() { return []; }
      constructor() { this.webContents = { on: () => {}, send: () => {}, loadFile: () => Promise.resolve(), session: { on: () => {} } }; this.on = () => {}; this.loadFile = () => Promise.resolve(); this.show = () => {}; this.loadURL = () => Promise.resolve(); }
      static getFromFile() { return null; }
    },
    ipcMain: { handle: (name, fn) => { handlers.set(name, fn); }, on: () => {} },
    nativeTheme: { shouldUseDarkColors: false, on: () => {}, themeSource: 'system' },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    shell: { openExternal: async () => {} },
    Menu: { buildFromTemplate: () => ({ popup: () => {} }), setApplicationMenu: () => {}, getApplicationMenu: () => null },
    Tray: class { constructor() {} on() {} setImage() {} setToolTip() {} destroy() {} },
    safeStorage: { isEncryptionAvailable: () => false, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() },
    screen: { on: () => {} },
  };
  const ctx = {
    require: (id) => {
      if (id === 'electron') return electron;
      if (id === './host-bridge.cjs') {
        return { HostBridge: class { constructor() {} async start() {} async request(method, params) { requests.push({ method, params }); return { ok: true }; } async stop() { return { code: 0 }; } killNow() {} } };
      }
      if (id === './paths.cjs') return { hostExePath: () => '/tmp/does-not-exist-dsh-host.exe' };
      if (id === './stdio-guard.cjs') return { installStdioGuard: () => {} };
      if (id === './frame-smoke.cjs') return { runFrameSmoke: async () => {} };
      if (id === 'node:module') return { createRequire: (p) => nodeRequire };
      if (id === 'node:path') return nodeRequire('node:path');
      if (id === 'node:fs') return { existsSync: () => false, writeFileSync: () => {}, mkdirSync: () => {}, readFileSync: () => '', rmSync: () => {}, readdirSync: () => [], statSync: () => ({ size: 0 }) };
      if (id === 'node:crypto') return nodeRequire('node:crypto');
      if (id === 'node:os') return nodeRequire('node:os');
      if (id === 'node:http' || id === 'node:https') return nodeRequire(id);
      if (id === 'node:child_process') return { spawn: () => ({ on: () => {}, stdio: { write: () => {} }, kill: () => {} }), execFileSync: () => '' };
      // 其余都按真实模块加载：主进程 handler 的校验逻辑要跑在它自己的依赖上，
      // 而不是跑在一份「我猜它长什么样」的替身里。相对路径按 main.cjs 所在目录解析。
      return nodeRequire(id.startsWith('.') ? jj(dirname(fileURLToPath(import.meta.url)), '..', id) : id);
    },
    __dirname: '/tmp',
    process: { argv: [], env: {}, pid: 1, platform: 'win32', on: () => {}, exit: () => {}, resourcesPath: '/tmp' },
    console: { log: () => {}, error: () => {}, warn: () => {} },
    Buffer,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    URL,
  };
  vm.runInNewContext(readFileSync(new URL('../main.cjs', import.meta.url), 'utf8'), ctx, { filename: 'main.cjs' });
  return { handlers, requests };
}

test('增强 preload 只发固定动作，负载里除了草稿没有别的字段', async () => {
  const { api, calls } = loadPreload();
  await api.promptEnhance('把这条说清楚');
  await api.promptPoll();
  await api.promptCancel();
  assert.equal(calls[0][0], 'dsh:promptEnhance');
  // 没有 model / baseUrl / credential 的位置：渲染层报不出「用哪颗模型」
  assert.equal(JSON.stringify(calls[0][1]), '{"draft":"把这条说清楚"}');
  assert.equal(calls[1][0], 'dsh:promptPoll');
  assert.equal(calls[1].length, 1);
  assert.equal(calls[2][0], 'dsh:promptCancel');
  assert.equal(calls[2].length, 1);
  assert.equal('request' in api, false);
});

test('主进程逐字段校验草稿，只把草稿交给宿主', async () => {
  const { handlers, requests } = loadMain();
  const enhance = handlers.get('dsh:promptEnhance');
  assert.equal(typeof enhance, 'function', 'dsh:promptEnhance 通道必须存在');
  const poll = handlers.get('dsh:promptPoll');
  const cancel = handlers.get('dsh:promptCancel');
  assert.equal(typeof poll, 'function', 'dsh:promptPoll 通道必须存在');
  assert.equal(typeof cancel, 'function', 'dsh:promptCancel 通道必须存在');

  for (const bad of [undefined, null, {}, { draft: 1 }, { draft: '' }, { draft: '   \n ' }, { draft: 'x'.repeat(8001) }]) {
    await assert.rejects(
      () => enhance({}, bad),
      /bad arguments/,
      `非法草稿必须被主进程拒收，实得输入: ${JSON.stringify(bad)}`,
    );
  }
  assert.equal(requests.length, 0, '被拒的调用一条都不许发到宿主');

  await enhance({}, { draft: '想要更顺手的队列' });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'prompt/enhance');
  // 比对序列化结果：对象是在 vm 上下文里造的，原型不同，deepEqual 会按引用原型判不等。
  assert.equal(JSON.stringify(requests[0].params), '{"draft":"想要更顺手的队列"}');

  await poll({});
  await cancel({});
  assert.deepEqual(requests.map((r) => r.method), ['prompt/enhance', 'prompt/poll', 'prompt/cancel']);
});
