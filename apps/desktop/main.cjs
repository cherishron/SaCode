// Electron 主进程：只负责窗口、宿主生命周期与有限的 IPC 面。
// 不做 agent 业务，不承载会话真源，不把任意命令执行暴露给渲染层。
require('./stdio-guard.cjs').installStdioGuard();
const { installWindowVisibility } = require('./window-visibility.cjs');
const modelApproval = require('./renderer/model-approval.js');
let modelTurnRequestId = null;
// turn/poll 的会话内游标：只对当前活动会话有效，起轮/切会话时归零。
// 0 表示「从帧日志头开始读」；turnPollTurnId 为 null 表示不带 turnId（首次或已重置），
// 这样带游标的新路径与旧 Host 的 take 路径都能工作。
let turnPollCursor = 0;
let turnPollTurnId = null;
const { app, BrowserWindow, WebContentsView, session, ipcMain, nativeTheme, dialog } = require("electron");
const { join } = require("node:path");
const { existsSync, writeFileSync, mkdirSync } = require("node:fs");
const { createHash } = require("node:crypto");
const { HostBridge } = require("./host-bridge.cjs");
const { hostExePath, computerUsePaths, caBundleSidecar, hostEnvWithCaBundle } = require("./paths.cjs");

// 自包含宿主：exe 与全部依赖 DLL 同目录，因此不需要设置 PATH。
// 打包态下必须从 resourcesPath 取（extraResources 落点），__dirname 那时在 asar 里。
const HOST = hostExePath({
  packaged: app.isPackaged,
  appRoot: __dirname,
  resourcesPath: process.resourcesPath,
});
// 冒烟必须从空会话开始：默认的 sessionData 目录会跨次累积，
// 「这条写入真的落盘了」这类断言就会被上一次运行的旧日志蒙混过去。
// 用 --session-dir=<路径> 指定一次性目录；不传时仍用应用自己的目录（给人工运行用）。
const SESSION_ARG = process.argv.find((a) => a.startsWith("--session-dir="));
const FRAME_SMOKE = process.argv.includes('--frame-smoke');
const STARTUP_CHECK = process.argv.includes('--startup-check');
const WILL_SMOKE = STARTUP_CHECK || FRAME_SMOKE || process.argv.includes("--smoke") || process.argv.includes("--ui-smoke") || process.argv.includes("--layout-smoke");
const dataPaths = require('./data-paths.cjs').configureDataPaths({
  app, env: process.env, isolated: WILL_SMOKE || !!SESSION_ARG,
});
// 冒烟态没传 --session-dir 时也必须落到一次性目录：默认的 sessionData 跨次累积，
// 「全新会话」类断言会被上一次运行的旧日志蒙混过去（实测用量从 12 一路涨到 48）。
// 只带 pid 还不够：Windows 会回收 pid，同 pid 的旧目录会被下一次运行接着写，
// 于是上一轮的 usage/budget 与 tool 事件就污染了这一轮（实测「用量 12/5」+ 多出 tool 组）。
// 所以目录名带 pid+时间戳，且冒烟态自己建自己清；传了 --session-dir 的（打包态手工复验、
// CI 要留日志）仍以传入者为准，我们绝不删别人指定的目录。
const FRESH_SMOKE_DIR = WILL_SMOKE && !SESSION_ARG;
const SESSION_DIR = SESSION_ARG
  ? SESSION_ARG.slice("--session-dir=".length)
  : (FRESH_SMOKE_DIR ? join(app.getPath("temp"), `sacode-smoke-${process.pid}-${Date.now()}`) : dataPaths?.sessions || app.getPath("sessionData"));
const SESSION_LOG = join(SESSION_DIR, "session.log");
if(WILL_SMOKE) app.setPath('userData',join(SESSION_DIR,'electron-user-data'));

// 冒烟只使用自己的配置根，不能修改真实用户的全局外观。
const hostEnvironment = WILL_SMOKE
  ? { ...process.env, SACODE_USER_SETTINGS_DIR: join(SESSION_DIR, 'user-settings'), SACODE_COMPUTER_USE: '0' }
  : { ...process.env, ...(dataPaths ? {
    SACODE_USER_SETTINGS_DIR: dataPaths.settings,
    TEMP: dataPaths.temp, TMP: dataPaths.temp, TMPDIR: dataPaths.temp,
  } : {}) };
if (!WILL_SMOKE && hostEnvironment.SACODE_COMPUTER_USE === '1') {
  const computerPaths = computerUsePaths({
    packaged: app.isPackaged,
    appRoot: __dirname,
    resourcesPath: process.resourcesPath,
    nodeExecutable: hostEnvironment.SACODE_COMPUTER_NODE,
  });
  hostEnvironment.SACODE_COMPUTER_NODE = computerPaths.nodePath;
  hostEnvironment.SACODE_COMPUTER_PROVIDER = computerPaths.providerPath;
}
// 随包信任锚：宿主同目录里有 ca-bundle.pem 就把它交给宿主（核心只认 SACODE_CA_BUNDLE，
// 不猜自己的安装布局）；没有则不动环境，让核心留在 Default 如实报错，绝不退到不校验。
const bridge = new HostBridge(
  HOST,
  hostEnvWithCaBundle(hostEnvironment, { sidecarPath: caBundleSidecar(HOST), exists: existsSync })
);
let win = null;
const { registerBrowserViewIpc } = require('./browser-view.cjs');
registerBrowserViewIpc({ ipcMain, WebContentsView, session, getWindow: () => win });
// 关闭守卫的两次闸门：worktreeGuardRunning 防重入（连点关闭只走一次确认），
// worktreeClosed 是「已结算」标记——只有守卫放行后自己重开关闭时才不再拦。
let worktreeGuardRunning = false;
let worktreeClosed = false;
let chooseWorkspaceDirectory = (options) => dialog.showOpenDialog(win, options);

function seedIfNeeded() {
  // --session-dir 指到一个还不存在的目录是冒烟测试的正常用法（要的是全新目录），
  // 不能因为目录不存在就把写入炸掉。
  if (!existsSync(SESSION_DIR)) mkdirSync(SESSION_DIR, { recursive: true });
  if (!existsSync(SESSION_LOG)) {
    writeFileSync(
      SESSION_LOG,
      WILL_SMOKE && !FRAME_SMOKE ? "0\tturn/start\tt\n1\tsystem/message\t由 SaCode 初始化本地会话\n2\tdeveloper/message\t请用中文协助完成项目任务。\n3\tassistant/message\t欢迎使用 SaCode。\n4\tuser/message\t你好，SaCode。\n" : ""
    );
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 520,
    minHeight: 600,
    title: "SaCode",
    ...(process.platform === 'win32' ? {titleBarStyle:'hidden',titleBarOverlay:{color:'#00000000',symbolColor:'#0F1115',height:42},backgroundMaterial:'acrylic'} : {}),
    icon: join(__dirname, "renderer", "assets", "sacode-icon.png"),
    show: false,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 隐藏冒烟窗口仍需执行动画帧，否则草稿测量会停在后台节流状态。
      ...(WILL_SMOKE ? { backgroundThrottling: false } : {}),
    },
  });
  // 原生平台只用于布局选择，不扩大 IPC 或业务能力。
  // 在开始加载之前订阅事件；常规启动不能因缺失首次绘制事件永远隐藏。
  installWindowVisibility(win, { hidden: UI_SMOKE });
  win.loadFile(join(__dirname, "renderer", "index.html"), {query:{platform:process.platform}});
  // 活动工作树没结算不许直接关窗：先拦下这次关闭，走与面板同一套保留/删除/取消确认，
  // 只有守卫放行（或读不到状态时明确选择「什么都没删」）才由自己重开关闭。
  // 冒烟态没有人工确认，交给原有的 window-all-closed 结算路径。
  win.on("close", (event) => {
    if (WILL_SMOKE || worktreeClosed) return;
    event.preventDefault();
    if (worktreeGuardRunning) return;
    worktreeGuardRunning = true;
    // 读不到绑定 == 不知道有没有东西要删：唯一安全动作是什么都不删（等价于保留）。
    let stateUnknown = false;
    const request = (method, args) => worktreeRequest(method, args).catch((error) => {
      if (method === "worktree/describe") stateUnknown = true;
      throw error;
    });
    protectClose({ request, choose: chooseWorktreeClose, confirmDelete: confirmWorktreeRemoval })
      .then((proceed) => settleWorktreeClose(proceed))
      .catch((error) => resolveWorktreeCloseFailure(error, stateUnknown).then(settleWorktreeClose));
  });
    win.on("closed", () => (win = null));
    // 导航级防护：被 XSS 攻破的渲染层也不能跳去攻击者页面或挂 <webview>。
    // 协议面已是有限动作集，这里再补一道纵深——任何导航尝试一律拒绝。
    win.webContents.on("will-navigate", (event) => event.preventDefault());
    win.webContents.on("will-attach-webview", (event) => event.preventDefault());
    return win;
}
// 守卫结论落地：不放行就收起闸门让用户继续处理；放行时先落「已结算」再真正关窗。
// 此刻 bridge.stop() 仍由 window-all-closed 负责，工作树没结算的字节不会假装已经落盘。
function settleWorktreeClose(proceed) {
  worktreeGuardRunning = false;
  if (!proceed) return;
  worktreeClosed = true;
  if (win && !win.isDestroyed()) win.close();
}
nativeTheme.on('updated',()=>{
  if(process.platform==='win32' && win && !win.isDestroyed()) win.setTitleBarOverlay({color:'#00000000',symbolColor:'#0F1115',height:42});
});

