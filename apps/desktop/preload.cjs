const { contextBridge, ipcRenderer } = require("electron");
// 只暴露固定动作：方法名与宿主路径都留在主进程，渲染层拼不出任意方法或参数结构。
// 没有通用的 request(everything) 通道——那等于把宿主协议面整个交给网页。
contextBridge.exposeInMainWorld("sacode", {
  projection: () => ipcRenderer.invoke("sacode:projection"),
  userSend: (text, receiptIds) => ipcRenderer.invoke("sacode:userSend", { text, receiptIds }),
  // 附件：字节只以 base64 过界一次，落盘、内容寻址 id 与暂存凭证都由核心铸造，
  // 渲染层既拿不到宿主路径，也没通路自报「我上传过这个 id」。
  attachmentUpload: (kind, name, mediaType, data) => ipcRenderer.invoke("sacode:attachmentUpload", { kind, name, mediaType, data }),
  attachmentImageRead: (sessionId, attachmentId) => ipcRenderer.invoke("sacode:attachmentImageRead", { sessionId, attachmentId }),
  goalDescribe: (sessionId) => ipcRenderer.invoke("sacode:goalDescribe", { sessionId }),
  goalCreate: (sessionId, objective) => ipcRenderer.invoke("sacode:goalCreate", { sessionId, objective }),
  goalEdit: (sessionId, revision, objective) => ipcRenderer.invoke("sacode:goalEdit", { sessionId, revision, objective }),
  goalPause: (sessionId, revision) => ipcRenderer.invoke("sacode:goalPause", { sessionId, revision }),
  goalResume: (sessionId, revision) => ipcRenderer.invoke("sacode:goalResume", { sessionId, revision }),
  goalClear: (sessionId, revision) => ipcRenderer.invoke("sacode:goalClear", { sessionId, revision }),
  toolsList: () => ipcRenderer.invoke("sacode:toolsList"),
  toolCall: (name, args, approvalId) => ipcRenderer.invoke("sacode:toolCall", { name, args, approvalId }),
  approvalAsk: (name) => ipcRenderer.invoke("sacode:approvalAsk", { name }),
  approvalAnswer: (approvalId, decision) => ipcRenderer.invoke("sacode:approvalAnswer", { approvalId, decision }),
  turnStart: (limit) => ipcRenderer.invoke("sacode:turnStart", { limit }),
  // 产品路径起轮：负载是空的，渲染层改不动它，也未配置时由核心显式失败
  taskStart: (customModelId) => ipcRenderer.invoke("sacode:taskStart", { customModelId }),
  ledgerStats: () => ipcRenderer.invoke("sacode:ledgerStats"),
  // 运行中消息队列：条目由核心铸造，界面只能排、只能改自己那一条，拿不到通用转发
  queueDescribe: () => ipcRenderer.invoke("sacode:queueDescribe"),
  queueEnqueue: (text, rpcId, receiptIds, accelerated = false) => ipcRenderer.invoke("sacode:queueEnqueue", { text, rpcId, receiptIds, ...(accelerated === false ? {} : { accelerated }) }),
  queueUpdate: (itemId, kind, text) => ipcRenderer.invoke("sacode:queueUpdate", { itemId, kind, text }),
  turnPoll: () => ipcRenderer.invoke("sacode:turnPoll"),
  turnCancel: () => ipcRenderer.invoke("sacode:turnCancel"),
  // 提示词增强：负载里只有一个草稿字段。用哪颗模型、哪个端点、哪份凭据都由宿主在
  // 点击那一刻自己定——渲染层既说不出 model，也说不出 baseUrl，更没有报凭据的位置。
  promptEnhance: (draft) => ipcRenderer.invoke("sacode:promptEnhance", { draft }),
  promptPoll: () => ipcRenderer.invoke("sacode:promptPoll"),
  promptCancel: () => ipcRenderer.invoke("sacode:promptCancel"),
  usageStatus: () => ipcRenderer.invoke("sacode:usageStatus"),
  usageSetBudget: (budget) => ipcRenderer.invoke("sacode:usageSetBudget", { budget }),
  appearanceGet: () => ipcRenderer.invoke("sacode:appearanceGet"),
  globalAppearanceGet: () => ipcRenderer.invoke("sacode:globalAppearanceGet"),
  globalAppearanceSetTheme: (theme) => ipcRenderer.invoke("sacode:globalAppearanceSetTheme", { theme }),
  globalAppearanceSetFontSize: (fontSize) => ipcRenderer.invoke("sacode:globalAppearanceSetFontSize", { fontSize }),
  globalAppearanceSetBusySend: (busySend) => ipcRenderer.invoke("sacode:globalAppearanceSetBusySend", { busySend }),
  sessionCatalog: () => ipcRenderer.invoke("sacode:sessionCatalog"),
  // 已落盘事件流（轨迹视图）：只回放 durable 事件，cursor 之后 limit 之内。
  sessionEvents: (cursor, limit) => ipcRenderer.invoke("sacode:sessionEvents", { cursor, limit }),
  sessionCreate: (title) => ipcRenderer.invoke("sacode:sessionCreate", { title }),
  sessionSelect: (sessionId) => ipcRenderer.invoke("sacode:sessionSelect", { sessionId }),
  workspaceGet: () => ipcRenderer.invoke("sacode:workspaceGet"),
  workspaceChoose: () => ipcRenderer.invoke("sacode:workspaceChoose"),
  // path 为空串时列工作区根；目录树展开时按相对子路径取子目录。
  workspaceFiles: (path) => ipcRenderer.invoke("sacode:workspaceFiles", { path: path || "" }),
  appearanceSetTheme: (theme) => ipcRenderer.invoke("sacode:appearanceSetTheme", { theme }),
  globalSettingsGet: () => ipcRenderer.invoke("sacode:globalSettingsGet"),
  globalSettingsSet: (key, value) => ipcRenderer.invoke("sacode:globalSettingsSet", { key, value }),
  // 模型配置面：一个动作一条通道，字段形状由主进程守卫，渲染层拼不出任意宿主方法。
  modelsDescribe: () => ipcRenderer.invoke("sacode:modelsDescribe"),
  modelsCatalog: () => ipcRenderer.invoke("sacode:modelsCatalog"),
  modelsSave: (draft, key, expectedRevision) => ipcRenderer.invoke("sacode:modelsSave", { draft, key, expectedRevision }),
  modelsRemove: (id, expectedRevision) => ipcRenderer.invoke("sacode:modelsRemove", { id, expectedRevision }),
  modelsSetDefault: (providerId, model, expectedRevision) => ipcRenderer.invoke("sacode:modelsSetDefault", { providerId, model, expectedRevision }),
  // 供应商单列写：拖动排序与启停都不重写整条记录（内置供应商拒绝整条 update，但不拒绝这两列）。
  modelsSort: (providerId, sortOrder, expectedRevision) => ipcRenderer.invoke("sacode:modelsSort", { providerId, sortOrder, expectedRevision }),
  modelsSetEnabled: (providerId, enabled, expectedRevision) => ipcRenderer.invoke("sacode:modelsSetEnabled", { providerId, enabled, expectedRevision }),
  modelsList: (request) => ipcRenderer.invoke("sacode:modelsList", { baseUrl: request.baseUrl, apiKey: request.apiKey }),
  // 第 3 层自定义模型与模型目录写面：一个动作一条通道，字段形状由主进程守卫
  // （customs-guard.cjs），渲染层拼不出任意宿主方法，也没有「发任意请求」的通道。
  customsDescribe: () => ipcRenderer.invoke("sacode:customsDescribe"),
  customsUpsert: (draft, expectedRevision) => ipcRenderer.invoke("sacode:customsUpsert", { draft, expectedRevision }),
  customsRemove: (customId, expectedRevision) => ipcRenderer.invoke("sacode:customsRemove", { customId, expectedRevision }),
  bindingUpsert: (customId, binding, expectedRevision) => ipcRenderer.invoke("sacode:bindingUpsert", { customId, binding, expectedRevision }),
  bindingRemove: (customId, providerId, modelId, expectedRevision) => ipcRenderer.invoke("sacode:bindingRemove", { customId, providerId, modelId, expectedRevision }),
  bindingReorder: (customId, keys, expectedRevision) => ipcRenderer.invoke("sacode:bindingReorder", { customId, keys, expectedRevision }),
  modelPull: (providerId, expectedRevision) => ipcRenderer.invoke("sacode:modelPull", { providerId, expectedRevision }),
  modelUpstreamUpsert: (providerId, modelId, expectedRevision) => ipcRenderer.invoke("sacode:modelUpstreamUpsert", { providerId, modelId, expectedRevision }),
  customImportNew: (items, expectedRevision) => ipcRenderer.invoke("sacode:customImportNew", { items, expectedRevision }),
  customImportInto: (customId, items, expectedRevision) => ipcRenderer.invoke("sacode:customImportInto", { customId, items, expectedRevision }),
  // 插件清单：逐字段校验通道（缺通道时适配器保持 unconnected，不冒充本地状态）
  pluginsDescribe: () => ipcRenderer.invoke("sacode:pluginsDescribe"),
  pluginsSetEnabled: (name, enabled, expectedRevision) => ipcRenderer.invoke("sacode:pluginsSetEnabled", { name, enabled, expectedRevision }),
  pluginsSetRowEnabled: (entryId, enabled, expectedRevision) => ipcRenderer.invoke("sacode:pluginsSetRowEnabled", { entryId, enabled, expectedRevision }),
  pluginsUninstall: (name, expectedRevision) => ipcRenderer.invoke("sacode:pluginsUninstall", { name, expectedRevision }),
  pluginsRegistries: () => ipcRenderer.invoke("sacode:pluginsRegistries"),
  pluginsInspect: (spec, registry) => ipcRenderer.invoke("sacode:pluginsInspect", { spec, registry }),
  pluginsInstall: (request) => ipcRenderer.invoke("sacode:pluginsInstall", { spec: request?.spec, registry: request?.registry, requestId: request?.requestId, approvedBuilds: request?.approvedBuilds }),
  pluginsInstallPoll: (requestId) => ipcRenderer.invoke("sacode:pluginsInstallPoll", { requestId }),
  pluginsInstallCancel: (requestId) => ipcRenderer.invoke("sacode:pluginsInstallCancel", { requestId }),
  // Next SDK 页面工具：列出与调用
  pageToolsList: () => ipcRenderer.invoke("sacode:pageToolsList"),
  pageToolCall: (name, args) => ipcRenderer.invoke("sacode:pageToolCall", { name, args }),
});
