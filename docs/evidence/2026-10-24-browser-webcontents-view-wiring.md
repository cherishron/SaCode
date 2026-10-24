# 2026-10-24 内置浏览器 WebContentsView 接线（F14 人工浏览入口）

本机 Windows、未提交工作区、独立增量不混入当前桌面候选。用户选定边界：人工浏览由主进程 Electron `WebContentsView` 托管，Agent 操控仍走受授权的 Host/provider；本批只接通正式工作台入口、视图创建/销毁、导航与历史、尺寸同步、切页隐藏和弹窗遮挡；外部页面隔离会话、不加载工作台 preload，权限申请、下载、新窗口及危险协议默认拒绝。

## 范围与不做项

- **做**：主进程 `WebContentsView` 控制器 + 8 条固定动作 IPC + 渲染层 `BrowserPanel` 正式装配 + 工作台资源入口 + 弹层/切页/缩窗遮挡联动 + 切项目销毁旧视图与清除旧 cookie。
- **不做**：Agent 浏览器 provider（仍走既有 `browser/*` Host 通道，未改）、截图授权与 `attachmentImageRead` 接线、多标签与登录态徽标、电脑操控、`webFetch`/`webSearch` 桌面通道（F14 另一条缺口，本批不动）、core/Host 改动。
- **不升级 F14 为完成**：仅人工浏览入口接通；BC01–BC08 中 BC02 多标签/登录会话、BC03 截图读取、BC04 点击/表单/提交、BC05 窗口激活、BC06 截图/剪贴板、BC07 紧急停止（关面板不停 provider 的语义对人工浏览已落实）、BC08 重启不续操控均未完整覆盖。

## 实现

- **主进程控制器** [`apps/desktop/browser-view.cjs`](../../apps/desktop/browser-view.cjs)（新文件）：`registerBrowserViewIpc` 暴露 8 条 `sacode:browserView*` handler（Open/Describe/Navigate/Back/Forward/Reload/Close/Layout）。每条按 `event.sender===win.webContents && event.senderFrame===mainFrame` 拒绝外部来源与子框架；参数闭集校验；`Layout` 几何裁剪到窗口内容范围。
  - 隔离：`session.fromPartition('browser-view-<uuid>')`（非 `persist:`，进程结束即删）；`setPermissionRequestHandler/CheckHandler/DevicePermissionHandler` 全拒；`will-download` 取消；`webRequest.onBeforeRequest` 只放行当前明确目标同源；`will-navigate`/`will-frame-navigate`/`will-redirect` 跨站拒绝；`setWindowOpenHandler` deny；`will-attach-webview` 阻止。
  - 生命周期：窗口 `closed`/`render-process-gone`/`did-start-navigation`(主框架)/`resize`/`minimize` 触发 `close()`（removeChildView + webContents.close + clearStorageData）；切项目时旧 owner 不匹配即销毁重建。
- **IPC 面**：[`preload.cjs`](../../apps/desktop/preload.cjs) +8 通道 `browserViewOpen/Describe/Back/Forward/Reload/Close/Navigate/Layout`，逐字段闭集校验（URL 仅完整 HTTP(S) 且不含用户名密码；bounds 非负整数 ≤32768）。[`main.cjs`](../../apps/desktop/main.cjs) 在 `require('./browser-view.cjs')` 后注册，`WebContentsView`/`session` 从 electron 解构。`package.json` 打包清单加 `browser-view.cjs`。
- **渲染层** [`renderer/pages/browser-panel.ts`](../../apps/desktop/renderer/pages/browser-panel.ts) 重写：去掉旧占位与 Host provider 契约，改为经 `props.api`（即 `window.sacode`）驱动独立视图。`onMounted` 建 `ResizeObserver`+`MutationObserver`+scroll/resize/visibilitychange 监听；`layout()` 把占位区几何经滚动父容器裁剪后发 `Layout`，弹层（`dialog[open]`/`[aria-modal]`/`[role=alertdialog]`/`.workbench-resource-picker`/`.t-popup`）打开时 `visible=false`；750ms `Describe` 轮询同步真实页面状态；切项目时先 `Close` 旧 owner 再 `Open` 新 owner，旧导航迟到回执不覆盖新目标。[`renderer/browser-panel.css`](../../apps/desktop/renderer/browser-panel.css)（新）用既有令牌（`--space-*`/`--surface-2`/`--border`/`--fs-*`）。
- **工作台入口**：[`pages/workbench-tabs.ts`](../../apps/desktop/renderer/pages/workbench-tabs.ts) resources 加 `browser`（`available:true`）；[`pages/client-slots.ts`](../../apps/desktop/renderer/pages/client-slots.ts) 导出 `BrowserPanel`；[`renderer/app.js`](../../apps/desktop/renderer/app.js) 加 `side-page-browser` 面板与 `browserResourceOpen` 状态；[`renderer/side-panels.js`](../../apps/desktop/renderer/side-panels.js) `onSelect`/`onClose` 联动；[`renderer/index.html`](../../apps/desktop/renderer/index.html) 加 `browser-panel.css`。

