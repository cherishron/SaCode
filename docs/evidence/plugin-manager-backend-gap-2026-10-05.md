# 插件管理器真实接线缺口核验（2026-10-05）

## 源码观察

已直接读取 `apps/desktop/renderer/pages/plugin-manager.ts` 与检索 `apps/desktop/renderer/app.js`：

- plugin-manager.ts 定义 Adapter.read/dispatch/subscribe（第 12 行），视图仅在存在 adapter 时读取快照与发送动作（第 44–47 行）。默认 available=false、packages=[]，无 adapter 时状态为 unconnected（第 38–39 行）。
- app.js 第 1418 行挂载 `h(window.SaCodePluginManager.Page)`，没有传 adapter。页面按钮与上游风格存在不等于安装管理能力已接入。
- 页头注释“安装任务、取消确认、启用状态均由仓颉适配器提供”是接口设计意图，不能据此声明当前已接仓颉。

## 结论与实施顺序

插件管理器当前仍是未接线页面，不可用 UI 冒烟中聊天槽位卸载/重装通过替代安装管理验收。应核验上游本地包安装、manifest、依赖激活、配置持久化、任务状态及取消确认契约，再实现仓颉真源与有限 Host/IPC，接入 Adapter；不能通过伪造 packages 快照或仅在 JS 保存 enabled 状态宣称完成。

## 导出模块取证进展与失败

冻结 GitHub 树 `D:/Temp/SaCode-official-639ed015/tree.json` 确认 session-log-export 位于 packages/session-query/session-log-export，存在 archive.ts、routes.ts、Dialog.tsx、HeaderAction.tsx、controller.ts 及 archive/controller/route 测试。这只是来源路径证据，尚未读到契约正文。

当前开发环境的 `D:/Program Files/Deepseek/DeepSeek Harness/resources/app.asar/dsh` 实际不可访问，不能冒充已检查本机上游实现。现有 upstream.zip 无有效 ZIP 中央目录，提取失败；官方固定提交的 raw 文本用 web_fetch、Invoke-WebRequest 和 curl 请求均失败（TLS/连接重置）。未据此推断导出格式，更没有将任意 CSV/JSON 导出设计当成 DSH 复刻。

上述取证失败不作为全目标阻塞：仍可推进已冻结下载的源码、产品接线审计与其他能力。下一步优先核查已有 PluginManagerPage.tsx、manager-store.ts 以及冻结树安装模块路径，补齐源码后再实现。
