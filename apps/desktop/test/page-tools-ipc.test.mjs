import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname, join as jj} from 'node:path';
import vm from 'node:vm';
const nodeRequire = createRequire(import.meta.url);

// 页面注册表用 renderer/page-tools.js 的真实源码加载：主进程调的是 window.DshPageTools
// 的 tools/list()，夹具必须出自那份脚本，否则测的是「我以为渲染层长什么样」。
// 计时器给空实现，否则注册表末尾的轮询会把测试进程吊住。
function makePage({ withRegistry = true, modelContext = null } = {}) {
  const elements = {
    '#btn': { innerText: '按钮', tagName: 'BUTTON', clicked: false, click() { this.clicked = true; } },
  };
  const doc = {
    URL: 'file:///renderer/index.html',
    body: { innerText: '页面正文' },
    modelContext,
    querySelector: (sel) => elements[sel] || null,
    createTreeWalker: () => ({ nextNode: () => false, currentNode: null }),
  };
  const host = { window: {} };
  const ctx = vm.createContext({
    ...host,
    document: doc,
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: () => 0,
    Event: class { constructor(name) { this.type = name; } },
  });
  if (withRegistry) {
    vm.runInContext(readFileSync(new URL('../renderer/page-tools.js', import.meta.url), 'utf8'), ctx);
  }
  return { ctx, host, doc, elements };
}