// IPC 面：每个通道只做一件事、参数逐字段校验类型与范围，方法名由主进程写死。
// 渲染层拿不到「发任意方法」的能力，也伪造不了 system/message 这类事件类型。
async function withHost(fn) {
  seedIfNeeded();
  if (!bridge.proc) await bridge.start(SESSION_DIR);
  return fn();
}

const isStr = (v) => typeof v === "string";

// 新域固定 IPC：主进程复核闭集负载，方法名绝不来自渲染层。
const domainText = (max = 256, min = 1) => v => typeof v === 'string' && v.length >= min && v.length <= max && !v.includes('\0');
const domainInt = (min, max = Number.MAX_SAFE_INTEGER) => v => Number.isSafeInteger(v) && v >= min && v <= max;
const domainEnum = (...values) => v => values.includes(v);
const domainArray = (check, max) => v => Array.isArray(v) && v.length <= max && Array.from(v).every(check);
const domainObject = (required, optional = {}) => v => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  if (proto !== null && Object.getPrototypeOf(proto) !== null) return false;
  const fields = { ...required, ...optional };
  return Reflect.ownKeys(v).every(k => typeof k === 'string' && Object.hasOwn(fields, k) && Object.hasOwn(Object.getOwnPropertyDescriptor(v, k), 'value')) &&
    Object.keys(required).every(k => Object.hasOwn(v, k) && required[k](v[k])) &&
    Object.keys(optional).every(k => !Object.hasOwn(v, k) || optional[k](v[k]));
};
const domainRecord = (check, max = 256) => v => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return (proto === null || Object.getPrototypeOf(proto) === null) && Reflect.ownKeys(v).length <= max && Reflect.ownKeys(v).every(k =>
    typeof k === 'string' && /^[A-Za-z0-9_.:/-]{1,128}$/.test(k) && !['__proto__', 'prototype', 'constructor'].includes(k) &&
    Object.hasOwn(Object.getOwnPropertyDescriptor(v, k), 'value') && check(v[k]));
};
const domainId = domainText();
const domainSid = { sessionId: domainId };
const domainOwner = { ...domainSid, projectId: domainId, browserId: domainId, tabId: domainId };
const domainDigest = v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const domainFile = domainObject({ path: v => domainText(1024)(v) && !/[:\x00-\x1f\x7f]/.test(v) &&
  v.replace(/\\/g, '/').split('/').every(p => p && p !== '.' && p !== '..' && !/[. ]$/.test(p)), digest: domainDigest });
const domainBinding = { ...domainSid, workspace: domainText(32768), workspaceRevision: domainInt(0) };
const domainMapping = domainObject({}, {
  titleMode: domainEnum('keep', 'custom', 'prefix', 'source', 'filename'), displayTitle: domainText(512, 0), prefix: domainText(512, 0), titlePrefix: domainText(512, 0),
  workspaceMode: domainEnum('none', 'current'), conflictPolicy: domainEnum('skip', 'new-copy'), updatePolicy: domainEnum('new-only', 'allow-updates'), credentialBindings: domainRecord(domainId),
});
const domainTarget = domainObject({ scope: domainEnum('user', 'project') });
const domainSource = domainEnum('chatgpt-export', 'sacode-migrate', 'text-file');
const domainPreview = v => {
  const common = { ...domainSid, sourceId: domainSource, kind: domainEnum('conversation', 'knowledge', 'config'), mapping: domainMapping, target: domainTarget };
  const meta = { candidateId: domainId, title: domainText(512, 0) };
  const conversation = domainObject({ ...common, candidates: domainArray(domainObject({ sourceKey: domainText(512), messages: domainArray(domainObject({ role: domainEnum('user', 'assistant'), text: domainText(1048576, 0) }), 10000) }, meta), 2000) });
  const knowledge = domainObject({ ...common, candidates: domainArray(domainObject({ sourceKey: domainText(512), content: domainText(65536, 0) }, meta), 200) });
  const config = domainObject({ ...common, payload: domainObject({ kind: domainEnum('config'), text: domainText(8388608) }) });
  if (conversation(v) && v.kind === 'conversation' && v.sourceId === 'chatgpt-export') return v.candidates.reduce((n, c) => n + c.messages.length, 0) <= 10000;
  if (knowledge(v) && v.kind === 'knowledge' && v.sourceId === 'text-file') return true;
  return config(v) && v.kind === 'config' && v.sourceId === 'sacode-migrate' && v.target.scope === 'user';
};
const domainSshArguments = v => {
  if (!domainText(131072)(v)) return false;
  try { return domainObject({ host: domainText(253), command: domainText(65536), user: domainText(256, 0), port: domainInt(1, 65535), timeoutMs: domainInt(1, 300000), connectTimeoutSec: domainInt(1, 60) })(JSON.parse(v)); } catch { return false; }
};
// MCP 服务器名与工具名：与 Host mcp_rpc.cj 的字节白名单一致（A-Z a-z 0-9 _ . -）。
const domainMcpName = v => typeof v === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(v);
// 连接定义：只持久化非秘密配置 + 凭据引用；凭据引用必须以字母或下划线开头，
// 与 core ConnectionDefinitionStore 的 credential 校验保持一致，阻止明文密码进入配置存储。
const domainCredentialRef = v => typeof v === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(v);
const domainConnectionTarget = { host: domainText(253), port: domainInt(1, 65535), user: domainText(256), credentialRef: domainCredentialRef };
const domainConnectionDefinition = v => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const common = { id: x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(x), title: domainText(600), enabled: x => typeof x === 'boolean' };
  const ssh = domainObject({ ...common, kind: domainEnum('ssh'), spec: domainObject(domainConnectionTarget) });
  const database = domainObject({ ...common, kind: domainEnum('database'), spec: domainObject({ ...domainConnectionTarget, engine: domainEnum('postgresql', 'mysql', 'dm'), database: domainText(256), tlsMode: domainEnum('verify-full') }) });
  const envRef = domainObject({ key: domainCredentialRef, credentialRef: domainCredentialRef });
  const stdio = domainObject({ ...common, kind: domainEnum('mcp'), spec: domainObject({ transport: domainEnum('stdio'), command: domainText(4096), args: domainArray(domainText(4096, 0), 100), envRefs: domainArray(envRef, 128) }) });
  const http = domainObject({ ...common, kind: domainEnum('mcp'), spec: domainObject({ transport: domainEnum('http'), endpoint: domainText(4096), credentialRef: domainCredentialRef }) });
  return ssh(v) || database(v) || stdio(v) || http(v);
};
const MCP_DEFAULT_TIMEOUT = 15000;
const domainBase64 = v => typeof v === 'string' && v.length <= 5464 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v) &&
  v.length / 4 * 3 - (v.endsWith('==') ? 2 : v.endsWith('=') ? 1 : 0) <= 4096;
