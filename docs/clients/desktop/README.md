# 桌面端（Electron 图形工作台）

> 类别：**⑪ 端文档**｜上级索引：[clients/README.md](../README.md)｜四端总览见 [README §2 差异矩阵](../README.md#2-跨端差异对比矩阵)。
> 源码：[`apps/desktop/`](../../../apps/desktop/)（壳 + 渲染层）+ [`apps/host/`](../../../apps/host/)（协议宿主，由桌面 spawn）。
> 设计规范：[`renderer/DESIGN.md`](../../../apps/desktop/renderer/DESIGN.md)、[`product/desktop-design-standard.md`](desktop-design-standard.md)。
> 状态口径：源码可查、单测可跑，但 GUI 观感与安装态须用户在桌面环境亲手复验；本页不把它称为已交付。

## 1. 用途

面向**桌面开发者**的图形化 AI 编程工作台，是产品的**主交付端**。

- **定位**：以中央 Agent 对话 + 计划/委派/执行详情为主，右侧可扩展工作台（编辑器、差异、Git、知识库、终端、数据库、浏览器等）辅助完成开发任务。
- **用户**：桌面开发者（见 [PRD §1 用户表](../../product/PRD.md)）——用对话驱动项目任务，直接修改工作区，在编辑器与差异区审查、修正。
- **成功判据**：跑通一条真实闭环——**正常双击 → 配置供应商/选模型 → 打开小项目 → AI 读取并提出文件修改 → 用户审批 → 实际修改并看见真实差异 → 关闭重开后记录和修改正确**（[PRD §近期交付顺序](../../product/PRD.md)、[交付主线 §0](../../plans/product-closure-goal-2026-10-15.md)）。

## 2. 需求

### 2.1 功能域映射

桌面端是 F01–F21 的**主要承载端**（[PRD](../../product/PRD.md)）。当前优先级不是“补齐 21 域”，而是先交付上述一条真实闭环；其余能力列入待办、不插入当前候选。已具备源码接线的主要页面/能力（对应 `renderer/pages/`）：

| 方向 | 页面/组件 | 说明 |
|---|---|---|
| 对话与消息 | `app.js`、`msgfold.js`、`markdown.js`、`code-block.js` | BubbleProvider＋BubbleList 渲染，正文走本仓自定义内容渲染器 |
| 供应商与模型 | `provider-settings.ts`、`models-page.ts`、`custom-models.ts`、`model-pull-state.ts` | 新增/编辑表单已改共享 `SaCodeDialog` 弹窗 |
| 权限模式 | `permission-menu.ts` | 四档模式，在途可切换（Host 侧已放宽 `approval/set-mode`） |
| 执行与差异 | `execution-task.ts`、`execution-history.ts`、`review-writeback.ts`、`task-review.ts` | 私有执行生命周期、写回确认与差异 |
| 计划与目标 | `plan-review.ts`、`goal-bar.ts`、`queue-dock.ts` | 计划审阅、目标可见性、发送队列在途态 |
| Git / 知识 / 数据 / 导入 / 自动化 | `git-workbench.ts`、`knowledge-page.ts`、`database-panel.ts`、`import-panel.ts`、`automation-page.ts` | 部分只读或后端未实现，状态如实标注 |
| 子代理与外部 Agent | `subagent-role-editor.ts`、`subagent-settings.ts`、`acp-*.ts` | 4 预设 + 自定义角色编辑；ACP 诊断/历史 |
| 内置浏览器 | `browser-panel.ts` + `browser-view.cjs` | 人工浏览入口（F14），隔离会话、默认拒绝跨站/下载 |
| 语音输入 | `voice.js` + 4 条 `sacode:voice*` IPC | ASR 未配置时 fail-closed |

> 页面的存在只是**接线证据**，不等于该域已验收。整体完成率**不计算**（[PRD §完成度](../../product/PRD.md)）。

### 2.2 平台与分发要求

桌面端目标平台为 Windows / Linux / macOS，全部采用 Electron（[platform-and-distribution.md §2](../../product/platform-and-distribution.md)）：

- Windows：必须支持；`exe` 必须与全部依赖 DLL 同目录（靠 Windows 默认搜索序，不拼 PATH）。
- Linux：必须支持，非“永久停在可编译”；已有 AppImage / deb 打包读数（见 [证据](2026-10-23-linux-desktop-package.md)）。
- macOS：当前缺设备运行证据，先建设构建与打包，运行验收待环境，不删目标。
- 鸿蒙不要求 Electron 输出安装包，前端后续独立 ArkTS/ArkUI 项目。

## 3. 设计

### 3.1 架构（Electron 三进程 + 宿主）

```text
main.cjs（主进程）
  ├─ 窗口与生命周期（frame.js / window-visibility.cjs）
  ├─ spawn 仓颉宿主 exe（host-bridge.cjs 走 stdio NDJSON）
  ├─ 各域 IPC handler（*-ipc.cjs，逐字段闭集校验 → withHost → bridge.request()）
  └─ 打包态路径解析（paths.cjs：只认 process.resourcesPath，缺它 fail-loud）
        │ contextBridge（preload.cjs 顶层 key＝唯一权威 IPC 面）
        ▼
renderer/（渲染进程，纯 JS + Vue runtime + h()）
  ├─ index.html + frame.css/styles.css（唯一色板真源）
  ├─ app.js（消息面）、pages/*.ts（业务页面）
  └─ vendor/（构建期折叠的第三方经典脚本，gitignore 产物）
```

### 3.2 渲染层硬约束（改前必读）

- **纯 JS + Vue runtime + `h()`**：运行时**无模块加载器、无模板编译器、无 TypeScript、无 ES module**。CSP `script-src 'self'`（禁 `unsafe-eval`），`file://` 下 ES module 会被 CORS 拦。
- **第三方组件只在构建期折叠**：esbuild 与组件库是 `apps/desktop` 的 devDependency，**产物运行时零 npm 依赖**。`npm run vendor` 依次跑 `scripts/pack-vendor.mjs`（拷 Vue runtime）、`pack-tinyvue.mjs`（TinyVue → `tinyvue.iife.js`）、`pack-tinyrobot.mjs`（Bubble 族 → `tinyrobot.iife.js`）。折叠必须把 `vue` 别名到已 vendor 的 runtime（装第二份 Vue 会破坏响应式）；产物须过反证式自检（无 `new Function`/`eval`、无残留 `import(`、无裸 `"vue"`、接 `globalThis.Vue`）。
- **消息面**经 `BubbleProvider + BubbleList`（`groupStrategy: "consecutive"`）渲染，正文由本仓自定义内容渲染器出；`role==="tool"` 默认链会交给只渲染注释节点的 ToolRole（正文会隐身），折叠阈值只在 `renderer/msgfold.js` 一处。
- **IPC 面是有限集**：唯一权威是 [`preload.cjs`](../../../apps/desktop/preload.cjs) 的 `contextBridge.exposeInMainWorld` 顶层 key（2026-10-24 门禁 **212** 条，`check_ipc_surface_parity.cjs` 双向差集为空）。**不提供“发任意方法”通道**；审批只收 `approvalId`，渲染层自报审批字符串没有通路。增删通道须同步改 `preload.cjs` 与 `test/bridge.test.mjs`。
- **打包态宿主路径**只能从 `process.resourcesPath` 解析，缺它 fail-loud，**绝不回退 asar 内路径**（[`paths.cjs`](../../../apps/desktop/paths.cjs)）。

### 3.3 设计规范（视觉/交互）

- 权威顺序：源码 + [PRD](../../product/PRD.md) / [desktop-design-standard.md](desktop-design-standard.md)（产品级品牌与布局，冻结上游口径）> [renderer/DESIGN.md](../../../apps/desktop/renderer/DESIGN.md)（渲染层原则与令牌映射）。
- 关键原则：**单一色板真源**（`renderer/styles.css` 的 `:root` 定义令牌，暗色由 `@media (prefers-color-scheme: dark)` 覆写同一组令牌，页面 CSS 只做组件覆盖）；**层级靠表面阶梯 + 发丝描边**，不靠重阴影；`--accent` 只给主 CTA/焦点环/链接；4px 基数间距；内容列限宽居中（`--chat-width`）。
- 组件基线：折叠用行级 `max-height + overflow + ::after` 渐变遮罩（**不做硬截断**）；折叠/复制为紧凑 SVG 图标按钮；滚动条 `scrollbar-width:thin` + `color-mix` 半透明 thumb；新增/编辑表单进共享 `SaCodeDialog` 弹窗。
- 已登记原始值例外（6px 半档、8px 角标、1/2/3px 微圆角、`--shiki-*` 语法调色）不改令牌化。

### 3.4 关键源文件

| 文件 | 职责 |
|---|---|
| [`main.cjs`](../../../apps/desktop/main.cjs) | 主进程：窗口、派生宿主、各域 handler 装配 |
| [`preload.cjs`](../../../apps/desktop/preload.cjs) | IPC 面唯一权威（`contextBridge` 顶层 key） |
| [`host-bridge.cjs`](../../../apps/desktop/host-bridge.cjs) | stdio NDJSON 请求配对、超时、子进程生命周期 |
| [`paths.cjs`](../../../apps/desktop/paths.cjs) | 打包态宿主路径解析（resourcesPath，无 asar 回退） |
| `*-ipc.cjs` | 逐域固定 handler（browser/database/import/terminal/voice/knowledge/security/ssh/automation…） |
| `renderer/app.js`、`renderer/pages/*.ts` | 渲染层视图与业务页面 |
| `scripts/pack-*.mjs` | CLI/宿主/Vue vendor/页面折叠打包脚本 |

## 4. 边界

**桌面端不做 / 不能做的事**：

1. **不重做业务核心**：授权、取消、结算、会话真源都在 `core`；桌面只投影与交互。渲染层只改渲染，不改 `session/append → task/start → turn/poll`、审批工单、取消与结算语义。
2. **不排除安全机制**：不绕过审批、不裸跑无沙箱执行、不为凑通过关闭隔离；不提供任意 RPC 转发。
3. **不引运行时外部依赖**：无外部字体/CDN/远程资源，不加载 ESM/模板编译器/`new Function`。
4. **不复制上游品牌**：`renderer/DESIGN.md` 只采纳原则，不复制 Linear/Vercel 品牌、商标、字体或布局。
5. **打包红线**：不提交 `apps/desktop/dist/`、`renderer/vendor/`（gitignore 产物）；不把 `target/`、日志入库。
6. **未验证即待验**：GUI 观感、安装态、真实模型任务须用户亲手复验；单测/页面通过只是局部证据，不等于版本交付（[renderer/DESIGN.md §5](../../../apps/desktop/renderer/DESIGN.md)、[AGENTS.md「最高推进优先级」](../../../AGENTS.md)）。

本机工具环境另有环境级限制：仓库根受 Low Mandatory Level 标签影响时，Electron 探针报 `0x80000003`（D10），并非产品缺陷；GUI 实机验收须在用户桌面环境执行。

## 5. 分步细节

每一步都以**真实回执/回读**为成功判据，任一结果未知时冻结发送、不自动重发。

### 步骤 1：正常双击启动

1. electron-builder 产物启动 `main.cjs`；`paths.cjs` 从 `process.resourcesPath` 解析宿主目录，缺它 fail-loud（不回退 asar）。
2. 主进程 `spawn` 宿主 exe（同目录含全部依赖 DLL），`host-bridge.cjs` 建 stdio NDJSON 通道。
3. 渲染进程加载 `renderer/index.html`（`file://` + CSP `script-src 'self'`），Vue runtime 以 `h()` 构建视图。
4. **成功判据**：窗口可交互、宿主握手成功；失败为可见错误，不静默。

### 步骤 2：配置供应商与选择模型

1. 供应商页（`provider-settings.ts`）新增/编辑表单 → 共享 `SaCodeDialog` 弹窗，填 API Key 并保存（落 `credentials.env`）。
2. 模型发现：适配器**发送前持有操作 ID** → 发起拉取 → 超时只按原 ID **查询一次**、不重发；供应商页显示操作结果/资源收束，并提供查询与取消。
3. 选定模型 → 注册表 → 设默认（修订号 CAS）。
4. **成功判据**：Key 与输入逐字节一致且不落明文日志；目录刷新**不**作本次成功回执；未知结果标“未知”不自动重试。见 [模型拉取生命周期](../../interfaces/model-pull-lifecycle-2026-10-17.md)。

### 步骤 3：打开小项目

- 项目选择器（`project-picker.ts`）→ 设定工作目录 → 会话与工作区绑定。工作区是读写落点，**worktree 隔离 ≠ OS 安全沙箱**。

### 步骤 4：AI 读取并提出文件修改

1. `session/append {eventType:"user/message", data:<正文>}` → `session/flush`（持久屏障）。
2. `task/start` → `turn/poll` 取流式帧；模型发出工具调用（read/write）。
3. 渲染层按 `resultMessageId` 关联工具结果；空窗期显示 `.msg-waiting` 等待占位（`role="status"`）。

### 步骤 5：用户审批（人在环）

1. 工具调用触发 `approval/asked`（含数字 `approvalId`、tool、`argumentsJson`）。
2. 卡片显示工单号、工具、参数摘要；`approval/answer {approvalId, decision}`，`decision ∈ {allowed-once, denied}`。
3. **凭据只能是工单号**；非 pending/过期/来源不明不可操作。权限模式四档可**在途切换**（`approval/set-mode`/`plan/set-mode` 已不被 `turn-in-flight` 硬拒）。
4. **成功判据**：工单精确消费后的回执；拒绝对应 `denied`、文件不变。

### 步骤 6：实际修改与真实差异

- 经共享授权/执行链落盘 → 差异登记（`execution/review-file`）→ 页面渲染真实前后内容。**不伪造已执行 diff**；未跟踪/截断等状态如实显示。

### 步骤 7：取消

- `turn/cancel` 返回 `cancelRequested`/`wasRunning`（**不是终态**）；最终态由后续投影确认。取消不得把用户或其他执行者后续写入一并回退。

### 步骤 8：关闭重开持久性

1. 会话日志持久（`flush` 后的已持久前缀）。
2. 关闭窗口 → 正常退出；同 session-dir 新进程**只读回放**，字节不变、未重放任务。
3. **成功判据**：消息/审批/工作区/追踪一致，`keyConfigured` 等状态正确回读（见 [GUI 闭环证据](2026-10-23-longcat-gui-key-entry.md)、[真实任务闭环](../../evidence/2026-10-23-longcat-real-task-loop.md)）。

### 验证口径

- 渲染层改动跑 `node --test`：`renderer-syntax`/`renderer-bundle-guard`/`page-sources-parse`/`renderer-el-shape` 及受影响组件测试；CSS 令牌改动核亮/暗两套 + `prefers-reduced-motion` + 三项机械核对（单一真源/可解析/对比度 ≥4.5:1）。详见 [renderer/DESIGN.md §5](../../../apps/desktop/renderer/DESIGN.md)。
- 冒烟：先生成宿主 `node scripts/pack-host.mjs …`，再 `npm run smoke` / `npm run ui-smoke`；dev 态宿主路径固定 `apps/desktop/dist/host/bin/sacode-host.exe`。
- 跳过项须写明环境原因（本机 Electron `0x80000003`），**不把跳过记为通过**。

## 6. 与其它端的差异

| 对比点 | 桌面端 | 参照端 |
|---|---|---|
| 入口面 | Electron IPC（`preload.cjs` 顶层 key，有限集） | CLI 无 IPC，走仓颉命令 + Host stdio；Web 走 BFF |
| 运行时约束 | CSP `script-src 'self'`：无 ESM/模板编译器/TS，第三方构建期折叠 | Web 浏览器可正常用 ESM + Vite；CLI 用终端字格 |
| 宿主来源 | 主进程 spawn 本地宿主 exe，DLL 同目录 | CLI 直连 Host；移动/Web 经 daemon → Host |
| 隔离载体 | worktree 修改隔离 + 执行沙箱（不混同） | 移动/Web 另有 daemon 设备身份层，桌面为本机用户 |
| 分发 | electron-builder 各平台同源包 | CLI npm 薄启动包；移动 APK；Web 服务包 |

结论：桌面端是能力最全、约束最严（CSP + IPC 有限集）的端，也是主交付端；其“主进程 → 宿主 → core”链路与 CLI 同源，与移动/Web 的“daemon → Host”链路在后端汇合于同一 `core`。