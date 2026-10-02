const { contextBridge, ipcRenderer } = require("electron");
// 只暴露两个固定动作；方法名与宿主路径都留在主进程。
contextBridge.exposeInMainWorld("dsh", {
  projection: () => ipcRenderer.invoke("dsh:projection"),
  append: (eventType, data) => ipcRenderer.invoke("dsh:append", { eventType, data }),
});
