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

test('目标 preload 的六个动作只带必要字段，不提供完成或任意转发',async()=>{
 const {api,calls}=loadPreload();
 await api.goalDescribe('s');await api.goalCreate('s','目标');await api.goalEdit('s',1,'新版');await api.goalPause('s',2);await api.goalResume('s',3);await api.goalClear('s',4);
 assert.deepEqual(calls.map(row=>row[0]),['dsh:goalDescribe','dsh:goalCreate','dsh:goalEdit','dsh:goalPause','dsh:goalResume','dsh:goalClear']);
 assert.equal(JSON.stringify(calls[2][1]),JSON.stringify({sessionId:'s',revision:1,objective:'新版'}));
 assert.equal('goalComplete' in api,false);assert.equal('request' in api,false);
});
test('目标主进程先校验会话、修订和正文，拒绝额外字段后不转发',async()=>{
 const {handlers,requests}=loadMain();
 const cases=[['goalDescribe','goal/describe',{sessionId:'s'}],['goalCreate','goal/create',{sessionId:'s',objective:'目标'}],['goalEdit','goal/edit',{sessionId:'s',revision:1,objective:'新版'}],['goalPause','goal/pause',{sessionId:'s',revision:1}],['goalResume','goal/resume',{sessionId:'s',revision:1}],['goalClear','goal/clear',{sessionId:'s',revision:1}]];
 for(const [action,method,args] of cases){
  const handler=handlers.get('dsh:'+action);assert.equal(typeof handler,'function');
  for(const bad of [null,undefined,{}, {...args,sessionId:''},{...args,sessionId:'s'.repeat(301)},{...args,method:'goal/complete'}])await assert.rejects(handler({},bad),/bad arguments/);
  if('revision' in args)for(const revision of [0,-1,1.1,'1',NaN,Infinity])await assert.rejects(handler({},{...args,revision}),/bad arguments/);
  if('objective' in args)for(const objective of ['', ' \n ',2,'x'.repeat(8001)])await assert.rejects(handler({},{...args,objective}),/bad arguments/);
  const before=requests.length;await handler({},args);assert.equal(requests.length,before+1);assert.equal(requests.at(-1).method,method);assert.equal(JSON.stringify(requests.at(-1).params),JSON.stringify(args));
 }
 assert.equal(requests.length,6);
});
