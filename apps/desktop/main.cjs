// Electron 主进程：只负责窗口、宿主生命周期与有限的 IPC 面。
// 不做 agent 业务，不承载会话真源，不把任意命令执行暴露给渲染层。
require('./stdio-guard.cjs').installStdioGuard();
const { app, BrowserWindow, ipcMain, nativeTheme, dialog } = require("electron");
const { createRequire } = require("node:module");
const { join } = require("node:path");
const { existsSync, writeFileSync, mkdirSync } = require("node:fs");
const { HostBridge } = require("./host-bridge.cjs");
const { hostExePath } = require("./paths.cjs");

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
  : (FRESH_SMOKE_DIR ? join(app.getPath("temp"), `dsh-smoke-${process.pid}-${Date.now()}`) : app.getPath("sessionData"));
const SESSION_LOG = join(SESSION_DIR, "session.log");
if(WILL_SMOKE) app.setPath('userData',join(SESSION_DIR,'electron-user-data'));

// 冒烟只使用自己的配置根，不能修改真实用户的全局外观。
const bridge = new HostBridge(HOST, WILL_SMOKE
  ? { ...process.env, SACODE_USER_SETTINGS_DIR: join(SESSION_DIR, 'user-settings') }
  : process.env);
let win = null;
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
    width: 1100,
    height: 720,
    minWidth: 860,
    minHeight: 600,
    title: "SaCode",
    ...(process.platform === 'win32' ? {titleBarStyle:'hidden',titleBarOverlay:{color:nativeTheme.shouldUseDarkColors?'#1b1b1c':'#f9fafb',symbolColor:nativeTheme.shouldUseDarkColors?'#f9fafb':'#0f1115',height:40}} : {}),
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
  win.loadFile(join(__dirname, "renderer", "index.html"), {query:{platform:process.platform}});
  // 常规启动显示窗口；具体冒烟按需显示以验证动画帧或原生键盘焦点。
  win.once("ready-to-show", () => {
    if (!UI_SMOKE) win.show();
  });
  win.on("closed", () => (win = null));
  return win;
}
nativeTheme.on('updated',()=>{
  if(process.platform==='win32' && win && !win.isDestroyed()) win.setTitleBarOverlay({color:nativeTheme.shouldUseDarkColors?'#1b1b1c':'#f9fafb',symbolColor:nativeTheme.shouldUseDarkColors?'#f9fafb':'#0f1115',height:40});
});

// IPC 面：每个通道只做一件事、参数逐字段校验类型与范围，方法名由主进程写死。
// 渲染层拿不到「发任意方法」的能力，也伪造不了 system/message 这类事件类型。
async function withHost(fn) {
  seedIfNeeded();
  if (!bridge.proc) await bridge.start(SESSION_DIR);
  return fn();
}

const isStr = (v) => typeof v === "string";

ipcMain.handle("dsh:projection", async () => withHost(() => bridge.request("session/projection")));

// 暂存凭证是宿主铸造的短串，界面只能原样带回，拼不出别的形状
const RECEIPT_RE = /^u[1-9]\d{0,6}$/;