## 验证（独占运行，默认安全启动，无 `--no-sandbox`）

- **单元 + 真实 Electron 套件** `node --test apps/desktop/test/browser/*.test.mjs`：**10/10 pass、0 fail**。
  - `browser-panel.test.mjs` 5/5：导航回执、滚动父容器裁剪、非活动不创建视图、建立中切项目仍关旧目标、迟到回执不覆盖新目标。
  - `browser-view-electron.test.mjs` 1/1（真实 Electron 33.4.11，仓外中立二进制 `D:/tmp/sacode-dialog-ui-20261024/electron`，`ELECTRON_OVERRIDE_DIST_PATH` 指向）：**20 项检查全过**——页面真实标题回执、隔离网页无工作台桥（`window.sacode`/`require` 均无）、同源重定向真实导航、后退/前进/刷新、测试页面 cookie 写入隔离会话、原生弹窗打开隐藏网页、弹窗关闭恢复、切页隐藏但不销毁、缩窗后视图在内容范围内、跨域重定向拒绝、下载默认取消（`will-download` → `cancel`）、新窗口默认拒绝、切项目销毁旧视图、新项目无旧 cookie、新项目会话分区不同、旧分区 cookie 已清除（`clearStorageData`）、关闭资源回收 webContents、无渲染错误。
  - `browser-view.test.mjs` 4/4：隔离视图创建与历史状态、外部来源/子框架/非法参数拒绝、危险 URL/跨域/下载/权限/新窗口拒绝、布局裁剪与旧归属不可驱动新视图。
- **完整工作台入口** `SACODE_UI_SMOKE_SUITE=browser electron . --ui-smoke`（中立目录 `D:/tmp/sacode-browser-main-20261024/app`，与源码 7 个关键文件 SHA256 逐字节一致）：`BROWSER_MAIN PASS` 5 项——正式添加资源入口导航真实网页、独立网页真实 DOM 与桥隔离、工作台设置弹窗可打开、切换资源后页面保留、关闭资源销毁原生网页。
- **IPC 面** `node scripts/check_ipc_surface_parity.cjs`：`GATE: PASS`，preload 212 ↔ main 212 双向差集为空；`bridge.test.mjs` 3/3（人工浏览 preload 契约、有限动作白名单、通道集合与主进程完全相等）。
- **相邻回归** `workbench-navigation`/`side-panels`/`page-sources-parse`/`renderer-syntax`/`renderer-el-shape`：18/18 pass；`pack-pages.mjs` rc=0。
- **进程收尾**：独占复跑后 `Get-CimInstance Win32_Process` 确认 electron/sacode-host 零残留。

## 边界与未验证

- **未改 core/Host**：不涉及仓颉构建；`browser/*` Host provider 通道（Agent 浏览器）与 `webFetch`/`webSearch` 桌面通道均未动。
- **未重打候选**：当前桌面交付候选 `D:/tmp/sacode-final-20261023` 不含本批改动；需重打 asar/候选才在交付包生效。
- **未提交/推送/安装/发布**。
- **GUI 观感与真实外部网页未由用户复验**：截图通道在隔离夹具中曾因 `WebContentsView` 子类继承导致 `capturePage` 返回 `Current display surface not available for capture`，改为直接创建原生对象后通过；产品代码未受影响。真实外部网站（非 127.0.0.1 测试页）的渲染、登录态、跨域行为未验。
- **多标签/登录徽标/截图预览/紧急停止 dock 未实现**：本批单标签、无截图、无后台控制态常驻。
- **不升级 F14 为完成**，不改当前交付卡候选与主阻塞。
