const { contextBridge, ipcRenderer } = require("electron");
// 只暴露固定动作：方法名与宿主路径都留在主进程，渲染层拼不出任意方法或参数结构。
// 没有通用的 request(everything) 通道——那等于把宿主协议面整个交给网页。
contextBridge.exposeInMainWorld("dsh", {
  projection: () => ipcRenderer.invoke("dsh:projection"),
  userSend: (text) => ipcRenderer.invoke("dsh:userSend", { text }),
  toolsList: () => ipcRenderer.invoke("dsh:toolsList"),
  toolCall: (name, args, approvalId) => ipcRenderer.invoke("dsh:toolCall", { name, args, approvalId }),
  approvalAsk: (name) => ipcRenderer.invoke("dsh:approvalAsk", { name }),
  approvalAnswer: (approvalId, decision) => ipcRenderer.invoke("dsh:approvalAnswer", { approvalId, decision }),
  turnStart: (limit) => ipcRenderer.invoke("dsh:turnStart", { limit }),
  // 产品路径起轮：负载是空的，渲染层改不动它，也未配置时由核心显式失败
  taskStart: () => ipcRenderer.invoke("dsh:taskStart"),
  // 运行中消息队列：条目由核心铸造，界面只能排、只能改自己那一条，拿不到通用转发
  queueDescribe: () => ipcRenderer.invoke("dsh:queueDescribe"),
  queueEnqueue: (text, rpcId) => ipcRenderer.invoke("dsh:queueEnqueue", { text, rpcId }),
  queueUpdate: (itemId, kind, text) => ipcRenderer.invoke("dsh:queueUpdate", { itemId, kind, text }),
  turnPoll: () => ipcRenderer.invoke("dsh:turnPoll"),
  turnCancel: () => ipcRenderer.invoke("dsh:turnCancel"),
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
});