// 语音录音身份与音频载荷：录音 id 只接受安全字符集；WAV 以有界 base64 传入（≤8 MiB 解码）。
const domainVoiceId = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v);
const domainAudioBase64 = v => typeof v === 'string' && v.length <= 11800000 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v);
const domainUrl = v => {
  if (!domainText(8192)(v)) return false;
  try { const url = new URL(v); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
};
function domainParams(args, required, optional = {}) {
  if (!domainObject(required, optional)(args)) throw new TypeError('ipc-invalid-arguments');
  // 仅从经校验的数据字段构造请求，不补默认值或转写审批/会话身份。
  return Object.fromEntries(Object.keys(args).map(k => [k, args[k]]));
}
function domainChecked(args, check) {
  if (!check(args)) throw new TypeError('ipc-invalid-arguments');
  return Object.fromEntries(Object.keys(args).map(k => [k, args[k]]));
}
ipcMain.handle('sacode:browserNavigate', async (_e, a) => { const p = domainParams(a, { ...domainOwner, url: domainUrl }); return withHost(() => bridge.request('browser/navigate', p)); });
ipcMain.handle('sacode:browserScreenshot', async (_e, a) => { const p = domainParams(a, domainOwner); return withHost(() => bridge.request('browser/screenshot', p)); });
ipcMain.handle('sacode:browserClick', async (_e, a) => { const p = domainParams(a, { ...domainOwner, x: domainInt(0, 32767), y: domainInt(0, 32767) }); return withHost(() => bridge.request('browser/click', p)); });
ipcMain.handle('sacode:browserInput', async (_e, a) => { const p = domainParams(a, { ...domainOwner, text: domainText(65536, 0) }); return withHost(() => bridge.request('browser/input', p)); });
ipcMain.handle('sacode:browserScroll', async (_e, a) => { const p = domainParams(a, { ...domainOwner, deltaX: domainInt(-32767, 32767), deltaY: domainInt(-32767, 32767) }); return withHost(() => bridge.request('browser/scroll', p)); });
ipcMain.handle('sacode:browserClose', async (_e, a) => { const p = domainParams(a, domainOwner); return withHost(() => bridge.request('browser/close', p)); });
ipcMain.handle('sacode:databaseConnect', async (_e, a) => { const p = domainParams(a, { ...domainSid, projectId: domainId, spec: domainObject({ engine: domainEnum('postgresql', 'mysql', 'dm'), host: domainText(253), port: domainInt(1, 65535), database: domainText(256), user: domainText(256), credentialRef: domainId, tlsMode: domainEnum('verify-full'), readonly: domainEnum(true), connectTimeoutMs: domainInt(1, 300000), statementTimeoutMs: domainInt(1, 300000) }) }); return withHost(() => bridge.request('database/connect', p)); });
// 连接定义管理：只持久化非秘密配置 + 凭据引用，不发起真实连接/信任/执行；
// 启用定义不等于启动连接，连接检查与执行仍走各自独立审批通道（ssh/exec、mcp/connect、database/connect）。
ipcMain.handle('sacode:connectionList', async (_e, a) => { const p = domainParams(a, { sessionId: domainId, scope: domainEnum('user', 'project') }); return withHost(() => bridge.request('connection/list', p)); });
ipcMain.handle('sacode:connectionSave', async (_e, a) => { const p = domainParams(a, { sessionId: domainId, scope: domainEnum('user', 'project'), revision: domainInt(0), definition: domainConnectionDefinition }); return withHost(() => bridge.request('connection/save', p)); });
ipcMain.handle('sacode:connectionControl', async (_e, a) => { const p = domainParams(a, { sessionId: domainId, scope: domainEnum('user', 'project'), revision: domainInt(0), id: domainText(80), action: domainEnum('enable', 'disable', 'remove') }); return withHost(() => bridge.request('connection/control', p)); });
ipcMain.handle('sacode:databaseDisconnect', async (_e, a) => { const p = domainParams(a, { connectionId: domainId }); return withHost(() => bridge.request('database/disconnect', p)); });
ipcMain.handle('sacode:databaseQuery', async (_e, a) => { const p = domainParams(a, { connectionId: domainId, sql: domainText(1048576), params: domainArray(v => v === null || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v) || domainText(65536, 0)(v), 1000), opts: domainObject({ readonly: domainEnum(true), maxRows: domainInt(1, 10000), maxBytes: domainInt(1, 16777216), statementTimeoutMs: domainInt(1, 300000), cursorBatch: domainInt(1, 10000) }) }); return withHost(() => bridge.request('database/query', p)); });
ipcMain.handle('sacode:importSources', async (_e, a) => { const p = domainParams(a, domainSid); return withHost(() => bridge.request('import/sources', p)); });
ipcMain.handle('sacode:importPickFile', async (_e, a) => { const p = domainParams(a, { ...domainSid, sourceId: domainSource }); return withHost(() => bridge.request('import/pick-file', p)); });
ipcMain.handle('sacode:importPreview', async (_e, a) => { const p = domainChecked(a, domainPreview); return withHost(() => bridge.request('import/preview', p)); });
ipcMain.handle('sacode:importPlan', async (_e, a) => { const p = domainParams(a, { ...domainSid, previewToken: domainId }, { mapping: domainMapping, target: domainTarget }); return withHost(() => bridge.request('import/plan', p)); });
ipcMain.handle('sacode:importConfirm', async (_e, a) => { const p = domainParams(a, { ...domainSid, planHash: domainDigest, decisions: domainRecord(domainEnum('append', 'overwrite', 'skip', 'dismiss'), 2000) }); return withHost(() => bridge.request('import/confirm', p)); });
ipcMain.handle('sacode:importApply', async (_e, a) => { const p = domainChecked(a, v => domainObject({ ...domainSid, jobId: domainId })(v) || domainObject({ ...domainSid, planHash: domainDigest, requestId: domainText(200) }, { selection: domainObject({ itemIds: domainArray(domainId, 2000) }) })(v)); return withHost(() => bridge.request('import/apply', p)); });
ipcMain.handle('sacode:importDescribe', async (_e, a) => { const p = domainParams(a, { ...domainSid, jobId: domainId }, { offset: domainInt(0), limit: domainInt(1, 200) }); return withHost(() => bridge.request('import/describe', p)); });
ipcMain.handle('sacode:importCancel', async (_e, a) => { const p = domainParams(a, { ...domainSid, jobId: domainId }); return withHost(() => bridge.request('import/cancel', p)); });
ipcMain.handle('sacode:terminalCreate', async (_e, a) => { const p = domainParams(a, { cwd: domainText(32768), env: domainRecord(domainText(32768, 0)), cols: domainInt(1, 32767), rows: domainInt(1, 32767) }); return withHost(() => bridge.request('terminal/create', p)); });
ipcMain.handle('sacode:terminalInput', async (_e, a) => { const p = domainParams(a, { ...domainSid, data: domainBase64 }); return withHost(() => bridge.request('terminal/input', p)); });
ipcMain.handle('sacode:terminalResize', async (_e, a) => { const p = domainParams(a, { ...domainSid, cols: domainInt(1, 32767), rows: domainInt(1, 32767) }); return withHost(() => bridge.request('terminal/resize', p)); });
ipcMain.handle('sacode:terminalInterrupt', async (_e, a) => { const p = domainParams(a, domainSid); return withHost(() => bridge.request('terminal/interrupt', p)); });
ipcMain.handle('sacode:terminalDescribe', async (_e, a) => { const p = domainParams(a, domainSid, { limit: domainInt(1, 262144) }); return withHost(() => bridge.request('terminal/describe', p)); });
ipcMain.handle('sacode:terminalClose', async (_e, a) => { const p = domainParams(a, domainSid); return withHost(() => bridge.request('terminal/close', p)); });
ipcMain.handle('sacode:terminalPtyOutput', async (_e, a) => { const p = domainParams(a, { ...domainSid, cursor: domainInt(0) }); return withHost(() => bridge.request('terminal/output', p)); });
ipcMain.handle('sacode:terminalKill', async (_e, a) => { const p = domainParams(a, domainSid); return withHost(() => bridge.request('terminal/kill', p)); });
ipcMain.handle('sacode:compactRun', async (_e, a) => { const p = domainParams(a, { ...domainSid, requestId: domainText(128) }); return withHost(() => bridge.request('compact/run', p)); });
ipcMain.handle('sacode:compactDescribe', async (_e, a) => { const p = domainParams(a, domainSid); return withHost(() => bridge.request('compact/describe', p)); });
ipcMain.handle('sacode:securityScan', async (_e, a) => { const p = domainParams(a, { ...domainSid, requestId: domainId, scope: domainArray(domainFile, 10000) }); return withHost(() => bridge.request('security/scan', p)); });
ipcMain.handle('sacode:securityDescribe', async (_e, a) => { const p = domainParams(a, domainSid); return withHost(() => bridge.request('security/describe', p)); });
ipcMain.handle('sacode:securityFreshness', async (_e, a) => { const p = domainParams(a, { ...domainSid, scanId: domainId }); return withHost(() => bridge.request('security/freshness', p)); });
ipcMain.handle('sacode:securityFixDraft', async (_e, a) => { const p = domainParams(a, { ...domainSid, scanId: domainId, findingIds: domainArray(domainId, 10000) }); return withHost(() => bridge.request('security/fix-draft', p)); });
ipcMain.handle('sacode:sshExec', async (_e, a) => { const p = domainParams(a, { ...domainSid, arguments: domainSshArguments, approvalId: domainInt(1) }); return withHost(() => bridge.request('ssh/exec', p)); });
ipcMain.handle('sacode:sshDescribe', async (_e, a) => { const p = domainParams(a, domainSid); return withHost(() => bridge.request('ssh/describe', p)); });
// MCP 六动词：preload 给出扁平参数，主进程在此打包成 Host mcp_rpc.cj 期望的嵌套 args JSON 字符串。
// connect 与 call 必须携带审批票；argumentsJson 必须可解析为 JSON 对象后才转发。
// 不回显原始传输异常 message，JSON.parse 失败时只报稳定 failureKind。
ipcMain.handle('sacode:mcpList', async (_e, a) => { const p = domainParams(a, domainSid); return withHost(() => bridge.request('mcp/list', p)); });
ipcMain.handle('sacode:mcpConnect', async (_e, a) => {
  const p = domainParams(a, { ...domainSid, name: domainMcpName, command: domainText(1024), args: domainArray(domainText(32768), 100), approvalId: domainInt(1) }, { timeoutMs: domainInt(1, 30000) });
  const inner = { command: p.command, args: p.args, timeoutMs: p.timeoutMs ?? MCP_DEFAULT_TIMEOUT };
  const args = JSON.stringify(inner);
  return withHost(() => bridge.request('mcp/connect', { sessionId: p.sessionId, name: p.name, args, approvalId: p.approvalId }));
});
ipcMain.handle('sacode:mcpDisconnect', async (_e, a) => { const p = domainParams(a, { ...domainSid, name: domainMcpName }); return withHost(() => bridge.request('mcp/disconnect', p)); });
ipcMain.handle('sacode:mcpTools', async (_e, a) => {
  const p = domainParams(a, { ...domainSid, name: domainMcpName });
  return withHost(() => bridge.request('mcp/tools', { sessionId: p.sessionId, name: p.name, timeoutMs: MCP_DEFAULT_TIMEOUT }));
});
ipcMain.handle('sacode:mcpCall', async (_e, a) => {
  const p = domainParams(a, { ...domainSid, name: domainMcpName, toolName: domainMcpName, approvalId: domainInt(1) }, { argumentsJson: domainText(65536) });
  const argumentsJson = p.argumentsJson ?? '{}';
  let parsed;
  try { parsed = JSON.parse(argumentsJson); } catch { throw new TypeError('mcp-bad-arguments'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError('mcp-bad-arguments');
  const inner = { tool: p.toolName, argumentsJson, timeoutMs: MCP_DEFAULT_TIMEOUT };
  const args = JSON.stringify(inner);
  return withHost(() => bridge.request('mcp/call', { sessionId: p.sessionId, name: p.name, args, approvalId: p.approvalId }));
});
ipcMain.handle('sacode:mcpStatus', async (_e, a) => { const p = domainParams(a, { ...domainSid, name: domainMcpName }); return withHost(() => bridge.request('mcp/status', p)); });
ipcMain.handle('sacode:automationTick', async (_e, a) => { const p = domainParams(a, { ...domainSid, scopeId: domainId }); return withHost(() => bridge.request('automation/tick', p)); });
ipcMain.handle('sacode:automationDescribeExecution', async (_e, a) => { const p = domainParams(a, { ...domainSid, scopeId: domainId, taskId: domainText(80) }, { fireId: domainId }); return withHost(() => bridge.request('automation/describe-execution', p)); });
ipcMain.handle('sacode:knowledgeIndexBuild', async (_e, a) => { const p = domainParams(a, { ...domainBinding, indexRevision: domainInt(0), files: domainArray(domainFile, 10000) }); return withHost(() => bridge.request('knowledge/index-build', p)); });
ipcMain.handle('sacode:knowledgeSearch', async (_e, a) => { const p = domainParams(a, { ...domainBinding, indexRevision: domainInt(0), query: domainText(2048, 0) }, { limit: domainInt(1, 12) }); return withHost(() => bridge.request('knowledge/search', p)); });
ipcMain.handle('sacode:knowledgeDescribeIndex', async (_e, a) => { const p = domainParams(a, domainBinding); return withHost(() => bridge.request('knowledge/describe-index', p)); });
// 语音：录制（采集）在桌面渲染层完成，主进程只把校验过的 WAV 写进本会话隔离目录 voice/v1/，
// 再由宿主 voice/record 按固定命名「导入登记」——渲染层给不出落盘路径、URL 或外部执行参数。
// 转写走独立审批票（渲染层先经 approvalAsk 取票），与 Host voice_rpc.cj 的 consumeExactForCall 一致。
const VOICE_DIR = join(SESSION_DIR, 'voice', 'v1');
ipcMain.handle('sacode:voiceDescribe', async (_e, a) => {
  const p = domainParams(a, domainSid, { operationId: domainId });
  return withHost(() => bridge.request('voice/describe', p));
});
ipcMain.handle('sacode:voiceRecord', async (_e, a) => {
  const p = domainParams(a, { ...domainSid, requestId: domainText(128), recordingId: domainVoiceId, wavBase64: domainAudioBase64 }, { durationMs: domainInt(0, 600000) });
  let raw;
  try { raw = Buffer.from(p.wavBase64, 'base64'); } catch { throw new Error('voice-bad-recording'); }
  // 只接受 RIFF/WAVE 头与有界长度，避免把任意字节塞进会话目录。
  const isWav = raw.length >= 44 && raw.length <= 26214400 && raw[0] === 0x52 && raw[1] === 0x49 && raw[2] === 0x46 && raw[3] === 0x46 &&
    raw[8] === 0x57 && raw[9] === 0x41 && raw[10] === 0x56 && raw[11] === 0x45;
  if (!isWav) throw new Error('voice-bad-recording');
  if (!existsSync(VOICE_DIR)) mkdirSync(VOICE_DIR, { recursive: true });
  writeFileSync(join(VOICE_DIR, `${p.recordingId}.wav`), raw);
  const params = { sessionId: p.sessionId, action: 'import', requestId: p.requestId, recordingId: p.recordingId, digest: createHash('sha256').update(raw).digest('hex'), bytes: raw.length };
  if (p.durationMs !== undefined) params.durationMs = p.durationMs;
  return withHost(() => bridge.request('voice/record', params));
});
ipcMain.handle('sacode:voiceTranscribe', async (_e, a) => {
  const p = domainParams(a, { ...domainSid, requestId: domainText(128), recordingId: domainVoiceId, language: domainEnum('zh', 'auto') }, { approvalId: domainInt(1) });
  // 不带 approvalId 时宿主按规范参数发号并返回 pending-approval；作答后带票重试。
  const params = { sessionId: p.sessionId, action: 'start', requestId: p.requestId, recordingId: p.recordingId, language: p.language };
  if (p.approvalId !== undefined) params.approvalId = p.approvalId;
  return withHost(() => bridge.request('voice/transcribe', params));
});
ipcMain.handle('sacode:voiceTranscribeCancel', async (_e, a) => {
  const p = domainParams(a, { ...domainSid, operationId: domainId });
  return withHost(() => bridge.request('voice/transcribe', { sessionId: p.sessionId, action: 'cancel', operationId: p.operationId }));
});

require('./team-ipc.cjs').registerTeamIpc(ipcMain, (method, args) => withHost(() => bridge.request(method, args)));

// 会话级隔离工作树：进出面 4 个通道（进入/描述/退出/清理）的逐字段校验都在 worktree-ipc.cjs。
// git 建树与 PR 抓取天生比常规调用慢（契约里 PR 抓取最长等 30 秒），所以这一面单独给一个
// 有界超时，而不是抬高全局默认值（那会把真卡死的调用也放更久）。
const WORKTREE_TIMEOUT = 45000;
const { registerWorktreeIpc, protectClose } = require('./worktree-ipc.cjs');
const worktreeRequest = (method, args) => withHost(() => bridge.request(method, args, WORKTREE_TIMEOUT));

// 原生模态只在人工运行的窗口里弹：冒烟态没有人在键盘前，
// 拿不到确认就等于没确认——绝不允许替用户点「删除」。
const worktreeDialog = (options) => (win && !win.isDestroyed() ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options));

// 删除确认只有这一个实现：面板删除与关闭时删除共用，所以两处「代价说明」必然一致。
// 选项固定 删除/取消，defaultId 落在取消上；未提交数与独有提交数取自刚核实的权威状态。
async function confirmWorktreeRemoval(state, discardChanges) {
  if (WILL_SMOKE) return false;
  const { response } = await worktreeDialog({
    type: 'warning',
    buttons: ['取消', '删除工作树'],
    defaultId: 0,
    cancelId: 0,
    title: '删除隔离工作树',
    message: `要删除工作树 ${state.name} 吗？`,
    detail: [
      `分支 ${state.branch}`,
      `未提交文件 ${state.uncommittedCount} 个 · 独有提交 ${state.uniqueCommits} 个`,
      discardChanges ? '已允许丢弃未提交更改；独有提交没有任何强制通路，存在时删除会被拒绝。'
        : '目录里有未提交更改时删除会被拒绝；需要丢弃请回来勾选对应选项。',
    ].join('\n'),
  });
  return response === 1;
}

// 关闭时的保留/删除/取消三选项，与渲染层退出对话框同一套语义、同一份计数来源。
async function chooseWorktreeClose(state) {
  if (WILL_SMOKE) return 'cancel';
  const { response } = await worktreeDialog({
    type: 'question',
    buttons: ['保留', '删除', '取消'],
    defaultId: 0,
    cancelId: 2,
    title: '仍有活动的隔离工作树',
    message: `关闭前如何处理工作树 ${state.name}？`,
    detail: [
      `分支 ${state.branch} · 目录 ${state.directory}`,
      `未提交文件 ${state.uncommittedCount} 个 · 独有提交 ${state.uniqueCommits} 个`,
      '保留=退出但留着目录与分支，下次进入同一会话仍绑在这里；删除=退出并删目录（有独有提交时会被拒绝）；取消=不关闭。',
    ].join('\n'),
  });
  return ['keep', 'remove', 'cancel'][response];
}

// 关闭守卫失败后的处置：把原因原样端出来，绝不「静默强删」。
// 读不到状态（宿主起不来/已断线）时唯一安全的选择是「保留」——绑定写在会话日志里，
// 进程重启后依旧生效，什么都没删；这时允许关闭并说明。
// 用户已选保留/删除而宿主拒绝时（独有提交、脏目录），默认停在原地，重试或明确选择保留后才关。
async function resolveWorktreeCloseFailure(error, stateUnknown) {
  console.error(`[worktree] 关闭守卫失败: ${error && error.message ? error.message : error}`);
  if (WILL_SMOKE) return true;
  const { response } = await worktreeDialog({
    type: 'error',
    buttons: stateUnknown ? ['知道了，保留工作树并关闭'] : ['留在应用里', '保留工作树并关闭'],
    defaultId: 0,
    cancelId: 0,
    title: stateUnknown ? '无法确认隔离工作树状态' : '工作树未结算',
    message: String(error && error.message ? error.message : error),
    detail: stateUnknown
      ? '读不到工作树绑定，因此不会删除任何东西；绑定仍在会话日志里，下次进入同一会话时依旧生效。'
      : '没有删除任何东西。工作树仍在原地，可以先留在应用里处理，或选择保留后关闭（下次进入仍绑在这里）。',
  });
  return stateUnknown || response === 1;
}

registerWorktreeIpc({
  ipcMain,
  request: worktreeRequest,
  confirmDelete: (state, discardChanges) => confirmWorktreeRemoval(state, discardChanges),
});

require('./execution-ipc.cjs').registerExecutionIpc(ipcMain, (method, args) => withHost(() => bridge.request(method, args)));

require('./execution-history-ipc.cjs').registerExecutionHistoryIpc(ipcMain, (method, args) => withHost(() => bridge.request(method, args)));
ipcMain.handle("sacode:projection", async () => withHost(() => bridge.request("session/projection")));

// 暂存凭证是宿主铸造的短串，界面只能原样带回，拼不出别的形状
const RECEIPT_RE = /^u[1-9]\d{0,6}$/;

ipcMain.handle("sacode:userSend", async (_e, args) => {
  if (!args || !isStr(args.text) || args.text.length === 0 || args.text.length > 8000) {
    throw new Error("bad arguments");
  }
  const ids = args.receiptIds == null ? [] : args.receiptIds;
  if (!Array.isArray(ids) || ids.length > 20 || !ids.every((v) => isStr(v) && RECEIPT_RE.test(v))) {
    throw new Error("bad arguments");
  }
  const params = ids.length
    ? { eventType: "user/message", data: args.text, receiptIds: ids }
    : { eventType: "user/message", data: args.text };
  return withHost(() => bridge.request("session/append", params));
});

ipcMain.handle("sacode:attachmentUpload", async (_e, args) => {
  // 入参只有四格：kind、显示名、声明类型、base64。落盘位置与内容寻址 id 都在核心那一侧。
  if (!args || (args.kind !== "image" && args.kind !== "file")
    || !isStr(args.name) || args.name.length > 300
    || !isStr(args.mediaType) || args.mediaType.length > 100
    || !isStr(args.data) || args.data.length > 28000000) {
    throw new Error("bad arguments");
  }
  return withHost(() => bridge.request("attachment/upload", {
    kind: args.kind, name: args.name, mediaType: args.mediaType, data: args.data,
  }));
});

ipcMain.handle("sacode:toolsList", async () => withHost(() => bridge.request("extension/list")));

// 固定目标动作；完成只由执行证据通道决定，不向网页开放 goalComplete。
function goalArguments(args, fields) {
  if (!args || Object.keys(args).some(key => !fields.includes(key))
    || !isStr(args.sessionId) || !args.sessionId || args.sessionId.length > 300
    || (fields.includes('revision') && (!Number.isSafeInteger(args.revision) || args.revision < 1))
    || (fields.includes('objective') && (!isStr(args.objective) || !args.objective.trim() || args.objective.length > 8000))) throw Error('bad arguments');
  return Object.fromEntries(fields.map(key => [key, args[key]]));
}
ipcMain.handle('sacode:goalDescribe', async (_e, args) => { const params = goalArguments(args, ['sessionId']); return withHost(() => bridge.request('goal/describe', params)); });
ipcMain.handle('sacode:goalCreate', async (_e, args) => { const params = goalArguments(args, ['sessionId', 'objective']); return withHost(() => bridge.request('goal/create', params)); });
ipcMain.handle('sacode:goalEdit', async (_e, args) => { const params = goalArguments(args, ['sessionId', 'revision', 'objective']); return withHost(() => bridge.request('goal/edit', params)); });
ipcMain.handle('sacode:goalPause', async (_e, args) => { const params = goalArguments(args, ['sessionId', 'revision']); return withHost(() => bridge.request('goal/pause', params)); });
ipcMain.handle('sacode:goalResume', async (_e, args) => { const params = goalArguments(args, ['sessionId', 'revision']); return withHost(() => bridge.request('goal/resume', params)); });
ipcMain.handle('sacode:goalClear', async (_e, args) => { const params = goalArguments(args, ['sessionId', 'revision']); return withHost(() => bridge.request('goal/clear', params)); });

ipcMain.handle("sacode:attachmentImageRead", async (_e, args) => {
  if (!args || Object.keys(args).some(key => key !== 'sessionId' && key !== 'attachmentId')
    || !isStr(args.sessionId) || !args.sessionId || args.sessionId.length > 300
    || !isStr(args.attachmentId) || !/^sha256:[a-f0-9]{64}$/.test(args.attachmentId)) throw Error('bad arguments');
  return withHost(() => bridge.request('attachment/image-read', { sessionId: args.sessionId, attachmentId: args.attachmentId }));
});

ipcMain.handle("sacode:toolCall", async (_e, args) => {
  // 审批凭据只能是工单号：渲染层传不动「我已经批过了」这句话——它得先去 ask/answer。
  // 主进程补长度上限，与 approvalAsk（name≤200、args≤262144）对齐，挡住超大 payload。
  if (!args || !isStr(args.name) || args.name.length === 0 || args.name.length > 200 || !isStr(args.args) || args.args.length > 262144) {
    throw new Error("bad arguments");
  }
  const approvalId = args.approvalId === undefined ? 0 : args.approvalId;
  if (!Number.isInteger(approvalId) || approvalId < 0) {
    throw new Error("bad arguments");
  }
  const params = approvalId > 0
    ? { name: args.name, args: args.args, approvalId }
    : { name: args.name, args: args.args };
  return withHost(() => bridge.request("extension/call", params));
});

ipcMain.handle("sacode:approvalAsk", async (_e, args) => {
  if (!args || !isStr(args.name) || args.name.length === 0 || args.name.length > 200) {
    throw new Error("bad arguments");
  }
  if (Object.prototype.hasOwnProperty.call(args, 'args') && (!isStr(args.args) || args.args.length > 262144)) throw new Error("bad arguments");
  const proposal = Object.prototype.hasOwnProperty.call(args, 'args') ? { name: args.name, args: args.args } : { name: args.name };
  return withHost(() => bridge.request("approval/ask", proposal));
});

ipcMain.handle("sacode:approvalAnswer", async (_e, args) => {
  if (!args || !Number.isInteger(args.approvalId) || args.approvalId < 1 || !isStr(args.decision) || !["allowed-once", "denied"].includes(args.decision)) {
    throw new Error("bad arguments");
  }
  return withHost(() => bridge.request("approval/answer", { approvalId: args.approvalId, decision: args.decision }));
});

	ipcMain.handle("sacode:approvalSetMode", async (_e, args) => {
	  if (!args || !isStr(args.mode) || !["plan","build","auto","yolo"].includes(args.mode)) throw Error("bad-approval-mode");
	  return withHost(() => bridge.request("approval/set-mode", { mode: args.mode }));
	});
	ipcMain.handle("sacode:approvalGetMode", async () => withHost(() => bridge.request("approval/get-mode")));

	// 计划模式与计划审阅：按动作命名、逐字段校验，不提供任意 method 转发。
	ipcMain.handle("sacode:planSetMode", async (_e, args) => {
	  if (!args || typeof args.active !== "boolean") throw Error("bad-plan-mode");
	  return withHost(() => bridge.request("plan/set-mode", { active: args.active }));
	});
	ipcMain.handle("sacode:planGetMode", async () => withHost(() => bridge.request("plan/get-mode")));
	ipcMain.handle("sacode:planReviewAnswer", async (_e, args) => {
	  if (!args || !isStr(args.sessionId) || !isStr(args.planId) || !isStr(args.decision) || !isStr(args.feedback) || typeof args.cancelled !== "boolean") throw Error("bad-plan-answer");
	  return withHost(() => bridge.request("plan/review-answer", { sessionId: args.sessionId, planId: args.planId, decision: args.decision, feedback: args.feedback, cancelled: args.cancelled }));
	});


ipcMain.handle("sacode:turnStart", async (_e, args) => {
  const limit = args ? args.limit : 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 8) {
    throw new Error("bad arguments");
  }
  // 诊断起轮同样开新轮：上一次的游标不能带进新帧日志。
  turnPollCursor = 0;
  turnPollTurnId = null;
  return withHost(() => bridge.request("turn/start", { limit }));
});

