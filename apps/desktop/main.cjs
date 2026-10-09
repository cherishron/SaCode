// Electron 主进程：只负责窗口、宿主生命周期与有限的 IPC 面。
// 不做 agent 业务，不承载会话真源，不把任意命令执行暴露给渲染层。
require('./stdio-guard.cjs').installStdioGuard();
const { installWindowVisibility } = require('./window-visibility.cjs');
const modelApproval = require('./renderer/model-approval.js');
let modelTurnRequestId = null;
const { app, BrowserWindow, ipcMain, nativeTheme, dialog } = require("electron");
const { createRequire } = require("node:module");
const { join } = require("node:path");
const { existsSync, writeFileSync, mkdirSync } = require("node:fs");
const { HostBridge } = require("./host-bridge.cjs");
const { hostExePath, computerUsePaths } = require("./paths.cjs");

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
const WILL_SMOKE = FRAME_SMOKE || process.argv.includes("--smoke") || process.argv.includes("--ui-smoke") || process.argv.includes("--layout-smoke");
// 冒烟态没传 --session-dir 时也必须落到一次性目录：默认的 sessionData 跨次累积，
// 「全新会话」类断言会被上一次运行的旧日志蒙混过去（实测用量从 12 一路涨到 48）。
// 只带 pid 还不够：Windows 会回收 pid，同 pid 的旧目录会被下一次运行接着写，
// 于是上一轮的 usage/budget 与 tool 事件就污染了这一轮（实测「用量 12/5」+ 多出 tool 组）。
// 所以目录名带 pid+时间戳，且冒烟态自己建自己清；传了 --session-dir 的（打包态手工复验、
// CI 要留日志）仍以传入者为准，我们绝不删别人指定的目录。
const FRESH_SMOKE_DIR = WILL_SMOKE && !SESSION_ARG;
const SESSION_DIR = SESSION_ARG
  ? SESSION_ARG.slice("--session-dir=".length)
  : (FRESH_SMOKE_DIR ? join(app.getPath("temp"), `sacode-smoke-${process.pid}-${Date.now()}`) : app.getPath("sessionData"));
const SESSION_LOG = join(SESSION_DIR, "session.log");
if(WILL_SMOKE) app.setPath('userData',join(SESSION_DIR,'electron-user-data'));

// 冒烟只使用自己的配置根，不能修改真实用户的全局外观。
const hostEnvironment = WILL_SMOKE
  ? { ...process.env, SACODE_USER_SETTINGS_DIR: join(SESSION_DIR, 'user-settings'), SACODE_COMPUTER_USE: '0' }
  : { ...process.env };
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
const bridge = new HostBridge(HOST, hostEnvironment);
let win = null;
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

const executionActions = {
  executionPropose: ['execution/propose', ['sessionId','taskId','requestId','proposal']],
  executionAuthorize: ['execution/authorize', ['sessionId','executionId','revision','proposalDigest','approvalId']],
  executionStart: ['execution/start', ['sessionId','executionId','revision']],
  executionDescribe: ['execution/describe', ['sessionId','executionId']],
  executionOutput: ['execution/output', ['sessionId','executionId','cursor','limit']],
  executionStop: ['execution/stop', ['sessionId','executionId','revision']],
};
for (const [action,[method,fields]] of Object.entries(executionActions)) {
  ipcMain.handle(`sacode:${action}`, async (_event, args) => {
    if (!args || Object.keys(args).length !== fields.length || fields.some(key => !Object.hasOwn(args,key))) throw Error('bad-execution-arguments');
    for (const key of fields) {
      const value=args[key];
      if (['revision','approvalId','cursor','limit'].includes(key)) {
        if (!Number.isSafeInteger(value) || (key==='cursor' ? value < -1 : value < 1) || (key==='limit' && value > 16)) throw Error('bad-execution-arguments');
      } else if (!isStr(value) || !value.trim() || Buffer.byteLength(value,'utf8') > (key==='proposal' ? 1024 : 256)) throw Error('bad-execution-arguments');
    }
    if ('proposalDigest' in args && !/^[0-9a-f]{64}$/.test(args.proposalDigest)) throw Error('bad-execution-arguments');
    return withHost(() => bridge.request(method,args));
  });
}

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
  if (!args || !isStr(args.name) || !isStr(args.args)) {
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
  if (!args || !Number.isInteger(args.approvalId) || args.approvalId < 1 || !isStr(args.decision)) {
    throw new Error("bad arguments");
  }
  return withHost(() => bridge.request("approval/answer", { approvalId: args.approvalId, decision: args.decision }));
});

	ipcMain.handle("sacode:approvalSetMode", async (_e, args) => {
	  if (!args || !isStr(args.mode) || !["plan","build","auto","yolo"].includes(args.mode)) throw Error("bad-approval-mode");
	  return withHost(() => bridge.request("approval/set-mode", { mode: args.mode }));
	});
	ipcMain.handle("sacode:approvalGetMode", async () => withHost(() => bridge.request("approval/get-mode")));


