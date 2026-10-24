# CLI 端（终端入口 + Node/Ink TUI）

> 类别：**⑪ 端文档**｜上级索引：[clients/README.md](../README.md)｜四端总览见 [README §2 差异矩阵](../README.md#2-跨端差异对比矩阵)。
> 源码：[`apps/cli/`](../../../apps/cli/)（仓颉 CLI 动词）+ [`apps/cli/tui/`](../../../apps/cli/tui/)（Node/Ink 终端界面）+ [`npm/sacode-cli`](../../../npm/sacode-cli)（npm 薄启动包）。
> 设计规范：[`tui/DESIGN.md`](../../../apps/cli/tui/DESIGN.md)、[`tui/README.md`](../../../apps/cli/tui/README.md)。
> 状态口径：源码可查、TUI 有测试与本地 tarball 安装读数；真实终端观感、真实模型任务与 registry 安装态仍待验。

## 1. 用途

面向 **CLI 开发者**的终端入口，在终端执行与桌面同一类任务，**不依赖 Electron 桌面进程**。

- **定位**：独立仓颉可执行入口，也是 npm CLI 的二进制来源；同一命令面还提供 Node/Ink 的**终端交互界面（TUI）**。
- **用户**：CLI 开发者（见 [PRD §1 用户表](../../product/PRD.md)）——获得明确授权、退出结果、用量与恢复语义，不依赖桌面进程。
- **两种使用形态**：
  - **命令式**：`sacode <动词> [参数]` 一次性执行（脚本/编排友好）。
  - **TUI**：无参数且 stdin/stdout 都是 TTY，或显式 `sacode tui` 时进入交互界面；其余命令仍透传仓颉 CLI。

## 2. 需求

### 2.1 命令面（`apps/cli/src/main.cj`）

用法（`--help` 与错误 usage 已合并为同一份 `printCliUsage`，两端口一致）：

```text
usage: sacode <goal|team|job|mode|acp|worktree|batch|tips|knowledge|tools|call|--remote> [arguments]
```

| 动词 | 源文件 | 方向 |
|---|---|---|
| `goal` | `goal_runtime.cj` | 目标声明/推进 |
| `team` | `team_command.cj` | 团队会话 |
| `job` | `batch.cj` | 作业 run/propose/authorize/start/describe/list/output/review-* |
| `mode` | `approval_mode_command.cj` | 审批模式 |
| `acp` | `acp_command.cj` | 外部 Agent（ACP） |
| `worktree` | `worktree_command.cj` | 工作树隔离 |
| `batch` | `batch.cj` | 批量 |
| `tips` | `tips_surface.cj` | 提示面 |
| `knowledge` | `knowledge_command.cj` | 知识库 |
| `tools` / `call` | `main.cj` | 工具枚举 / 单工具调用（`call edit` 展示 JSON 参数契约） |
| `--remote` | `remote.cj` | 远程入口（核实动作顺序，非产品任务验收） |

口径修正（2026-10-23）：裸 `sacode goal` 不再落入自测，按用法错误返回 **64**；`sacode knowledge` 缺参走 stderr 且退出码 **2→64**；租约获取失败按 core 分类输出 `lease-busy` / `lease-owner-unknown`（5）或 `lease-io-failed`（8）。`all` 自测**不能**代替真实任务验收。

### 2.2 TUI 消费动词（`apps/cli/tui/`）

TUI 是 Host JSON-RPC 的**终端消费端，不是新接口面**。固定消费动词：`initialize`、`session/catalog`、`workspace/get`、`usage/status`、`session/projection`、`session/append`（`eventType:"user/message"`）、`task/start`、`turn/poll`、`turn/cancel`、`approval/answer`；审批通知只接 `approval/asked`，决策只发 `allowed-once`/`denied`。**不解析 CLI 文本、不新增 Host 方法、不伪造结算**。

续补消费（均未改 Host 方法面）：`session/rename`/`session/archive`、`skill/list`/`skill/get`、`mcp/list`/`mcp/status`、`approval/get-mode`/`plan/get-mode`、`workspace/files`、`workspace/git-status`/`git-diff`、`@` 文本引用（Host read→资料快照随消息持久化，**不在 Node 侧读取文件**）。

### 2.3 平台与分发

- npm 是 Windows/Linux/macOS CLI 的主要便捷安装渠道：薄启动包按平台/架构选择对应原生产物包，不依赖桌面进程（[platform-and-distribution.md §5.1](../../product/platform-and-distribution.md)）。
- 主包 `npm/sacode-cli`（包名 `@stand-alone/sacode`）；现有平台包为 `npm/sacode-cli-win32-x64`，其他平台包待实现/验证。`bin/cli.js`、`bin/daemon.js` 是入库源码；平台包二进制/DLL 为生成产物，**不入库**。
- 主包同时携带 Node/Ink TUI 单文件 `tui/index.mjs`（打包时由 `scripts/pack-tui.mjs` 构建并校验自足）；需要 **Node ≥18**。
- 鸿蒙 CLI 保留独立原生产物分发；同时提供 release 压缩包及校验和，避免强制安装 npm。

## 3. 设计

### 3.1 架构

```text
sacode（仓颉 CLI，apps/cli/src/main.cj）
  └─ 直接调用 core 共享实现（会话/执行/授权/取消/结算）
        ↑ 与 Host 同源，但作为独立可执行入口

npm bin/cli.js（薄启动器）
  ├─ 无参数且 TTY / 显式 `sacode tui` → 加载 tui/index.mjs
  └─ 其他命令 → 透传仓颉 CLI 原生产物

tui/（Node/Ink 终端界面）
  └─ host-client.mjs → spawn/连 Host，走 NDJSON JSON-RPC
```

- **构建**：单成员构建 `cd apps/cli && cjpm build`，产物 `main.exe`（约 12MB）与 **80 个 DLL** 同落 `apps/cli/target/release/bin`。构建前必须前置 DLL 目录到 PATH（`SACODE_STDX_DLL_DIR`、`SACODE_RUNTIME_DLL_DIR`），否则钩子静默不跑、bin 里 0 个 DLL 且无报错（issue #725 自研绕过，见 [AGENTS.md「环境」](../../../AGENTS.md)）。
- **运行**：剥掉 SDK/stdx PATH 后 DLL 本地自足；`env PATH="…" apps/cli/target/release/bin/main.exe --help` 打印 `usage: sacode …`。

### 3.2 TUI 关键源文件

| 文件 | 职责 |
|---|---|
| [`tui/src/index.mjs`](../../../apps/cli/tui/src/index.mjs) | TUI 入口 |
| [`tui/src/app.mjs`](../../../apps/cli/tui/src/app.mjs) | 应用骨架与布局装配 |
| [`tui/src/host-client.mjs`](../../../apps/cli/tui/src/host-client.mjs) | Host JSON-RPC 客户端（stdout 只走协议帧） |
| [`tui/src/commands.mjs`](../../../apps/cli/tui/src/commands.mjs) | `/` 命令菜单 |
| [`tui/src/markdown.mjs`](../../../apps/cli/tui/src/markdown.mjs) | 轻量 Markdown/代码着色/表格 |
| [`tui/src/transcript.mjs`](../../../apps/cli/tui/src/transcript.mjs)、[`tool-display.mjs`](../../../apps/cli/tui/src/tool-display.mjs) | 历史流与内联工具卡 |
| [`tui/src/theme.mjs`](../../../apps/cli/tui/src/theme.mjs) | token 与断点（紧凑布局） |
| [`tui/src/session-*.mjs`](../../../apps/cli/tui/src/) | 会话浏览/改名/归档与确认 |

### 3.3 终端设计规范（摘要，全文见 [tui/DESIGN.md](../../../apps/cli/tui/DESIGN.md)）

- **继承终端主题**：不改用户背景/字体/字号，正文用默认前景色；浅色终端也须可读。
- **颜色只表达语义**：cyan＝当前输入/处理中，yellow＝待审批/提示，red＝错误，green＝已完成工具；颜色不可替代状态文字。
- **字格而非像素**：横向留 1 列外边距、正文缩进 2 列、块间空 1 行；标题用粗体+位置区分，不堆 ASCII banner。
- **少框线**：顶部与工具活动用单边细线；输入框、审批、错误区才用单线边框；不增加渐变/闪烁/装饰动画。
- **布局层级**（上→下）：顶部标识与会话/模型选择 → 对话区（`› 你`/`· SaCode`） → 工具活动（最近最多 6 项） → 审批（黄色单线框，`[y]/[n]`，`d` 看完整参数） → 输入区（`/` 出命令菜单） → 状态栏（真实错误/真实 token 计量）。
- **紧凑窗口**（宽 <64 列或高 <22 行）：隐藏版本/空态示例/次要说明与计量，工具活动最多 2 项；顶部/工具/审批/输入/状态栏不被压缩，仅对话区可收缩。

### 3.4 参考与来源

交互与功能以 **Gemini CLI** 为参考基线（上游固定 `google-gemini/gemini-cli@a3dd9f8c7bcb495a46d0b505b6f179996ccd8332`，可按 Apache-2.0 合规复制/适配独立展示组件，保留版权/许可/修改说明与 NOTICE，不复制品牌、不引入 Gemini 业务引擎）。配色与低装饰另参考固定上游 Warp/Ollama（`3b605329…`），不构成像素复刻。

## 4. 边界

1. **不做新接口面**：TUI 只消费既有 Host 方法与通知，不新增 Host 方法、不解析 CLI 文本、不伪造结算。
2. **不越业务边界**：只改变渲染/交互，不改 `session/append → task/start → turn/poll`、审批工单、取消与结算契约；不触碰用户密钥、模型配置、Host 或桌面入口。
3. **投影/状态/计量来自 Host**：样例输出只作设计展示，不当真实任务证据。
4. **`all` 自测不是用户验收**：集合自测与断言通过不等于真实开发任务通过。
5. **未验证即待验**：真终端观感、真实模型审批/落盘/差异、registry 安装态组合均未验；不据源码或本地 tarball 宣称 TUI 已交付。
6. **凭据与临时区**：不提交平台包二进制、日志；一次性产物进 `target/tmp/`。

## 5. 分步细节

### 步骤 1：安装与启动

1. **npm 路径**：安装主包 → `bin/cli.js` 按平台/架构选择原生产物包 → 无参数且 TTY 或显式 `sacode tui` 时加载 `tui/index.mjs`；否则透传仓颉 CLI。
2. **直接运行**：`main.exe --help`（干净 PATH、DLL 本地自足）打印用法；错误用法返回 64。
3. **缺件行为**：缺宿主 rc=69、缺平台包透传 rc=79（本机 tarball 安装读数，非 registry 安装验收）。
4. **成功判据**：真实回执/退出码；不据“能启动”宣称为可用。

### 步骤 2：配置与模型（`/auth`、`/model`）

1. `/auth` 显示现有供应商 ID 与默认指针，逐字段校验、Shift+Tab 返回编辑、隐藏密钥跨返回保留但不重新显示。
2. 保存前重新核对修订/ID，写后核**回读**；结果未知时锁住重发并提示重新打开核对。
3. `/model` 只说明“已配置/启用绑定”，**不用保存成功或选择成功冒充连通性**；经 `task/start` 的（可选）`customModelId` 起轮，不改全局默认。
4. `/model` 不自动做 `model/list` 探测。

### 步骤 3：会话与目录（`/resume`、`/rename`、`/archive`）

1. `/resume` 按标题/ID/目录搜索，Ctrl+A 切归档视图，48×18 长标题不挤掉取消按钮，面板持有唯一输入焦点。
2. `/rename`/`/archive`/恢复归档均**默认取消**；确认前复核原修订，写后核 `saved`/`sessionId`/`revision` 与目录值。
3. 旧修订确认失效、未知写**冻结不重发**；恢复归档不自动 select；当前会话先切走才可归档。

### 步骤 4：发起任务

1. `session/append {eventType:"user/message", data:<正文>}` → `session/flush`（持久屏障）→ `task/start`。
2. `turn/poll` 取流式帧；工具结果按 `resultMessageId` 关联。
3. `@` 文本引用：确认披露正文保存/发送对象，**默认取消**；先走 Host `read` → 工具结算 → 资料快照随消息持久化 → `task/start`；缺失/截断/二进制整条拒绝；`@` 补全仍只插**路径文字**，不冒充完整附件。

### 步骤 5：审批

1. 只接 `approval/asked` 通知（含数字 `approvalId`、tool、`argumentsJson`）。
2. `[y] 允许一次 / [n] 拒绝` → `approval/answer {approvalId, decision}`，`decision ∈ {allowed-once, denied}`。
3. `d` 把对话区切换成完整参数视图（初始从参数开头、PageUp/PageDown 翻页，控制字节可见转义、不执行 ANSI）；**参数摘要来自请求、非磁盘差异**，不伪造已执行 diff、不改 `approvalId`/decision 票据。
4. 不新增审批模式或默认放行；短屏优先保留工单、y/n 与取消，默认拒绝。

### 步骤 6：取消与结算

- `Ctrl+C`：有输入先清空，运行中触发取消。`turn/cancel` 返回 `cancelRequested`/`wasRunning`（**非终态**）；结算以来自分派/host 的真实回执为准，状态栏不虚构模型/连接/耗时。

### 步骤 7：工作区只读（`@`、`/diff`）

- `@` 打开 Host 工作区路径菜单（只浏览目录名称，不 `attachment/upload`）；`/diff` 消费 Host `workspace/git-status`、`workspace/git-diff`（bind 会话/目录/路径/范围）。Git 差异错误与未跟踪状态**不伪装空修改**，不把用户原有修改归因给 AI。

### 验证口径

- TUI：`cd apps/cli/tui && node --test`（各批读数如 36/36、52/52、63/63、73/73、99/99 为当时局部回归）；伪 TTY 烟测 + 打包自足校验。
- 仓颉 CLI：`cd apps/cli && cjpm build` 后跑 `--help`；`main.exe all` 仅为集合自测。
- 跳过/失败项须写明原因，**不凑通过**。

## 6. 与其它端的差异

| 对比点 | CLI 端 | 参照端 |
|---|---|---|
| 交互形态 | 终端字格（命令式 + Ink TUI） | 桌面/移动/Web 为图形界面 |
| 入口面 | 无自建 IPC：仓颉命令 + Host stdio（TUI 消费 Host JSON-RPC） | 桌面 Electron IPC；Web BFF |
| 运行时 | 仓颉原生 + Node ≥18（TUI） | 桌面受 CSP 无 ESM；Web 浏览器 ESM |
| 宿主来源 | 进程内仓颉 CLI 直连 core；TUI spawn/连 Host | 桌面主进程 spawn 宿主；移动/Web 经 daemon |
| 分发 | npm 薄启动包 + release 压缩包 | 桌面 electron-builder；移动 APK；Web 服务包 |

结论：CLI 端与桌面端同源（都直连同一 `core`/Host），是“双入口”的另一半；差异主要在交互形态与分发渠道，而非业务语义。