// 产品发送后的起轮走这一条：task/start 只认真实配置，缺配置/缺凭据/协议不支持一律显式报错，
// 不像 turn/start 那样在没配置时静默退回示例 provider——界面上演一场假成功比报错更糟。
ipcMain.handle("sacode:taskStart", async (_e, args) => {
  const customModelId = args?.customModelId;
  if (customModelId !== undefined && (typeof customModelId !== "string" || customModelId.length > 256)) throw Error("bad-custom-model-id");
  return withHost(async () => {
    if (pageToolsWindow()) await pageToolBridge.attach(true);
    const turnRequestId = String(bridge.nextId);
    // 新轮开始前清本地游标：即使起轮失败也不能拿上一轮的游标去读新日志。
    turnPollCursor = 0;
    turnPollTurnId = null;
    // HostBridge.request 已经封装 JSON-RPC params，不能在这里再嵌套一层 params。
    // 二次嵌套会让宿主忽略 customModelId，退回默认模型而不是执行页面选中的模型。
    const started = await bridge.request("task/start", customModelId ? { customModelId } : {});
    modelTurnRequestId = turnRequestId;
    modelApproval.discardPreviousRequests(bridge, turnRequestId);
    return { ...started, turnRequestId };
  });
});
ipcMain.handle("sacode:ledgerStats", async () => withHost(() => bridge.request("ledger/stats", {})));

