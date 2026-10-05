const { contextBridge, ipcRenderer } = require("electron");
// 只暴露固定动作：方法名与宿主路径都留在主进程，渲染层拼不出任意方法或参数结构。
// 没有通用的 request(everything) 通道——那等于把宿主协议面整个交给网页。
contextBridge.exposeInMainWorld("dsh", {
  projection: () => ipcRenderer.invoke("dsh:projection"),
  userSend: (text, receiptIds) => ipcRenderer.invoke("dsh:userSend", { text, receiptIds }),
  // 附件：字节只以 base64 过界一次，落盘、内容寻址 id 与暂存凭证都由核心铸造，
  // 渲染层既拿不到宿主路径，也没通路自报「我上传过这个 id」。
  attachmentUpload: (kind, name, mediaType, data) => ipcRenderer.invoke("dsh:attachmentUpload", { kind, name, mediaType, data }),
  attachmentImageRead: (sessionId, attachmentId) => ipcRenderer.invoke("dsh:attachmentImageRead", { sessionId, attachmentId }),
  goalDescribe: (sessionId) => ipcRenderer.invoke("dsh:goalDescribe", { sessionId }),
  goalCreate: (sessionId, objective) => ipcRenderer.invoke("dsh:goalCreate", { sessionId, objective }),
  goalEdit: (sessionId, revision, objective) => ipcRenderer.invoke("dsh:goalEdit", { sessionId, revision, objective }),
  goalPause: (sessionId, revision) => ipcRenderer.invoke("dsh:goalPause", { sessionId, revision }),
  goalResume: (sessionId, revision) => ipcRenderer.invoke("dsh:goalResume", { sessionId, revision }),
  goalClear: (sessionId, revision) => ipcRenderer.invoke("dsh:goalClear", { sessionId, revision }),
  toolsList: () => ipcRenderer.invoke("dsh:toolsList"),
  toolCall: (name, args, approvalId) => ipcRenderer.invoke("dsh:toolCall", { name, args, approvalId }),
  approvalAsk: (name) => ipcRenderer.invoke("dsh:approvalAsk", { name }),
  approvalAnswer: (approvalId, decision) => ipcRenderer.invoke("dsh:approvalAnswer", { approvalId, decision }),
  turnStart: (limit) => ipcRenderer.invoke("dsh:turnStart", { limit }),
  // 产品路径起轮：负载是空的，渲染层改不动它，也未配置时由核心显式失败
  taskStart: () => ipcRenderer.invoke("dsh:taskStart"),
  // 运行中消息队列：条目由核心铸造，界面只能排、只能改自己那一条，拿不到通用转发
  queueDescribe: () => ipcRenderer.invoke("dsh:queueDescribe"),
  queueEnqueue: (text, rpcId, receiptIds) => ipcRenderer.invoke("dsh:queueEnqueue", { text, rpcId, receiptIds }),
  queueUpdate: (itemId, kind, text) => ipcRenderer.invoke("dsh:queueUpdate", { itemId, kind, text }),
  turnPoll: () => ipcRenderer.invoke("dsh:turnPoll"),
  turnCancel: () => ipcRenderer.invoke("dsh:turnCancel"),
  // 提示词增强：负载里只有一个草稿字段。用哪颗模型、哪个端点、哪份凭据都由宿主在
  // 点击那一刻自己定——渲染层既说不出 model，也说不出 baseUrl，更没有报凭据的位置。
  promptEnhance: (draft) => ipcRenderer.invoke("dsh:promptEnhance", { draft }),
  promptPoll: () => ipcRenderer.invoke("dsh:promptPoll"),
  promptCancel: () => ipcRenderer.invoke("dsh:promptCancel"),
  usageStatus: () => ipcRenderer.invoke("dsh:usageStatus"),
  usageSetBudget: (budget) => ipcRenderer.invoke("dsh:usageSetBudget", { budget }),
  appearanceGet: () => ipcRenderer.invoke("dsh:appearanceGet"),
  globalAppearanceGet: () => ipcRenderer.invoke("dsh:globalAppearanceGet"),
  globalAppearanceSetTheme: (theme) => ipcRenderer.invoke("dsh:globalAppearanceSetTheme", { theme }),
  globalAppearanceSetFontSize: (fontSize) => ipcRenderer.invoke("dsh:globalAppearanceSetFontSize", { fontSize }),
  sessionCatalog: () => ipcRenderer.invoke("dsh:sessionCatalog"),
  sessionCreate: (title) => ipcRenderer.invoke("dsh:sessionCreate", { title }),
  sessionSelect: (sessionId) => ipcRenderer.invoke("dsh:sessionSelect", { sessionId }),
  workspaceGet: () => ipcRenderer.invoke("dsh:workspaceGet"),
  workspaceChoose: () => ipcRenderer.invoke("dsh:workspaceChoose"),
  appearanceSetTheme: (theme) => ipcRenderer.invoke("dsh:appearanceSetTheme", { theme }),
  // 模型配置面：一个动作一条通道，字段形状由主进程守卫，渲染层拼不出任意宿主方法。
  modelsDescribe: () => ipcRenderer.invoke("dsh:modelsDescribe"),
  modelsCatalog: () => ipcRenderer.invoke("dsh:modelsCatalog"),
  modelsSave: (draft, key, expectedRevision) => ipcRenderer.invoke("dsh:modelsSave", { draft, key, expectedRevision }),
  modelsRemove: (id, expectedRevision) => ipcRenderer.invoke("dsh:modelsRemove", { id, expectedRevision }),
  modelsSetDefault: (providerId, model, expectedRevision) => ipcRenderer.invoke("dsh:modelsSetDefault", { providerId, model, expectedRevision }),
  modelsList: (request) => ipcRenderer.invoke("dsh:modelsList", { baseUrl: request.baseUrl, apiKey: request.apiKey }),
  // 第 3 层自定义模型与模型目录写面：一个动作一条通道，字段形状由主进程守卫
  // （customs-guard.cjs），渲染层拼不出任意宿主方法，也没有「发任意请求」的通道。
  customsDescribe: () => ipcRenderer.invoke("dsh:customsDescribe"),
  customsUpsert: (draft, expectedRevision) => ipcRenderer.invoke("dsh:customsUpsert", { draft, expectedRevision }),
  customsRemove: (customId, expectedRevision) => ipcRenderer.invoke("dsh:customsRemove", { customId, expectedRevision }),
  bindingUpsert: (customId, binding, expectedRevision) => ipcRenderer.invoke("dsh:bindingUpsert", { customId, binding, expectedRevision }),
  bindingRemove: (customId, providerId, modelId, expectedRevision) => ipcRenderer.invoke("dsh:bindingRemove", { customId, providerId, modelId, expectedRevision }),
  bindingReorder: (customId, keys, expectedRevision) => ipcRenderer.invoke("dsh:bindingReorder", { customId, keys, expectedRevision }),
  modelPull: (providerId, expectedRevision) => ipcRenderer.invoke("dsh:modelPull", { providerId, expectedRevision }),
  modelUpstreamUpsert: (providerId, modelId, expectedRevision) => ipcRenderer.invoke("dsh:modelUpstreamUpsert", { providerId, modelId, expectedRevision }),
  customImportNew: (items, expectedRevision) => ipcRenderer.invoke("dsh:customImportNew", { items, expectedRevision }),
  customImportInto: (customId, items, expectedRevision) => ipcRenderer.invoke("dsh:customImportInto", { customId, items, expectedRevision }),
});