ipcMain.handle("dsh:userSend", async (_e, args) => {
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

ipcMain.handle("dsh:attachmentUpload", async (_e, args) => {
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

ipcMain.handle("dsh:toolsList", async () => withHost(() => bridge.request("extension/list")));

// 固定目标动作；完成只由执行证据通道决定，不向网页开放 goalComplete。
function goalArguments(args, fields) {
  if (!args || Object.keys(args).some(key => !fields.includes(key))
    || !isStr(args.sessionId) || !args.sessionId || args.sessionId.length > 300
    || (fields.includes('revision') && (!Number.isSafeInteger(args.revision) || args.revision < 1))
    || (fields.includes('objective') && (!isStr(args.objective) || !args.objective.trim() || args.objective.length > 8000))) throw Error('bad arguments');
  return Object.fromEntries(fields.map(key => [key, args[key]]));
}
ipcMain.handle('dsh:goalDescribe', async (_e, args) => { const params = goalArguments(args, ['sessionId']); return withHost(() => bridge.request('goal/describe', params)); });
ipcMain.handle('dsh:goalCreate', async (_e, args) => { const params = goalArguments(args, ['sessionId', 'objective']); return withHost(() => bridge.request('goal/create', params)); });
ipcMain.handle('dsh:goalEdit', async (_e, args) => { const params = goalArguments(args, ['sessionId', 'revision', 'objective']); return withHost(() => bridge.request('goal/edit', params)); });
ipcMain.handle('dsh:goalPause', async (_e, args) => { const params = goalArguments(args, ['sessionId', 'revision']); return withHost(() => bridge.request('goal/pause', params)); });
ipcMain.handle('dsh:goalResume', async (_e, args) => { const params = goalArguments(args, ['sessionId', 'revision']); return withHost(() => bridge.request('goal/resume', params)); });
ipcMain.handle('dsh:goalClear', async (_e, args) => { const params = goalArguments(args, ['sessionId', 'revision']); return withHost(() => bridge.request('goal/clear', params)); });

ipcMain.handle("dsh:attachmentImageRead", async (_e, args) => {
  if (!args || Object.keys(args).some(key => key !== 'sessionId' && key !== 'attachmentId')
    || !isStr(args.sessionId) || !args.sessionId || args.sessionId.length > 300
    || !isStr(args.attachmentId) || !/^sha256:[a-f0-9]{64}$/.test(args.attachmentId)) throw Error('bad arguments');
  return withHost(() => bridge.request('attachment/image-read', { sessionId: args.sessionId, attachmentId: args.attachmentId }));
});

ipcMain.handle("dsh:toolCall", async (_e, args) => {
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

ipcMain.handle("dsh:approvalAsk", async (_e, args) => {
  if (!args || !isStr(args.name) || args.name.length === 0 || args.name.length > 200) {
    throw new Error("bad arguments");
  }
  return withHost(() => bridge.request("approval/ask", { name: args.name }));
});

ipcMain.handle("dsh:approvalAnswer", async (_e, args) => {
  if (!args || !Number.isInteger(args.approvalId) || args.approvalId < 1 || !isStr(args.decision)) {
    throw new Error("bad arguments");
  }
  return withHost(() => bridge.request("approval/answer", { approvalId: args.approvalId, decision: args.decision }));
});

ipcMain.handle("dsh:turnStart", async (_e, args) => {
  const limit = args ? args.limit : 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 8) {
    throw new Error("bad arguments");
  }
  return withHost(() => bridge.request("turn/start", { limit }));
});

// 产品发送后的起轮走这一条：task/start 只认真实配置，缺配置/缺凭据/协议不支持一律显式报错，
// 不像 turn/start 那样在没配置时静默退回示例 provider——界面上演一场假成功比报错更糟。
ipcMain.handle("dsh:taskStart", async () => withHost(() => bridge.request("task/start", {})));

// 队列三动作逐字段校验：条目身份只能来自核心铸造的那串 id，
// 渲染层拼不出「改任意一条」或「带任意正文的未知动作」。
const QUEUE_ID = /^q\d{1,18}$/;
const QUEUE_KINDS = ["edit", "remove", "steer"];

ipcMain.handle("dsh:queueDescribe", async () => withHost(() => bridge.request("queue/describe")));

ipcMain.handle("dsh:queueEnqueue", async (_e, args) => {
  if (!args || !isStr(args.text) || args.text.trim().length === 0 || args.text.length > 8000
    || !isStr(args.rpcId) || args.rpcId.length === 0 || args.rpcId.length > 128) {
    throw new Error("bad arguments");
  }
  // 排队也可以带附件：凭证形状与发送那条通道同一套校验，不给自报字符串留通路
  const ids = args.receiptIds == null ? [] : args.receiptIds;
  if (!Array.isArray(ids) || ids.length > 20 || !ids.every((v) => isStr(v) && RECEIPT_RE.test(v))) {
    throw new Error("bad arguments");
  }
  return withHost(() => bridge.request("queue/enqueue", ids.length
    ? { text: args.text, rpcId: args.rpcId, receiptIds: ids }
    : { text: args.text, rpcId: args.rpcId }));
});

ipcMain.handle("dsh:queueUpdate", async (_e, args) => {
  if (!args || !isStr(args.itemId) || !QUEUE_ID.test(args.itemId) || !QUEUE_KINDS.includes(args.kind)) {
    throw new Error("bad arguments");
  }
  const text = args.text === undefined || args.text === null ? "" : args.text;
  if (!isStr(text) || text.length > 8000) {
    throw new Error("bad arguments");
  }
  return withHost(() => bridge.request("queue/update", { itemId: args.itemId, kind: args.kind, text }));
});

ipcMain.handle("dsh:turnPoll", async () => withHost(() => bridge.request("turn/poll")));

ipcMain.handle("dsh:turnCancel", async () => withHost(() => bridge.request("turn/cancel")));
// 提示词增强：草稿是唯一入参，逐字段校验在这里做——空白与超长在主进程就拒收，
// 一条都不许发到宿主。宿主因此只会收到「确实有内容的这一条」，
// 而用哪颗模型、哪份凭据由宿主自己按当前会话定，这条通道给不出那个位置。
ipcMain.handle("dsh:promptEnhance", async (_e, args) => {
  if (!args || !isStr(args.draft) || args.draft.trim().length === 0 || args.draft.length > 8000) {
    throw new Error("bad arguments");
  }
  return withHost(() => bridge.request("prompt/enhance", { draft: args.draft }));
});
// 轮询与取消没有负载：增强进行到哪一步只能由宿主说，渲染层猜不出也改不了。
ipcMain.handle("dsh:promptPoll", async () => withHost(() => bridge.request("prompt/poll")));
ipcMain.handle("dsh:promptCancel", async () => withHost(() => bridge.request("prompt/cancel")));
ipcMain.handle("dsh:usageStatus", async () => withHost(() => bridge.request("usage/status")));
// 预算只许收紧：非整数、负数在主进程就拒收，调大由核心回 applied:false。
// 界面拿不到「抬高当前档位」的任何通路，也拿不到发任意方法的那条通道。
ipcMain.handle("dsh:usageSetBudget", async (_e, args) => {
  const b = args && args.budget;
  if (typeof b !== "number" || !Number.isInteger(b) || b < 0) throw new Error("bad-budget");
  return withHost(() => bridge.request("usage/set-budget", { budget: b }));
});

ipcMain.handle("dsh:sessionCatalog", async () => bridge.request("session/catalog"));
ipcMain.handle("dsh:workspaceGet", async () => withHost(()=>bridge.request("workspace/get")));
ipcMain.handle("dsh:workspaceChoose", async () => withHost(async()=>{
  const workspace=await bridge.request("workspace/get");
  const choice=await chooseWorkspaceDirectory({title:"选择 SaCode 项目目录", properties:["openDirectory"],
    defaultPath: workspace.configured && workspace.available ? workspace.directory : app.getPath("documents")});
  if(choice.canceled) return {cancelled:true};
  if(!Array.isArray(choice.filePaths) || choice.filePaths.length!==1 || !isStr(choice.filePaths[0])) throw new Error("bad directory selection");
  return bridge.request("workspace/set-directory", {directory:choice.filePaths[0]});
}));
ipcMain.handle("dsh:sessionCreate", async (_e, args) => {
  if (!args || !isStr(args.title) || !args.title.trim() || args.title.length>80 || /[\x00-\x1f\x7f]/.test(args.title)) throw new Error("bad arguments");
  return withHost(()=>bridge.request("session/create", {title:args.title}));
});
ipcMain.handle("dsh:sessionSelect", async (_e, args) => {
  if (!args || !isStr(args.sessionId) || !args.sessionId || args.sessionId.length>300) throw new Error("bad arguments");
  return withHost(async()=>{
    const selected = await bridge.request("session/select", {sessionId:args.sessionId});
    return selected;
  });
});
ipcMain.handle("dsh:appearanceGet", async () => {
  const result=await withHost(() => bridge.request("appearance/get"));
  return result;
});
// 桌面主题只取用户配置；旧会话主题仍可读取，但不再改变窗口。
ipcMain.handle("dsh:globalAppearanceGet", async () => {
  const result=await withHost(() => bridge.request("global/appearance/get"));
  nativeTheme.themeSource=result.theme;
  return result;
});
ipcMain.handle("dsh:globalAppearanceSetTheme", async (_e, args) => {
  if (!args || !["system", "light", "dark"].includes(args.theme)) throw new Error("bad-theme");
  const result=await withHost(() => bridge.request("global/appearance/set-theme", { theme:args.theme }));
  if (!result.saved) throw new Error("theme-not-saved");
  nativeTheme.themeSource=result.theme;
  return result;
});
ipcMain.handle("dsh:globalAppearanceSetFontSize", async (_e, args) => {
  if (!args || !Number.isInteger(args.fontSize) || args.fontSize < 10 || args.fontSize > 22) throw new Error("bad-font-size");
  const result=await withHost(() => bridge.request("global/appearance/set-font-size", { fontSize:args.fontSize }));
  if (!result.saved) throw new Error("font-size-not-saved");
  nativeTheme.themeSource=result.theme;
  return result;
});
ipcMain.handle("dsh:appearanceSetTheme", async (_e, args) => {
  if (!args || !["system", "light", "dark"].includes(args.theme)) throw new Error("bad-theme");
  const result=await withHost(() => bridge.request("appearance/set-theme", { theme: args.theme }));
  if (!result.saved) throw new Error("theme-not-saved");
  return result;
});

// 模型配置面：字段守卫在主进程（models-guard.cjs），凭据名由核心按 ID 派生。
// 密钥只在「写凭据」这一次调用里存在：不透传进注册表文档，不回写，不落日志。
const modelsGuard = require("./models-guard.cjs");

ipcMain.handle("dsh:modelsDescribe", async () => withHost(() => bridge.request("model/registry/describe")));
ipcMain.handle("dsh:modelsCatalog", async () => withHost(() => bridge.request("model/registry/catalog")));

ipcMain.handle("dsh:modelsSave", async (_e, args) => {
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

ipcMain.handle("dsh:modelsRemove", async (_e, args) => {
  const id = args && args.id;
  if (!isStr(id) || id.length === 0 || id.length > 64) throw new Error("bad-model-id");
  return withHost(() => bridge.request("model/registry/remove", { id, expectedRevision: modelsGuard.sanitizeRevision(args.expectedRevision) }));
});

ipcMain.handle("dsh:modelsSetDefault", async (_e, args) => {
  const providerId = args && args.providerId;
  const model = args && args.model;
  if (!isStr(providerId) || providerId.length === 0 || providerId.length > 64) throw new Error("bad-model-provider");
  if (!isStr(model) || model.length === 0 || model.length > 200) throw new Error("bad-model-name");
  return withHost(() => bridge.request("model/registry/set-default", {
    providerId, model, expectedRevision: modelsGuard.sanitizeRevision(args.expectedRevision),
  }));
});

// 「测试连接 / 获取可用模型」：草稿还没保存就能问远端，内联明文只活在这一次调用里。
ipcMain.handle("dsh:modelsList", async (_e, args) => {
  const request = modelsGuard.sanitizeListRequest(args);
  return withHost(() => bridge.request("model/list", request));
});

// 第 3 层自定义模型与模型目录写面：字段守卫在主进程（customs-guard.cjs），
// 第 3 层文档不认识 baseUrl 与凭据，草稿里出现它们一律拒收。
const customsGuard = require("./customs-guard.cjs");

ipcMain.handle("dsh:customsDescribe", async () => withHost(() => bridge.request("custom/describe")));

ipcMain.handle("dsh:customsUpsert", async (_e, args) => {
  const draft = customsGuard.sanitizeDraft(args && args.draft);
  const expectedRevision = customsGuard.sanitizeRevision(args ? args.expectedRevision : undefined);
  return withHost(() => bridge.request("custom/upsert", { draft, expectedRevision }));
});

ipcMain.handle("dsh:customsRemove", async (_e, args) => {
  const customId = args && args.customId;
  if (!isStr(customId) || customId.length === 0 || customId.length > 64) throw new Error("bad-custom-id");
  return withHost(() => bridge.request("custom/remove", { customId, expectedRevision: customsGuard.sanitizeRevision(args.expectedRevision) }));
});

ipcMain.handle("dsh:bindingUpsert", async (_e, args) => {
  const customId = args && args.customId;
  if (!isStr(customId) || customId.length === 0 || customId.length > 64) throw new Error("bad-custom-id");
  const binding = customsGuard.sanitizeBinding(args && args.binding);
  return withHost(() => bridge.request("binding/upsert", { customId, binding, expectedRevision: customsGuard.sanitizeRevision(args.expectedRevision) }));
});

ipcMain.handle("dsh:bindingRemove", async (_e, args) => {
  const customId = args && args.customId;
  const providerId = args && args.providerId;
  const modelId = args && args.modelId;
  if (!isStr(customId) || customId.length === 0 || customId.length > 64) throw new Error("bad-custom-id");
  if (!isStr(providerId) || providerId.length === 0 || providerId.length > 64) throw new Error("bad-custom-provider");
  if (!isStr(modelId) || modelId.length === 0 || modelId.length > 200) throw new Error("bad-custom-model");
  return withHost(() => bridge.request("binding/remove", { customId, providerId, modelId, expectedRevision: customsGuard.sanitizeRevision(args.expectedRevision) }));
});

ipcMain.handle("dsh:bindingReorder", async (_e, args) => {
  const customId = args && args.customId;
  if (!isStr(customId) || customId.length === 0 || customId.length > 64) throw new Error("bad-custom-id");
  const keys = customsGuard.sanitizeKeyList(args && args.keys);
  return withHost(() => bridge.request("binding/reorder", { customId, keys, expectedRevision: customsGuard.sanitizeRevision(args.expectedRevision) }));
});

ipcMain.handle("dsh:modelPull", async (_e, args) => {
  const providerId = args && args.providerId;
  if (!isStr(providerId) || providerId.length === 0 || providerId.length > 64) throw new Error("bad-model-provider");
  return withHost(() => bridge.request("model/pull", { providerId, expectedRevision: customsGuard.sanitizeRevision(args.expectedRevision) }));
});

ipcMain.handle("dsh:modelUpstreamUpsert", async (_e, args) => {
  const providerId = args && args.providerId;
  const modelId = args && args.modelId;
  if (!isStr(providerId) || providerId.length === 0 || providerId.length > 64) throw new Error("bad-model-provider");
  if (!isStr(modelId) || modelId.length === 0 || modelId.length > 200) throw new Error("bad-model-name");
  return withHost(() => bridge.request("model/upstream/upsert", { providerId, modelId, expectedRevision: customsGuard.sanitizeRevision(args.expectedRevision) }));
});

ipcMain.handle("dsh:customImportNew", async (_e, args) => {
  const items = customsGuard.sanitizeKeyList(args && args.items);
  return withHost(() => bridge.request("custom/import/new", { items, expectedRevision: customsGuard.sanitizeRevision(args.expectedRevision) }));
});

ipcMain.handle("dsh:customImportInto", async (_e, args) => {
  const customId = args && args.customId;
  if (!isStr(customId) || customId.length === 0 || customId.length > 64) throw new Error("bad-custom-id");
  const items = customsGuard.sanitizeKeyList(args && args.items);
  return withHost(() => bridge.request("custom/import/into", { customId, items, expectedRevision: customsGuard.sanitizeRevision(args.expectedRevision) }));
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