// 队列三动作逐字段校验：条目身份只能来自核心铸造的那串 id，
// 渲染层拼不出「改任意一条」或「带任意正文的未知动作」。
const QUEUE_ID = /^q\d{1,18}$/;
const QUEUE_KINDS = ["edit", "remove", "steer"];

ipcMain.handle("sacode:queueDescribe", async () => withHost(() => bridge.request("queue/describe")));

ipcMain.handle("sacode:queueEnqueue", async (_e, args) => {
  if (!args || !isStr(args.text) || args.text.trim().length === 0 || args.text.length > 8000
    || !isStr(args.rpcId) || args.rpcId.length === 0 || args.rpcId.length > 128) {
    throw new Error("bad arguments");
  }
  const accelerated = args.accelerated === undefined ? false : args.accelerated;
  if (typeof accelerated !== 'boolean') throw new Error('bad arguments');
  // 排队也可以带附件：凭证形状与发送那条通道同一套校验，不给自报字符串留通路
  const ids = args.receiptIds == null ? [] : args.receiptIds;
  if (!Array.isArray(ids) || ids.length > 20 || !ids.every((v) => isStr(v) && RECEIPT_RE.test(v))) {
    throw new Error("bad arguments");
  }
  return withHost(() => bridge.request("queue/enqueue", ids.length
    ? { text: args.text, rpcId: args.rpcId, receiptIds: ids, ...(accelerated ? {accelerated} : {}) }
    : { text: args.text, rpcId: args.rpcId, ...(accelerated ? {accelerated} : {}) }));
});

