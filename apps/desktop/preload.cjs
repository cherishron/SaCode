const { contextBridge, ipcRenderer } = require("electron");
// 只暴露固定动作：方法名与宿主路径都留在主进程，渲染层拼不出任意方法或参数结构。
// 没有通用的 request(everything) 通道——那等于把宿主协议面整个交给网页。
contextBridge.exposeInMainWorld("dsh", {
  projection: () => ipcRenderer.invoke("dsh:projection"),
  userSend: (text) => ipcRenderer.invoke("dsh:userSend", { text }),
  toolsList: () => ipcRenderer.invoke("dsh:toolsList"),
  toolCall: (name, args, approval) => ipcRenderer.invoke("dsh:toolCall", { name, args, approval }),
  turnStart: (limit) => ipcRenderer.invoke("dsh:turnStart", { limit }),
  turnPoll: () => ipcRenderer.invoke("dsh:turnPoll"),
  turnCancel: () => ipcRenderer.invoke("dsh:turnCancel"),
});