ipcMain.handle("sacode:turnStart", async (_e, args) => {
  const limit = args ? args.limit : 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 8) {
    throw new Error("bad arguments");
  }
  return withHost(() => bridge.request("turn/start", { limit }));
});

// 产品发送后的起轮走这一条：task/start 只认真实配置，缺配置/缺凭据/协议不支持一律显式报错，
// 不像 turn/start 那样在没配置时静默退回示例 provider——界面上演一场假成功比报错更糟。
ipcMain.handle("sacode:taskStart", async (_e, args) => {
  const customModelId = args?.customModelId;
  if (customModelId !== undefined && (typeof customModelId !== "string" || customModelId.length > 256)) throw Error("bad-custom-model-id");
  return withHost(async () => {
    const turnRequestId = String(bridge.nextId);
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
  const poll = await bridge.request("turn/poll");
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

ipcMain.handle("sacode:sessionCatalog", async () => bridge.request("session/catalog"));
ipcMain.handle("sacode:workspaceGet", async () => withHost(()=>bridge.request("workspace/get")));
ipcMain.handle("sacode:workspaceChoose", async () => withHost(async()=>{
  const workspace=await bridge.request("workspace/get");
  const choice=await chooseWorkspaceDirectory({title:"选择 SaCode 项目目录", properties:["openDirectory"],
    defaultPath: workspace.configured && workspace.available ? workspace.directory : app.getPath("documents")});
  if(choice.canceled) return {cancelled:true};
  if(!Array.isArray(choice.filePaths) || choice.filePaths.length!==1 || !isStr(choice.filePaths[0])) throw new Error("bad directory selection");
  return bridge.request("workspace/set-directory", {directory:choice.filePaths[0]});
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
ipcMain.handle("sacode:globalSettingsGet", async () => withHost(()=>bridge.request("global/settings/get")));
// 通用设置键 → 宿主动词与参数名：宿主侧按驼峰参数名校验（transcriptView 等），
// 键名连字符只是渲染层的说法，不能拿它直接当宿主参数名。
ipcMain.handle("sacode:globalSettingsSet", async (_e, args) => {
  const key = args && args.key;
  const value = args && args.value;
  const KEY_TO_PARAM = { "transcript-view": "transcriptView", "composer-enter": "composerEnter", "session-log": "sessionLog" };
  if (!isStr(key) || !Object.prototype.hasOwnProperty.call(KEY_TO_PARAM, key)) throw new Error("bad-settings-key");
  if (!isStr(value)) throw new Error("bad-settings-value");
  const method = "global/settings/set-" + key;
  return withHost(()=>bridge.request(method, { [KEY_TO_PARAM[key]]: value }));
});
// 已落盘事件流（轨迹视图）：cursor/limit 都是整数，limit 夹在 1..64（宿主同款上限）。
ipcMain.handle("sacode:sessionEvents", async (_e, args) => {
  const cursor = args && args.cursor;
  const limit = args && args.limit;
  if (typeof cursor !== "number" || !Number.isInteger(cursor) || cursor < 0) throw new Error("bad-cursor");
  if (limit !== undefined && (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 64)) throw new Error("bad-limit");
  return withHost(()=>bridge.request("session/subscribe", { cursor, limit: limit ?? 64 }));
});
ipcMain.handle("sacode:sessionCreate", async (_e, args) => {
  if (!args || !isStr(args.title) || !args.title.trim() || args.title.length>80 || /[\x00-\x1f\x7f]/.test(args.title)) throw new Error("bad arguments");
  return withHost(()=>bridge.request("session/create", {title:args.title}));
});
ipcMain.handle("sacode:sessionSelect", async (_e, args) => {
  if (!args || !isStr(args.sessionId) || !args.sessionId || args.sessionId.length>300) throw new Error("bad arguments");
  return withHost(async()=>{
    const selected = await bridge.request("session/select", {sessionId:args.sessionId});
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

// 模型配置面：字段守卫在主进程（models-guard.cjs），凭据名由核心按 ID 派生。
// 密钥只在「写凭据」这一次调用里存在：不透传进注册表文档，不回写，不落日志。
const modelsGuard = require("./models-guard.cjs");

ipcMain.handle("sacode:modelsDescribe", async () => withHost(() => bridge.request("model/registry/describe")));
ipcMain.handle("sacode:modelsCatalog", async () => withHost(() => bridge.request("model/registry/catalog")));

ipcMain.handle("sacode:modelsSave", async (_e, args) => {
  const draft = modelsGuard.sanitizeDraft(args && args.draft);
  const key = modelsGuard.sanitizeKey(args ? args.key : undefined);
  const expectedRevision = modelsGuard.sanitizeRevision(args ? args.expectedRevision : undefined);
  const view = await withHost(() => bridge.request("model/registry/update", { draft, expectedRevision }));
  if (key.length > 0) {
    // 写凭据要用核心派生出的那个名字，而不是渲染层点名的：页面上根本没有这一栏。
    const saved = (view.providers || []).find((p) => p.id === draft.id);
    if (!saved || !saved.credentialRef) throw new Error("credential-ref-missing");
    await withHost(() => bridge.request("credential/set", { ref: saved.credentialRef, value: key }));
  }
  return view;
});

ipcMain.handle("sacode:modelsRemove", async (_e, args) => {
  const id = args && args.id;
  if (!isStr(id) || id.length === 0 || id.length > 64) throw new Error("bad-model-id");
  return withHost(() => bridge.request("model/registry/remove", { id, expectedRevision: modelsGuard.sanitizeRevision(args.expectedRevision) }));
});

ipcMain.handle("sacode:modelsSetDefault", async (_e, args) => {
  const providerId = args && args.providerId;
  const model = args && args.model;
  if (!isStr(providerId) || providerId.length === 0 || providerId.length > 64) throw new Error("bad-model-provider");
  if (!isStr(model) || model.length === 0 || model.length > 200) throw new Error("bad-model-name");
  return withHost(() => bridge.request("model/registry/set-default", {
    providerId, model, expectedRevision: modelsGuard.sanitizeRevision(args.expectedRevision),
  }));
});

// 供应商单列写：排序只改 sortOrder、启停只改 enabled，宿主核心不重写整条记录。
ipcMain.handle("sacode:modelsSort", async (_e, args) => {
  const providerId = args && args.providerId;
  const sortOrder = args && args.sortOrder;
  if (!isStr(providerId) || providerId.length === 0 || providerId.length > 64) throw new Error("bad-model-provider");
  if (typeof sortOrder !== "number" || !Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 1e9) throw new Error("bad-sort-order");
  return withHost(() => bridge.request("model/registry/sort", {
    providerId, sortOrder, expectedRevision: modelsGuard.sanitizeRevision(args.expectedRevision),
  }));
});

ipcMain.handle("sacode:modelsSetEnabled", async (_e, args) => {
  const providerId = args && args.providerId;
  const enabled = args && args.enabled;
  if (!isStr(providerId) || providerId.length === 0 || providerId.length > 64) throw new Error("bad-model-provider");
  if (typeof enabled !== "boolean") throw new Error("bad-enabled-flag");
  return withHost(() => bridge.request("model/registry/set-enabled", {
    providerId, enabled: enabled ? "true" : "false", expectedRevision: modelsGuard.sanitizeRevision(args.expectedRevision),
  }));
});

// 「测试连接 / 获取可用模型」：草稿还没保存就能问远端，内联明文只活在这一次调用里。
ipcMain.handle("sacode:modelsList", async (_e, args) => {
  const request = modelsGuard.sanitizeListRequest(args);
  return withHost(() => bridge.request("model/list", request));
});

// 第 3 层自定义模型与模型目录写面：字段守卫在主进程（customs-guard.cjs），
// 第 3 层文档不认识 baseUrl 与凭据，草稿里出现它们一律拒收。
const customsGuard = require("./customs-guard.cjs");

ipcMain.handle("sacode:customsDescribe", async () => withHost(() => bridge.request("custom/describe")));

ipcMain.handle("sacode:customsUpsert", async (_e, args) => {
  const draft = customsGuard.sanitizeDraft(args && args.draft);
  const expectedRevision = customsGuard.sanitizeRevision(args ? args.expectedRevision : undefined);
  return withHost(() => bridge.request("custom/upsert", { draft, expectedRevision }));
});

ipcMain.handle("sacode:customsRemove", async (_e, args) => {
  const customId = args && args.customId;
  if (!isStr(customId) || customId.length === 0 || customId.length > 64) throw new Error("bad-custom-id");
  return withHost(() => bridge.request("custom/remove", { customId, expectedRevision: customsGuard.sanitizeRevision(args.expectedRevision) }));
});

ipcMain.handle("sacode:bindingUpsert", async (_e, args) => {
  const customId = args && args.customId;
  if (!isStr(customId) || customId.length === 0 || customId.length > 64) throw new Error("bad-custom-id");
  const binding = customsGuard.sanitizeBinding(args && args.binding);
  return withHost(() => bridge.request("binding/upsert", { customId, binding, expectedRevision: customsGuard.sanitizeRevision(args.expectedRevision) }));
});

ipcMain.handle("sacode:bindingRemove", async (_e, args) => {
  const customId = args && args.customId;
  const providerId = args && args.providerId;
  const modelId = args && args.modelId;
  if (!isStr(customId) || customId.length === 0 || customId.length > 64) throw new Error("bad-custom-id");
  if (!isStr(providerId) || providerId.length === 0 || providerId.length > 64) throw new Error("bad-custom-provider");
  if (!isStr(modelId) || modelId.length === 0 || modelId.length > 200) throw new Error("bad-custom-model");
  return withHost(() => bridge.request("binding/remove", { customId, providerId, modelId, expectedRevision: customsGuard.sanitizeRevision(args.expectedRevision) }));
});

ipcMain.handle("sacode:bindingReorder", async (_e, args) => {
  const customId = args && args.customId;
  if (!isStr(customId) || customId.length === 0 || customId.length > 64) throw new Error("bad-custom-id");
  const keys = customsGuard.sanitizeKeyList(args && args.keys);
  return withHost(() => bridge.request("binding/reorder", { customId, keys, expectedRevision: customsGuard.sanitizeRevision(args.expectedRevision) }));
});

ipcMain.handle("sacode:modelPull", async (_e, args) => {
  const providerId = args && args.providerId;
  if (!isStr(providerId) || providerId.length === 0 || providerId.length > 64) throw new Error("bad-model-provider");
  return withHost(() => bridge.request("model/pull", { providerId, expectedRevision: customsGuard.sanitizeRevision(args.expectedRevision) }));
});

ipcMain.handle("sacode:modelUpstreamUpsert", async (_e, args) => {
  const providerId = args && args.providerId;
  const modelId = args && args.modelId;
  if (!isStr(providerId) || providerId.length === 0 || providerId.length > 64) throw new Error("bad-model-provider");
  if (!isStr(modelId) || modelId.length === 0 || modelId.length > 200) throw new Error("bad-model-name");
  return withHost(() => bridge.request("model/upstream/upsert", { providerId, modelId, expectedRevision: customsGuard.sanitizeRevision(args.expectedRevision) }));
});

ipcMain.handle("sacode:customImportNew", async (_e, args) => {
  const items = customsGuard.sanitizeKeyList(args && args.items);
  return withHost(() => bridge.request("custom/import/new", { items, expectedRevision: customsGuard.sanitizeRevision(args.expectedRevision) }));
});

ipcMain.handle("sacode:customImportInto", async (_e, args) => {
  const customId = args && args.customId;
  if (!isStr(customId) || customId.length === 0 || customId.length > 64) throw new Error("bad-custom-id");
  const items = customsGuard.sanitizeKeyList(args && args.items);
  return withHost(() => bridge.request("custom/import/into", { customId, items, expectedRevision: customsGuard.sanitizeRevision(args.expectedRevision) }));
});

// ---- 插件管理：9 条通道逐条落地，逐字段校验 ----
// 缺通道的适配器保持 unconnected，不冒充本地状态。

ipcMain.handle("sacode:pluginsDescribe", async () => {
  return withHost(() => bridge.request("plugin/describe"));
});

ipcMain.handle("sacode:pluginsSetEnabled", async (_e, args) => {
  const name = args && args.name;
  if (!isStr(name) || name.length === 0 || name.length > 200) throw new Error("bad-plugin-name");
  if (typeof args.enabled !== "boolean") throw new Error("bad-plugin-enabled");
  const expectedRevision = args.expectedRevision;
  return withHost(() => bridge.request("plugin/set-enabled", { name, enabled: args.enabled ? "true" : "false", expectedRevision }));
});

ipcMain.handle("sacode:pluginsSetRowEnabled", async (_e, args) => {
  // 行级启用：PluginStore 当前无此能力，返回空清单让适配器 fail-loud（不静默）
  return withHost(() => bridge.request("plugin/describe"));
});

ipcMain.handle("sacode:pluginsUninstall", async (_e, args) => {
  const name = args && args.name;
  if (!isStr(name) || name.length === 0 || name.length > 200) throw new Error("bad-plugin-name");
  return withHost(() => bridge.request("plugin/uninstall", { name, expectedRevision: args.expectedRevision }));
});

ipcMain.handle("sacode:pluginsRegistries", async () => {
  return { registry: "https://registry.npmjs.org", fallbackRegistries: ["https://registry.npmmirror.com"], resolved: "https://registry.npmjs.org" };
});

ipcMain.handle("sacode:pluginsInspect", async (_e, args) => {
  const spec = args && args.spec;
  if (!spec || typeof spec !== "string" || spec.length === 0) {
    return { status: "invalid", reason: "empty-spec" };
  }
  // 校验格式：name@version 或 name（只允许字母数字和连字符下划线点斜杠@）
  if (!/^[a-zA-Z0-9._\-/][a-zA-Z0-9._\-/]*(?:@[a-zA-Z0-9._\-]+)?$/.test(spec)) {
    return { status: "invalid", reason: "bad-spec-format" };
  }
  return { status: "valid", name: spec.split("@")[0], version: spec.includes("@") ? spec.split("@")[1] : "" };
});

ipcMain.handle("sacode:pluginsInstall", async (_e, args) => {
  // 安装尚未接后端，返回 failed 状态让适配器正确显示失败
  return { requestId: "", phase: "failed", output: "plugin-install-not-implemented" };
});

ipcMain.handle("sacode:pluginsInstallPoll", async (_e, args) => {
  const requestId = args && args.requestId;
  if (!requestId) return { requestId: "", phase: "failed", output: "unknown-request" };
  return { requestId, phase: "failed", output: "plugin-install-not-implemented" };
});

ipcMain.handle("sacode:pluginsInstallCancel", async (_e, args) => {
  return { cancelled: true, output: "install-was-not-running" };
});

// LSP 语义工具（L1）：7 个动作、7 条通道，method 名在主进程写死。
// 键集是 verb 的函数：渲染层说不出第四个键，更没有「发任意 method」的通路。
// 没有语言插件时宿主如实回 error（data.reason=lsp-no-server + 非语义线索），
// 主进程不在此把失败改写成空数组——空数组会被界面读成「这个符号没有定义」。
const lspKeyGuard = {
  path: (v) => isStr(v) && v.trim().length > 0 && v.length <= 1000,
  line: (v) => Number.isSafeInteger(v) && v >= 0,
  character: (v) => Number.isSafeInteger(v) && v >= 0,
  documentVersion: (v) => Number.isSafeInteger(v) && v >= 0,
  direction: (v) => v === "incoming" || v === "outgoing",
  includeDeclaration: (v) => typeof v === "boolean",
  newName: (v) => isStr(v) && v.trim().length > 0 && v.length <= 500,
};

function lspArguments(args, extras) {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("bad arguments");
  // 键集校验与取值校验同一条循环走完：allowed 里的每个名字都必须在 lspKeyGuard
  // 里有一格，否则漏写守卫的键会直接 TypeError，而不是拒掉。
  const allowed = new Set(["path", ...extras]);
  for (const key of Object.keys(args)) {
    if (!allowed.has(key)) throw new Error("bad arguments");
    if (!lspKeyGuard[key]) throw new Error("bad arguments");
    if (!lspKeyGuard[key](args[key])) throw new Error("bad arguments");
  }
  if (!lspKeyGuard.path(args.path)) throw new Error("bad arguments");
  for (const key of ["line", "character", "direction", "newName"]) {
    if (extras.includes(key) && !Object.hasOwn(args, key)) throw new Error("bad arguments");
  }
  const params = { path: args.path };
  for (const key of extras) { if (args[key] !== undefined) params[key] = args[key]; }
  return params;
}

ipcMain.handle("sacode:lspDefine", async (_e, args) => {
  const params = lspArguments(args, ["line", "character", "documentVersion"]);
  return withHost(() => bridge.request("lsp/define", params));
});
ipcMain.handle("sacode:lspLookup", async (_e, args) => {
  const params = lspArguments(args, ["line", "character", "documentVersion"]);
  return withHost(() => bridge.request("lsp/lookup", params));
});
ipcMain.handle("sacode:lspReferences", async (_e, args) => {
  const params = lspArguments(args, ["line", "character", "includeDeclaration", "documentVersion"]);
  return withHost(() => bridge.request("lsp/references", params));
});
ipcMain.handle("sacode:lspImplementation", async (_e, args) => {
  const params = lspArguments(args, ["line", "character", "documentVersion"]);
  return withHost(() => bridge.request("lsp/implementation", params));
});
ipcMain.handle("sacode:lspCallHierarchy", async (_e, args) => {
  const params = lspArguments(args, ["line", "character", "direction", "documentVersion"]);
  return withHost(() => bridge.request("lsp/call-hierarchy", params));
});
ipcMain.handle("sacode:lspDiagnostics", async (_e, args) => {
  const params = lspArguments(args, ["documentVersion"]);
  return withHost(() => bridge.request("lsp/diagnostics", params));
});
ipcMain.handle("sacode:lspRename", async (_e, args) => {
  // 只有预览：应用变更归 F08 的审查、冲突检测与授权链，这条通道不写盘。
  const params = lspArguments(args, ["line", "character", "newName", "documentVersion"]);
  return withHost(() => bridge.request("lsp/rename", params));
});

// Next SDK 页面工具：清单的唯一真源是渲染层那份 window.DshPageTools 注册表，
// 主进程只做窗口解析、参数校验与传参，不在这里维护工具名或写死的空结果。
// 名字与参数一律经 JSON.stringify 成为字面量：手写转义把值拼进源码就是注入口。
function pageToolsWindow() {
  return win && !win.isDestroyed() ? win : null;
}

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
  if (callArgs !== undefined && (callArgs === null || typeof callArgs !== "object" || Array.isArray(callArgs))) {
    throw new Error("bad-page-tool-args");
  }
  const target = pageToolsWindow();
  if (!target) return { error: "no-window" };
  try {
    const result = await target.webContents.executeJavaScript(
      `(async () => { const tools = window.DshPageTools && window.DshPageTools.tools; if (!Array.isArray(tools)) return JSON.stringify({ error: "page-tools-not-loaded" }); const want = ${JSON.stringify(name)}; const tool = tools.find((t) => t && t.name === want); if (!tool || typeof tool.handler !== "function") return JSON.stringify({ error: "tool-not-found" }); try { return JSON.stringify(await tool.handler(${JSON.stringify(callArgs ?? {})})); } catch (e) { return JSON.stringify({ error: String((e && e.message) || e) }); } })()`
    );
    return JSON.parse(result);
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
  // 先让宿主走完 EOF 结算（落盘未 flush 的写入并归还写租约），再退出
  await bridge.stop();
  app.quit();
});

// 兜底：无论以何种方式退出，都不要把宿主留成孤儿进程
app.on("before-quit", () => bridge.killNow());
process.on("exit", () => bridge.killNow());