ipcMain.handle("sacode:queueUpdate", async (_e, args) => {
  if (!args || !isStr(args.itemId) || !QUEUE_ID.test(args.itemId) || !QUEUE_KINDS.includes(args.kind)) {
    throw new Error("bad arguments");
  }
  const text = args.text === undefined || args.text === null ? "" : args.text;
  if (!isStr(text) || text.length > 8000) {
    throw new Error("bad arguments");
  }
  return withHost(() => bridge.request("queue/update", { itemId: args.itemId, kind: args.kind, text }));
});

ipcMain.handle("sacode:turnPoll", async () => withHost(async () => {
  const turnRequestId = modelTurnRequestId;
  // 主进程替渲染层持有游标：渲染层接口保持不变，多端同时读时不互相偷帧。
  const params = { cursor: turnPollCursor };
  if (turnPollTurnId !== null) params.turnId = turnPollTurnId;
  const poll = await bridge.request("turn/poll", params);
  if (poll.reset === true) {
    // Host 已换轮：从新轮头读，旧 turnId 作废。若新轮尚未开始（turnId=0），
    // 下一次 poll 不带 turnId，避免与「当前轮=0」误判为错配。
    turnPollCursor = Number.isSafeInteger(poll.nextCursor) && poll.nextCursor >= 0 ? poll.nextCursor : 0;
    turnPollTurnId = Number.isSafeInteger(poll.turnId) && poll.turnId > 0 ? poll.turnId : null;
  } else {
    if (Number.isSafeInteger(poll.nextCursor) && poll.nextCursor >= 0) turnPollCursor = poll.nextCursor;
    if (Number.isSafeInteger(poll.turnId)) turnPollTurnId = poll.turnId > 0 ? poll.turnId : null;
  }
  return { ...poll, turnRequestId, approvalRequests: modelApproval.takeRequests(bridge, turnRequestId) };
}));

ipcMain.handle("sacode:turnCancel", async () => withHost(() => bridge.request("turn/cancel")));
// 提示词增强：草稿是唯一入参，逐字段校验在这里做——空白与超长在主进程就拒收，
// 一条都不许发到宿主。宿主因此只会收到「确实有内容的这一条」，
// 而用哪颗模型、哪份凭据由宿主自己按当前会话定，这条通道给不出那个位置。
ipcMain.handle("sacode:promptEnhance", async (_e, args) => {
  if (!args || !isStr(args.draft) || args.draft.trim().length === 0 || args.draft.length > 8000) {
    throw new Error("bad arguments");
  }
  return withHost(() => bridge.request("prompt/enhance", { draft: args.draft }));
});
// 轮询与取消没有负载：增强进行到哪一步只能由宿主说，渲染层猜不出也改不了。
ipcMain.handle("sacode:promptPoll", async () => withHost(() => bridge.request("prompt/poll")));
ipcMain.handle("sacode:promptCancel", async () => withHost(() => bridge.request("prompt/cancel")));
ipcMain.handle("sacode:usageStatus", async () => withHost(() => bridge.request("usage/status")));
// 预算只许收紧：非整数、负数在主进程就拒收，调大由核心回 applied:false。
// 界面拿不到「抬高当前档位」的任何通路，也拿不到发任意方法的那条通道。
ipcMain.handle("sacode:usageSetBudget", async (_e, args) => {
  const b = args && args.budget;
  if (typeof b !== "number" || !Number.isInteger(b) || b < 0) throw new Error("bad-budget");
  return withHost(() => bridge.request("usage/set-budget", { budget: b }));
});