// 主进程侧真起一份 main.cjs：只有 handler 真跑过，才证得了窗口解析与传参
// 发生在主进程，而不是渲染层的一句自我约束。
function loadMain({ page, ready = true } = {}) {
  const handlers = new Map();
  const scripts = [];
  const state = { destroyed: false };
  const wins = [];
  const electron = {
    app: {
      isPackaged: false,
      // ready=false 时窗口永远建不起来，用来验「没有窗口」这一支不该抛。
      whenReady: () => (ready ? Promise.resolve() : new Promise(() => {})),
      getPath: (k) => (k === 'temp' ? '/tmp' : `/tmp/sacode-page-tools-${k}`),
      setPath: () => {},
      on: () => {},
      quit: () => {},
    },
    BrowserWindow: class {
      static getAllWindows() { return wins; }
      constructor() {
        this.webContents = {
          on: () => {}, send: () => {}, loadFile: () => Promise.resolve(), session: { on: () => {} },
          executeJavaScript: async (code) => { scripts.push(code); return vm.runInContext(code, page.ctx); },
        };
        this.on = () => {};
        this.once = () => {};
        this.isDestroyed = () => state.destroyed;
        this.loadFile = () => Promise.resolve();
        this.show = () => {};
        this.loadURL = () => Promise.resolve();
        this.setTitleBarOverlay = () => {};
        wins.push(this);
      }
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
        return { HostBridge: class { constructor() {} async start() {} async request() { return { ok: true }; } async stop() { return { code: 0 }; } killNow() {} } };
      }
      if (id === './paths.cjs') return { hostExePath: () => '/tmp/does-not-exist-sacode-host.exe' };
      if (id === './stdio-guard.cjs') return { installStdioGuard: () => {} };
      if (id === './frame-smoke.cjs') return { runFrameSmoke: async () => {} };
      if (id === 'node:module') return { createRequire: (p) => nodeRequire };
      if (id === 'node:path') return nodeRequire('node:path');
      if (id === 'node:fs') return { existsSync: () => false, writeFileSync: () => {}, mkdirSync: () => {}, readFileSync: () => '', rmSync: () => {}, readdirSync: () => [], statSync: () => ({ size: 0 }) };
      if (id === 'node:crypto') return nodeRequire('node:crypto');
      if (id === 'node:os') return nodeRequire('node:os');
      if (id === 'node:http' || id === 'node:https') return nodeRequire(id);
      if (id === 'node:child_process') return { spawn: () => ({ on: () => {}, stdio: { write: () => {} }, kill: () => {} }), execFileSync: () => '' };
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
  return { handlers, scripts, state, settle: () => new Promise((r) => setImmediate(r)) };
}

async function call(m, action, args) {
  const handler = m.handlers.get(`sacode:${action}`);
  assert.equal(typeof handler, 'function', `sacode:${action} 未注册`);
  return handler({}, args);
}

// main.cjs 与页面各跑在自己的 vm realm 里，跨层的对象原型不同，strict deepEqual
// 会因原型引用不等而假红——按值抄回本层再比，比的就是内容而不是它出自哪个 realm。
const plain = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

test('pageToolsList 枚举渲染层注册表，不是写死的空数组', async () => {
  const page = makePage();
  const m = loadMain({ page });
  await m.settle();
  const listed = plain(await call(m, 'pageToolsList'));
  // 名字集合必须等于页面自己那份注册表——比硬断条数更能证「真的枚举到了」
  assert.deepEqual(listed.map((t) => t.name), plain(page.host.window.DshPageTools.tools).map((t) => t.name));
  assert.ok(listed.length > 0);
  for (const tool of listed) {
    assert.equal(typeof tool.description, 'string');
    assert.equal(tool.parameters.type, 'object');
  }
});

test('pageToolCall 走真实注册表执行 handler 并回传结果', async () => {
  const page = makePage();
  const m = loadMain({ page });
  await m.settle();
  const out = plain(await call(m, 'pageToolCall', { name: 'page.readState', args: { selector: '#btn' } }));
  assert.deepEqual(out, { text: '按钮', tag: 'BUTTON' });
});

test('pageToolCall 工具不存在时如实回 tool-not-found，不抛', async () => {
  const page = makePage();
  const m = loadMain({ page });
  await m.settle();
  assert.deepEqual(plain(await call(m, 'pageToolCall', { name: 'page.none', args: {} })), { error: 'tool-not-found' });
});

test('工具名里的引号与反斜杠只能当数据：奇名照样按值命中，且不得在页面里多执行一句', async () => {
  const page = makePage();
  const odd = "a');page.__pwned=1;('b\\";
  page.host.window.DshPageTools.register(odd, '带引号的名字', { type: 'object' }, async () => ({ ok: 'odd-name' }));
  const m = loadMain({ page });
  await m.settle();
  assert.deepEqual(plain(await call(m, 'pageToolCall', { name: odd, args: {} })), { ok: 'odd-name' });
  assert.equal(page.host.window.__pwned, undefined);
});

test('没有窗口与页面已关都不该抛：list 出空集、call 回 no-window', async () => {
  const none = loadMain({ page: makePage(), ready: false });
  await none.settle();
  assert.deepEqual(plain(await call(none, 'pageToolsList')), []);
  assert.deepEqual(plain(await call(none, 'pageToolCall', { name: 'page.readState', args: {} })), { error: 'no-window' });

  const page = makePage();
  const closed = loadMain({ page });
  await closed.settle();
  closed.state.destroyed = true;
  assert.deepEqual(plain(await call(closed, 'pageToolsList')), []);
  assert.deepEqual(plain(await call(closed, 'pageToolCall', { name: 'page.readState', args: {} })), { error: 'no-window' });
});

test('注册表没加载时如实回 page-tools-not-loaded', async () => {
  const page = makePage({ withRegistry: false });
  const m = loadMain({ page });
  await m.settle();
  assert.deepEqual(plain(await call(m, 'pageToolCall', { name: 'page.readState', args: {} })), { error: 'page-tools-not-loaded' });
  assert.deepEqual(plain(await call(m, 'pageToolsList')), []);
});

test('pageToolCall 的名字与参数仍是主进程逐字段校验，假名假参一律拒', async () => {
  const page = makePage();
  const m = loadMain({ page });
  await m.settle();
  for (const bad of [undefined, null, {}, { name: '' }, { name: 42 }, { name: {} }]) {
    await assert.rejects(call(m, 'pageToolCall', bad), /bad-page-tool-name/);
  }
  for (const bad of [{ name: 'page.readState', args: 'nope' }, { name: 'page.readState', args: 42 }, { name: 'page.readState', args: null }, { name: 'page.readState', args: [1] }]) {
    await assert.rejects(call(m, 'pageToolCall', bad), /bad-page-tool-args/);
  }
});

// Next SDK 的注册校验器（vendor/next-sdk.iife.js 里那条 'Tool "execute" must be a function'）
// 要的是 execute=函数；注册表原先交的是 parameters+handler，于是每一次注册都抛，
// 又被 catch 注释成「modelContext 未初始化时忽略」吞掉——对模型其实一个工具都没暴露。
// 这里按 vendor 真正执行的那几条判定来造夹具，不多发明要求：name/description 必填，
// inputSchema/outputSchema 可选，execute 必须是函数。
function sdkModelContext({ reject = null } = {}) {
  const registered = [];
  return {
    registered,
    registerTool(tool) {
      if (typeof tool.name !== 'string' || !tool.name) throw new TypeError('Tool "name" is required');
      if (typeof tool.description !== 'string') throw new TypeError('Tool "description" is required');
      if (typeof tool.execute !== 'function') throw new TypeError('Tool "execute" must be a function');
      if (reject) throw reject;
      registered.push(tool);
    },
  };
}

test('页面工具交出去的是 WebMCP 形状，四个都真的挂进了 modelContext', () => {
  const mc = sdkModelContext();
  const page = makePage({ modelContext: mc });
  const listed = plain(page.host.window.DshPageTools.list());
  // 先钉分母非空，否则「一个都没注册」也能让下面的逐条断言空转
  assert.ok(listed.length >= 4, `注册表本身只剩 ${listed.length} 条，夹具没加载起来`);
  assert.equal(mc.registered.length, listed.length, '注册表条数与 modelContext 实收条数不等：有工具被静默丢掉');
  assert.ok(mc.registered.length >= 4);
  for (const tool of mc.registered) {
    assert.equal(typeof tool.execute, 'function', `${tool.name} 的 execute 不是函数`);
    assert.equal(tool.inputSchema && tool.inputSchema.type, 'object', `${tool.name} 没带 inputSchema，模型拿不到参数形状`);
    assert.equal('parameters' in tool, false, `${tool.name} 仍把 parameters 交给校验器，那份 schema 会被静默忽略`);
  }
});

test('注册被校验器拒绝时如实登记，list() 不许把没挂上的工具说成可用', () => {
  const mc = sdkModelContext({ reject: new TypeError('Tool "execute" must be a function') });
  const page = makePage({ modelContext: mc });
  assert.equal(mc.registered.length, 0, '夹具本该全拒，却有工具注册成功');
  const listed = plain(page.host.window.DshPageTools.list());
  assert.ok(listed.length >= 4);
  for (const tool of listed) {
    assert.equal(tool.registered, false, `${tool.name} 没挂上却说已注册`);
    assert.match(String(tool.error), /execute/, `${tool.name} 的失败原因没被记下来，等于继续装没发生`);
  }
});

test('WebMCP 侧的 execute 走主进程那一道，不在渲染层就地动手', async () => {
  const mc = sdkModelContext();
  const page = makePage({ modelContext: mc });
  const calls = [];
  page.host.window.sacode = {
    pageToolCall: async (name, args) => { calls.push({ name, args }); return { ok: 'mediated' }; },
  };
  const clicked = mc.registered.find((t) => t.name === 'page.clickElement');
  assert.ok(clicked, '没有 page.clickElement 这条注册');
  const out = await clicked.execute({ selector: '#btn' });
  assert.deepEqual(plain(calls), [{ name: 'page.clickElement', args: { selector: '#btn' } }]);
  assert.equal(page.elements['#btn'].clicked, false, 'handler 在渲染层就地执行了，绕开了主进程那道');
  assert.deepEqual(plain(out), { ok: 'mediated' });
});
