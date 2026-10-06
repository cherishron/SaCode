import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname,join as jj} from 'node:path';
import vm from 'node:vm';
const nodeRequire=createRequire(import.meta.url);
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

test('图片读取 preload 只有会话与引用两个参数，没有任意方法或路径',async()=>{
 const {api,calls}=loadPreload(),id='sha256:'+'a'.repeat(64);
 await api.attachmentImageRead('current',id);
 assert.equal(calls[0][0],'sacode:attachmentImageRead');
 assert.equal(JSON.stringify(calls[0][1]),JSON.stringify({sessionId:'current',attachmentId:id}));
 assert.equal('request' in api,false);
});
test('主进程图片 IPC 拒绝额外字段与非法引用，不发送宿主请求',async()=>{
 const {handlers,requests}=loadMain(),handler=handlers.get('sacode:attachmentImageRead'),id='sha256:'+'a'.repeat(64);
 assert.equal(typeof handler,'function');
 for(const bad of [null,undefined,{},'path',{sessionId:'',attachmentId:id},{sessionId:'s'.repeat(301),attachmentId:id},{sessionId:'current',attachmentId:'../../secret'},{sessionId:'current',attachmentId:'sha256:'+'A'.repeat(64)},{sessionId:'current',attachmentId:id,path:'secret'},{sessionId:'current',attachmentId:id,method:'fs/read'}])await assert.rejects(handler({},bad),/bad arguments/);
 assert.equal(requests.length,0);
 await handler({},{sessionId:'current',attachmentId:id});
 assert.equal(requests[0].method,'attachment/image-read');
 assert.equal(JSON.stringify(requests[0].params),JSON.stringify({sessionId:'current',attachmentId:id}));
});