ipcMain.handle("sacode:sessionCatalog", async () => withHost(() => bridge.request("session/catalog")));
ipcMain.handle("sacode:workspaceGet", async () => withHost(()=>bridge.request("workspace/get")));
ipcMain.handle('sacode:workspaceRecent', async () => withHost(() => bridge.request('workspace/recent')));
ipcMain.handle('sacode:workspaceSelectRecent', async (_e, args) => {
  if (!args || Object.keys(args).length !== 2 || !isStr(args.recentId) || !args.recentId || args.recentId.length > 512
    || !isStr(args.sessionId) || !args.sessionId || args.sessionId.length > 300) throw Error('bad-recent-workspace');
  return withHost(() => bridge.request('workspace/select-recent', {recentId:args.recentId,sessionId:args.sessionId}));
});
ipcMain.handle("sacode:workspaceChoose", async () => withHost(async()=>{
  const workspace=await bridge.request("workspace/get");
  // 直接让用户在原生文件夹选择器中选项目；不预填应用目录、文档目录或可编辑路径。
  const choice=await chooseWorkspaceDirectory({title:"打开项目文件夹", buttonLabel:"选择项目", properties:["openDirectory"]});
  if(choice.canceled) return {cancelled:true};
  if(!Array.isArray(choice.filePaths) || choice.filePaths.length!==1 || !isStr(choice.filePaths[0])) throw new Error("bad directory selection");
  return bridge.request("workspace/set-directory", {directory:choice.filePaths[0],sessionId:workspace.sessionId});
}));
ipcMain.handle("sacode:workspaceFiles", async (_e, args) => {
  // path 只收相对子路径：反斜杠、控制字符与超长一律拒，绝对路径也拒（宿主侧还会做边界复核）。
  const path = args && args.path;
  if (path !== undefined && (!isStr(path) || path.length > 512 || /[\\:\x00-\x1f]/.test(path) || /^[a-zA-Z]:/.test(path) || path.startsWith("/") || path.includes(".."))) {
    throw new Error("bad-workspace-path");
  }
  return withHost(()=>bridge.request("workspace/files", {path: path || ""}));
});
ipcMain.handle('sacode:terminalOutput',async(_e,args)=>{
  if(!args||Object.keys(args).length!==3||!isStr(args.sessionId)||!args.sessionId||args.sessionId.length>300||!Number.isSafeInteger(args.cursor)||args.cursor<0||!Number.isInteger(args.limit)||args.limit<1||args.limit>16)throw Error('bad-terminal-arguments');
  return withHost(()=>bridge.request('session/terminal-output',{sessionId:args.sessionId,cursor:args.cursor,limit:args.limit}));
});
function gitArguments(args,diff) {
  const fields=diff?['sessionId','directory','path','scope']:['sessionId','directory'];
  if(!args||Object.keys(args).some(k=>!fields.includes(k))||!isStr(args.sessionId)||!args.sessionId||args.sessionId.length>300||!isStr(args.directory)||!args.directory||args.directory.length>2048)throw Error('bad-git-arguments');
  if(diff&&(!isStr(args.path)||!args.path||args.path.length>512||/[\\:\x00-\x1f]/.test(args.path)||args.path.startsWith('/')||args.path.split('/').some(p=>!p||p==='.'||p==='..')||!['working','index'].includes(args.scope)))throw Error('bad-git-path');
  return Object.fromEntries(fields.map(k=>[k,args[k]]));
}
ipcMain.handle('sacode:workspaceGitStatus',async(_e,args)=>{const params=gitArguments(args,false);return withHost(()=>bridge.request('workspace/git-status',params));});
ipcMain.handle('sacode:workspaceGitDiff',async(_e,args)=>{const params=gitArguments(args,true);return withHost(()=>bridge.request('workspace/git-diff',params));});
ipcMain.handle('sacode:workspaceGitPushTarget',async(_e,args)=>{const params=gitArguments(args,false);return withHost(()=>bridge.request('workspace/git-push-target',params));});
ipcMain.handle("sacode:globalSettingsGet", async () => withHost(()=>bridge.request("global/settings/get")));
ipcMain.handle('sacode:profileGet', async () => withHost(() => bridge.request('profile/get')));
ipcMain.handle('sacode:profileUpdate', async (_e, args) => {
  if (!args || Object.keys(args).length !== 2 || !isStr(args.nickname) || !args.nickname.trim()
    || Array.from(args.nickname.trim()).length > 40 || /[\x00-\x1f\x7f]/.test(args.nickname)
    || !Number.isSafeInteger(args.expectedRevision) || args.expectedRevision < 0) throw Error('bad-profile-nickname');
  return withHost(() => bridge.request('profile/update', { nickname: args.nickname, expectedRevision: args.expectedRevision }));
});
// 通用设置键 → 宿主动词与参数名：宿主侧按驼峰参数名校验（transcriptView 等），
// 键名连字符只是渲染层的说法，不能拿它直接当宿主参数名。
ipcMain.handle("sacode:globalSettingsSet", async (_e, args) => {
  const key = args && args.key;
  const value = args && args.value;
  const KEY_TO_PARAM = { "transcript-view": "transcriptView", "composer-enter": "composerEnter", "session-log": "sessionLog", "default-permission": "defaultPermissionMode" };
  if (!isStr(key) || !Object.prototype.hasOwnProperty.call(KEY_TO_PARAM, key)) throw new Error("bad-settings-key");
  if (!isStr(value)) throw new Error("bad-settings-value");
  const method = "global/settings/set-" + key;
  return withHost(()=>bridge.request(method, { [KEY_TO_PARAM[key]]: value }));
});
// 已落盘事件流（轨迹视图）：cursor/limit 都是整数，limit 夹在 1..64（宿主同款上限）。
ipcMain.handle("sacode:sessionEvents", async (_e, args) => {
  const sessionId = args && args.sessionId;
  const cursor = args && args.cursor;
  const limit = args && args.limit;
  if (!isStr(sessionId) || !sessionId || sessionId.length > 160) throw new Error("bad-session-id");
  if (typeof cursor !== "number" || !Number.isInteger(cursor) || cursor < 0) throw new Error("bad-cursor");
  if (limit !== undefined && (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 64)) throw new Error("bad-limit");
  return withHost(()=>bridge.request("session/subscribe", { sessionId, cursor, limit: limit ?? 64 }));
});
// 模型调用日志：跨会话回放请求追踪（供应商 + 模型 + 耗时 + 状态 + 用量）。
// 宿主按任意会话读日志后投影，桌面只转发参数并校验边界。
ipcMain.handle("sacode:requestTrace", async (_e, args) => {
  const sessionId = args && args.sessionId;
  const beforeSeq = args && args.beforeSeq;
  const limit = args && args.limit;
  if (!isStr(sessionId) || !sessionId || sessionId.length > 160) throw new Error("bad-session-id");
  if (beforeSeq !== undefined && (typeof beforeSeq !== "number" || !Number.isInteger(beforeSeq) || beforeSeq < -1)) throw new Error("bad-before-seq");
  if (limit !== undefined && (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 50)) throw new Error("bad-limit");
  return withHost(()=>bridge.request("session/request-trace", { sessionId, beforeSeq: beforeSeq ?? -1, limit: limit ?? 50 }));
});
ipcMain.handle("sacode:sessionCreate", async (_e, args) => {
  if (!args || !isStr(args.title) || !args.title.trim() || args.title.length>80 || /[\x00-\x1f\x7f]/.test(args.title)) throw new Error("bad arguments");
  return withHost(()=>bridge.request("session/create", {title:args.title}));
});
// 清空会话日志真源（会话身份基线保留），渲染层据此刷新投影；参数只收会话身份。
ipcMain.handle("sacode:sessionClear", async (_e, args) => {
  if (!args || Object.keys(args).length!==1 || !isStr(args.sessionId) || !args.sessionId || args.sessionId.length>300) throw new Error("bad arguments");
  return withHost(()=>bridge.request("session/clear", {sessionId:args.sessionId}));
});
async function mutateSessionMetadata(action,args) {
  const field=action==='Rename'?'title':'archived';
  if(!args || Object.keys(args).length!==3 || !isStr(args.sessionId) || !args.sessionId || args.sessionId.length>300 ||
    !Number.isSafeInteger(args.expectedRevision) || args.expectedRevision<0 ||
    (action==='Rename' ? !isStr(args.title)||!args.title.trim()||args.title.length>80||/[\x00-\x1f\x7f]/.test(args.title) : typeof args.archived!=='boolean')) throw Error('bad-session-mutation');
  return withHost(()=>bridge.request(action==='Rename'?'session/rename':'session/archive',{sessionId:args.sessionId,[field]:args[field],expectedRevision:args.expectedRevision}));
}
ipcMain.handle('sacode:sessionRename', (_event,args)=>mutateSessionMetadata('Rename',args));
ipcMain.handle('sacode:sessionArchive', (_event,args)=>mutateSessionMetadata('Archive',args));
ipcMain.handle('sacode:userQuestionAnswer', (_event,args)=>{
  if(!args||Object.keys(args).length!==4||!isStr(args.sessionId)||!args.sessionId||args.sessionId.length>300||!isStr(args.questionId)||!args.questionId||args.questionId.length>100||typeof args.cancelled!=='boolean'||!Array.isArray(args.answers)||args.answers.length>3||JSON.stringify(args.answers).length>32768)throw Error('question-invalid-answer');
  return withHost(()=>bridge.request('user-question/answer',{sessionId:args.sessionId,questionId:args.questionId,answers:args.answers,cancelled:args.cancelled}));
});
ipcMain.handle("sacode:sessionSelect", async (_e, args) => {
  if (!args || !isStr(args.sessionId) || !args.sessionId || args.sessionId.length>300) throw new Error("bad arguments");
  return withHost(async()=>{
    const selected = await bridge.request("session/select", {sessionId:args.sessionId});
    // 切会话后 Host 重建帧日志：本地游标归零，下一次 poll 从新会话头读。
    turnPollCursor = 0;
    turnPollTurnId = null;
    return selected;
  });
});
ipcMain.handle("sacode:appearanceGet", async () => {
  const result=await withHost(() => bridge.request("appearance/get"));
  return result;
});
// 使用提醒：主进程只补两个事实——屏幕阅读器在不在（Chromium 检测到读屏器会置位
// app.accessibilitySupportEnabled），以及宿主自证用的显式环境变量。
// 占用比例、轮换与冷却全部在仓颉核心算，这里不传任何分子分母。
const tipsParams = (extra) => {
  let accessibility = false;
  try { accessibility = app.accessibilitySupportEnabled === true; } catch {}
  if (process.env.SACODE_ACCESSIBILITY === "1") accessibility = true;
  return { accessibility, ...extra };
};
ipcMain.handle("sacode:tipsGet", () => withHost(() => bridge.request("tips/get", tipsParams())));
ipcMain.handle("sacode:tipsStartup", () => withHost(() => bridge.request("tips/startup", tipsParams())));
ipcMain.handle("sacode:tipsAfterReply", () => withHost(() => bridge.request("tips/after-reply", tipsParams())));
ipcMain.handle("sacode:tipsSetHidden", async (_e, args) => {
  if (!args || typeof args.hidden !== "boolean") throw new Error("bad-tips-arguments");
  return withHost(() => bridge.request("tips/set-hidden", tipsParams({ hidden: args.hidden })));
});
// 桌面主题只取用户配置；旧会话主题仍可读取，但不再改变窗口。
ipcMain.handle('sacode:globalAppearanceSetBusySend', async (_e,args) => {
  if (!args || !['queue','steer'].includes(args.busySend)) throw new Error('bad arguments');
  return withHost(() => bridge.request('global/appearance/set-busy-send',{busySend:args.busySend}));
});
ipcMain.handle("sacode:globalAppearanceGet", async () => {
  const result=await withHost(() => bridge.request("global/appearance/get"));
  nativeTheme.themeSource=result.theme;
  return result;
});
// 关于页的版本读数只取壳层事实（应用/Electron/Chromium/Node/平台），不碰宿主、不猜更新状态：
// 更新检查确实尚未开放，界面如实写「尚未开放」，不给假按钮、不提示未核实的更新。
ipcMain.handle("sacode:appVersion", async () => ({
  app: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  platform: process.platform,
  arch: process.arch,
  packaged: app.isPackaged,
}));
// 开机自启走 Electron 自己的登录项接口（Windows 写 HKCU Run、macOS 写登录项），
// 不手拼注册表命令。开发目录下注册的是开发壳而不是安装版程序，如实把这个差别说出去；
// 写不进去时把错误抛回渲染层，不在界面上伪报「已开启」。
const autoLaunchDescribe = () => {
  const settings = app.getLoginItemSettings();
  return {
    openAtLogin: !!settings.openAtLogin,
    openAsHidden: !!settings.openAsHidden,
    packaged: app.isPackaged,
    note: app.isPackaged ? "" : "开发目录下注册的是开发壳，安装版需在安装后另行设置。",
  };
};
ipcMain.handle("sacode:autoLaunchGet", async () => autoLaunchDescribe());
ipcMain.handle("sacode:autoLaunchSet", async (_e, args) => {
  if (!args || typeof args.enabled !== "boolean") throw new Error("bad-autolaunch-value");
  try {
    app.setLoginItemSettings({ openAtLogin: args.enabled });
  } catch (e) {
    throw new Error("autolaunch-write-failed: " + String((e && e.message) || e));
  }
  // 以回读值为准：注册失败或被系统策略挡下时界面显示的是真实状态，不是刚提交的请求。
  return autoLaunchDescribe();
});
ipcMain.handle("sacode:globalAppearanceSetTheme", async (_e, args) => {
  if (!args || !["system", "light", "dark"].includes(args.theme)) throw new Error("bad-theme");
  const result=await withHost(() => bridge.request("global/appearance/set-theme", { theme:args.theme }));
  if (!result.saved) throw new Error("theme-not-saved");
  nativeTheme.themeSource=result.theme;
  return result;
});
ipcMain.handle("sacode:globalAppearanceSetFontSize", async (_e, args) => {
  if (!args || !Number.isInteger(args.fontSize) || args.fontSize < 10 || args.fontSize > 22) throw new Error("bad-font-size");
  const result=await withHost(() => bridge.request("global/appearance/set-font-size", { fontSize:args.fontSize }));
  if (!result.saved) throw new Error("font-size-not-saved");
  nativeTheme.themeSource=result.theme;
  return result;
});
ipcMain.handle("sacode:appearanceSetTheme", async (_e, args) => {
  if (!args || !["system", "light", "dark"].includes(args.theme)) throw new Error("bad-theme");
  const result=await withHost(() => bridge.request("appearance/set-theme", { theme: args.theme }));
  if (!result.saved) throw new Error("theme-not-saved");
  return result;
});

const modelsGuard = require("./models-guard.cjs");
require('./models-ipc.cjs').registerModelsIpc(ipcMain, (method, args) => withHost(() => bridge.request(method, args)), modelsGuard, isStr);
require('./model-credential-ipc.cjs').registerModelCredentialIpc(ipcMain, (method, args) => withHost(() => bridge.request(method, args)), modelsGuard);

const customsGuard = require("./customs-guard.cjs");
require('./customs-ipc.cjs').registerCustomsIpc(ipcMain, (method, args, timeoutMs) => withHost(() => bridge.request(method, args, timeoutMs)), customsGuard, isStr);

const pluginsGuard = require("./plugins-guard.cjs");
require('./plugins-ipc.cjs').registerPluginsIpc(ipcMain, (method, args) => withHost(() => bridge.request(method, args)), pluginsGuard, isStr);

require('./lsp-ipc.cjs').registerLspIpc(ipcMain, (method, params) => withHost(() => bridge.request(method, params)));
require('./knowledge-ipc.cjs').registerKnowledgeIpc(ipcMain, (method, params) => withHost(() => bridge.request(method, params)));
require('./automation-ipc.cjs').registerAutomationIpc(ipcMain, (method, params) => withHost(() => bridge.request(method, params)));
require('./web-settings-ipc.cjs').registerWebSettingsIpc(ipcMain, (method, params) => withHost(() => bridge.request(method, params)));
require('./acp-ipc.cjs').registerAcpIpc(ipcMain, (method, params) => withHost(() => bridge.request(method, params, require('./acp-ipc.cjs').acpRequestTimeout(method))));

// Next SDK 页面工具：清单的唯一真源是渲染层那份 window.DshPageTools 注册表，
// 主进程只做窗口解析、参数校验与传参，不在这里维护工具名或写死的空结果。
// 名字与参数一律经 JSON.stringify 成为字面量：手写转义把值拼进源码就是注入口。
function pageToolsWindow() {
  return win && !win.isDestroyed() ? win : null;
}

const pageToolBridge = require('./page-tool-bridge.cjs').createPageToolBridge({
  bridge, getWindow: pageToolsWindow,
  askPermission: async (proposal) => {
    const target = pageToolsWindow();
    if (!target) return false;
    const result = await dialog.showMessageBox(target, {
      type: 'question', title: '页面工具审批', message: proposal.name,
      detail: JSON.stringify(JSON.parse(proposal.argumentsJson), null, 2),
      buttons: ['允许一次', '拒绝'], defaultId: 1, cancelId: 1, noLink: true,
    });
    return result.response === 0;
  },
});

ipcMain.handle("sacode:pageToolsList", async () => {
  const target = pageToolsWindow();
  if (!target) return [];
  try {
    return JSON.parse(await target.webContents.executeJavaScript(
      `window.DshPageTools && window.DshPageTools.list ? JSON.stringify(window.DshPageTools.list()) : "[]"`
    ));
  } catch (e) {
    return [];
  }
});

ipcMain.handle("sacode:pageToolCall", async (_e, args) => {
  const name = args && args.name;
  const callArgs = args && args.args;
  if (!name || typeof name !== "string") throw new Error("bad-page-tool-name");
  if (Buffer.byteLength(name, 'utf8') > 256 || Object.keys(args).some(key => key !== 'name' && key !== 'args')) throw new Error('bad-page-tool-name');
  if (callArgs !== undefined && (callArgs === null || typeof callArgs !== "object" || Array.isArray(callArgs))) {
    throw new Error("bad-page-tool-args");
  }
  const target = pageToolsWindow();
  if (!target) return { error: "no-window" };
  try {
    return await withHost(() => pageToolBridge.invoke(name, callArgs ?? {}));
  } catch (e) {
    return { error: e.message };
  }
});

const UI_SMOKE = FRAME_SMOKE || process.argv.includes("--ui-smoke") || process.argv.includes("--layout-smoke");

app.whenReady().then(async () => {
  if (process.argv.includes("--smoke")) return require("./test-support/protocol-smoke.cjs")({ app, HOST, SESSION_DIR, bridge, seedIfNeeded });
  if (FRAME_SMOKE) {
    seedIfNeeded(); await bridge.start(SESSION_DIR); createWindow();
    const captureArg=process.argv.find(a=>a.startsWith('--capture-dir='));
    const outDir=captureArg?captureArg.slice('--capture-dir='.length):join(SESSION_DIR,'frame');
    try {
      const ok=await require('./frame-smoke.cjs')({win,nativeTheme,outDir,bridge});
      await bridge.stop();app.exit(ok?0:1);
    } catch(e) {console.error('FRAME FAIL',e);await bridge.stop();app.exit(1);}
    return;
  }
  if (process.argv.includes("--layout-smoke")) {
    seedIfNeeded();
    await bridge.start(SESSION_DIR);
    // 使用真实保存的长中文目录，覆盖路径折行而非只有默认短路径。
    const layoutProject=join(SESSION_DIR,'SaCode 中文项目 目录布局检查','长中文目录与空格路径 '.repeat(3).trim());
    mkdirSync(layoutProject,{recursive:true});
    await bridge.request('workspace/set-directory',{directory:layoutProject});
    createWindow();
    const captureArg = process.argv.find((a) => a.startsWith("--capture-dir="));
    // 发布态 __dirname 位于只读 asar 内，默认截图必须落在本次临时会话目录。
    const outDir = captureArg ? captureArg.slice("--capture-dir=".length)
      : app.isPackaged ? join(SESSION_DIR, "layout") : join(__dirname, "dist", "layout");
    const ok = await require("./layout-smoke.cjs")({ win, nativeTheme, outDir, expectedReadPath:join(layoutProject,'sacode-tool.txt') });
    await bridge.stop();
    app.exit(ok ? 0 : 1);
    return;
  }
  if (UI_SMOKE) return require("./test-support/ui-smoke.cjs")({
    app, nativeTheme, HOST, SESSION_DIR, SESSION_LOG, bridge, seedIfNeeded, createWindow,
    get chooseWorkspaceDirectory() { return chooseWorkspaceDirectory; },
    set chooseWorkspaceDirectory(picker) { chooseWorkspaceDirectory = picker; },
  });
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((e) => {
  // 冒烟路径里任何未捕获的拒绝都必须当场退出非零：只留一个 UnhandledPromiseRejection
  // 警告的话进程会挂在窗口上，看上去像「跑得很慢」而不是「失败了」。
  console.log(`SMOKE FAIL ${e && e.message ? e.message : e}`);
  app.exit(1);
});

app.on("window-all-closed", async () => {
  pageToolBridge.dispose();
  // 先让宿主走完 EOF 结算（落盘未 flush 的写入并归还写租约），再退出
  await bridge.stop();
  app.quit();
});

// 兜底：无论以何种方式退出，都不要把宿主留成孤儿进程
app.on("before-quit", () => bridge.killNow());
process.on("exit", () => bridge.killNow());
