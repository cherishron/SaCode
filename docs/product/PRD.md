# SaCode PRD

## 1. 文档信息

- 产品名称：SaCode
- 文档版本：v1.7
- 更新时间：2026-09-22
- 文档类型：产品需求文档（PRD）
- 产品定位：面向国内开发者的终端 AI 编程工具
- 核心叙事：**Claude Code 的体验，国内模型原生适配，企业级可审计。**

> 定位调整说明（v1.2→v1.3）：基于《SaCode 可行性评估报告》（docs/report.md）四维评估，明确产品为"面向国内开发者的终端 AI 编程工具"，平台化是结果不是起点。配套规划方案见 `docs/report-plan.md`。MulanPSL-2.0 协议、国内搜索引擎适配、国产模型兼容已体现这一定位。
>
> 客户端化决策（v1.5）：在 CLI/TUI 主线稳定、VSCode 与 daemon 审批闭环完成后，新增独立 Desktop 与可插拔 Agent Backend。该决策只扩展支撑客户端和 ACP Agent 接入所需的 daemon/ACP 能力，不恢复 Scheduled Tasks、Agent Teams、Channels 等已延后平台功能。专项真源见 [Desktop 与多 Agent 客户端 PRD](desktop-multi-agent-prd.md)。
>
> 阶段顺序修订（v1.6）：当前工作继续聚焦 **Desktop 本地闭环与发布收口**。SaCode 与手机端的 LAN、远程 daemon、跨设备控制及签名中继均不与 Desktop 并行实施；现阶段只保留 Task Protocol、HTTP/SSE、审批和恢复等可复用协议接缝。只有 Desktop 达到本 PRD 第 7.4 节的退出门禁后，才评审是否进入手机通信阶段。
>
> 仓库审查修订（v1.7）：以 `dev@9d8f9f8` 及 2026-09-22 的本地验证为基线，区分“正式发布基线”“已提交开发能力”“未提交工作区实现”和“规划能力”。Desktop Tauri sidecar、四面板 UI、client-core、OpenCode ACP Backend 已进入代码库，但首个 Desktop 正式版本仍为**部分验收**；未通过真实端到端、跨平台打包、进程清理和发布一致性门禁前，不得写成已发布或已验收。

## 2. 产品愿景

SaCode 面向国内重度终端开发者，提供从代码分析、任务规划、工具执行到结果审查的完整闭环。它以 CLI 为主入口，以 TUI、REPL 为延伸，把 AI 编程能力融入现有工程工作流，并提供 IDE 集成能力。

国内开发者的核心痛点不是"终端 AI 编程工具不够好"，而是"Claude Code / Codex CLI 需要科学上网，国内模型适配差"。SaCode 的差异化定位：

1. **Claude Code 的体验** — 终端原生、多 Agent 编排、三级执行模式
2. **国内模型原生适配** — DeepSeek、通义千问、智谱 GLM 等 provider 零配置接入，国内搜索引擎适配
3. **企业级可审计** — 三级执行模式（plan/build/auto）+ 沙箱审计日志（audit.log）+ checkpoint 恢复

长期目标：

1. 成为国内终端环境中的默认 AI 编程入口。
2. 以统一执行运行时支撑 CLI、TUI、VSCode 和独立 Desktop，平台化是结果不是起点。
3. 在三级执行模式、沙箱审计、学习型记忆上形成差异化能力。


### 平台化收敛声明（v1.5 修订）

依据《SaCode 改进规划方案》（report-plan.md）步骤 3，通用平台化能力仍保持收敛，但允许为正式客户端和外部 Agent 互操作做定向扩展：

1. **ACP**：保留 SaCode ACP Server；新增通用 ACP Client，仅用于受控接入 OpenCode 等 Agent。
2. **LSP**：维持现状，不新增功能。
3. **Daemon**：保留现有 HTTP/SSE 主协议，并仅扩展 Agent Backend、sidecar 认证和客户端恢复所需端点。
4. **客户端**：CLI/TUI 继续是核心入口；VSCode 与 Tauri Desktop 共用 client-core。
5. Scheduled Tasks / Agent Teams / Channels 继续延后，不因本次客户端化恢复。
6. **移动端通信延后**：不在当前 Desktop 阶段实现手机配对、LAN 直连、远程 daemon、跨设备会话或签名中继；只保证桌面端使用的协议具备后续复用可能，不提前为手机端扩张范围。

平台化仍是结果不是起点；本次扩展的验收目标是桌面用户能安全完成 SaCode/OpenCode 编程任务，而不是建设通用 Agent 云平台或跨设备控制平台。

## 3. 目标用户

### 3.1 核心用户

1. 重度使用终端的国内后端工程师（Rust、Go、Python）
2. 依赖 Git、Shell、CLI 完成主要开发任务的全栈工程师
3. 希望使用国产模型（DeepSeek/Qwen/GLM）获得 Claude Code 级体验的开发者
4. 需要在本地、远程、容器和 CI 中复用同一套 AI 工作流的开发者

### 3.2 扩展用户

1. 需要 AI 编程工具具备企业可审计能力的技术团队
2. 需要集成 AI 编程能力的平台团队（通过 Daemon、HTTP API）

## 4. 核心问题

当前同类 AI 编程工具普遍存在以下问题：

1. 终端工作流支持弱，管道、脚本、Git、Shell 协同体验不连续。
2. 工作区理解能力不稳定，常缺少代码库感知与上下文裁剪。
3. 自动执行可解释性不足，写文件、跑命令、调用工具的风险边界不清晰。
4. 工具与插件扩展能力割裂，难以形成统一能力模型。
5. 多模型与多角色配置成本高，跨场景切换体验不统一。

## 5. 产品原则

> 基于评估报告审查，原 v1.1 部分原则存在自我设限或定义模糊，已调整。

1. **终端原生，多面延伸** — 终端体验做到最好，但不排斥 IDE 集成（VSCode 扩展是 P1 优先级）
2. 工作区感知优先
3. **所有副作用可审计** — `audit.log` 是企业采用 AI 编程工具的决策因子，强化为差异化资产
4. **所有长任务可暂停、可恢复、可取消** — checkpoint + SQLite 持久化是产品卖点
5. **默认可审计**（原"默认小步执行"）— 步长由模式和用户配置决定，而非限制步长
6. 统一能力协议优先于零散特性堆叠（但避免"为了统一而统一"，用户只关心功能好不好用）

## 5.1 架构约束保留

- `kernel` 纯逻辑层禁止 I/O — 标准分层架构实践，保证可测试性
- 灵枢三子系统：
  - 角色驱动编排 — 有实际价值，保留
  - 冲突检测 — **简化为审批流 + 危险命令拦截**（原五维矩阵过度设计，详见步骤 4.3）
  - 故障转移路由 — **降级为 provider 配置项**（非独立子系统，详见步骤 4.3）
- Loop 自治交付 — **轻量化为 /goal <完成条件>**（原四层状态机过重，对齐 Claude Code，详见步骤 4.1）
- 项目知识系统 — **9 文件分类合并为 3 文件**（project.md / experience.md / preferences.md，详见步骤 4.2）
- AutoLearner — **保留 mistakes → candidate → 人工审核闭环**，BM25 索引 + 衰减机制延后到知识量超 100 条再引入（详见步骤 4.4）

## 5.2 命名调整

- `yolo` 模式已重命名为 `auto`（内部变体名保留 `Yolo`，serde 序列化 `auto`、反序列化兼容旧值 `yolo`，详见步骤 4.5）

## 6. 核心场景

### 6.1 Ghost 模式

适合脚本、管道和自动化流程。

```bash
cat main.rs | sacode "找 bug" --json
git diff | sacode "生成提交信息" | git commit -F -
```

### 6.2 Chat 模式

适合日常交互式开发。

```bash
sacode
>>> /mode plan
>>> 分析当前仓库里最值得优先修复的问题
```

### 6.3 Agent 模式

适合多步骤复杂任务。

```bash
sacode "重构用户认证模块并补齐测试" --mode build
```

## 7. 产品目标

### 7.1 用户目标

1. 用户可以直接在终端中分析代码、生成计划、修改文件、执行命令。
2. 用户可以根据风险等级在 `plan`、`build`、`auto`（旧名 `yolo` 仍兼容）之间切换。
3. 用户可以在不同 provider、不同模型、不同成本档位之间切换。
4. 用户可以在 CLI、TUI、REPL 和后续 Daemon 接口中共享核心能力。

### 7.2 平台目标

1. 建立统一的任务运行时和状态机。
2. 建立统一的事件流、结构化输出和持久化模型。
3. 建立统一的工具、插件、权限与沙箱能力模型。

### 7.3 范围边界

1. 当前阶段聚焦开发工作流，不承担完整 IDE 替代目标。
2. VSCode 扩展和 Desktop 是同一运行时的客户端，不实现第二套 Agent 执行引擎。
3. Desktop 提供独立 GUI，但首版不内置完整代码编辑器，以会话、工具、审批和 Diff 为核心。
4. 当前阶段优先闭环高频编程任务，不追求一次性覆盖所有语言智能编辑能力。
5. **定向平台扩展** — 只建设 Desktop、多客户端共享层和 ACP Agent 接入所需能力；Scheduled Tasks / Agent Teams / Channels 继续延后。
6. **当前不做手机端通信** — 手机绑定、扫码配对、LAN 直连、远程 daemon、跨设备控制和 Redis/其他中继不属于当前交付；不得以“协议已有”标记为手机通信已完成。

### 7.4 当前阶段与退出门禁

当前唯一实施主线是 **Desktop 本地客户端**，按以下顺序循序推进：

1. **桌面本地闭环**：Desktop 通过本机 loopback sidecar 完成工作区打开、会话、任务流式、工具卡、审批、取消、结果与恢复。
2. **多 Agent 收口**：SaCode 与 OpenCode Backend 共用 Task Protocol、审批、失败和审计语义，不在客户端形成第二套运行时。
3. **桌面发布收口**：完成 Windows/macOS/Linux 构建与安装门禁、OS keyring、日志脱敏、sidecar 进程清理和真实端到端回归。
4. **阶段评审**：Desktop 退出门禁通过后，才决定下一阶段是否启动 SaApp/手机通信专项；启动时须另立 PRD/计划，不直接把远程能力追加进当前 Desktop 范围。

Desktop 阶段退出门禁：

- Desktop → sidecar → SaCode 原生 Backend 端到端通过；
- Desktop → OpenCode ACP Backend 的真实版本 smoke 通过；
- 会话、SSE 重连、审批恢复、取消、失败分类和 Diff 展示完成验收；
- 长期账号/模型凭据仅进入 OS keyring；临时 daemon token 仅由 Rust sidecar 内存持有，WebView、日志和 ready-file 均不泄露 token；
- 安装包、版本一致性和子进程清理门禁通过；
- 主 PRD、专项 PRD、实施计划和进度文档状态一致。

在上述门禁通过前，手机端工作仅允许进行不影响 Desktop 交付的文档澄清和协议兼容性检查，不进入实现、联调或发布门禁。

## 8. 当前产品现状

### 8.1 审查口径

本节以 2026-09-22 仓库审查为准，使用以下四层证据：

1. **正式发布基线**：Git tag、兼容矩阵和发布工作流共同证明的版本；
2. **已提交开发能力**：已进入 `dev`，可由代码、测试或可重复 smoke 证明，但未必进入正式发行物；
3. **未提交工作区实现**：仅说明正在开发，不计入产品验收和发布声明；
4. **规划能力**：仅有 PRD、计划或接口草案，不得写成已实现。

正式产品基线截至 `1.1.1`；本次开发树审查基线为 `dev@9d8f9f8`。审查时工作区存在 CLI/TUI、identity 和脚本未提交修改；这些修改只用于检查当前树能否编译，不纳入下表“已提交能力”的验收证据。

### 8.2 当前版本矩阵

| 组件 | 仓库版本 | 当前判断 | 说明 |
|---|---:|---|---|
| Rust workspace / CLI / daemon | `1.1.1` | 部分验收 | `v1.1.1` 为正式基线；`dev` 已包含 Task Protocol、Agent Backend、identity 与 Desktop 支撑的后续提交 |
| VSCode 扩展 | `0.2.1` | 部分验收 | 最低 daemon `1.1.1`，Task Protocol `1`；已迁移复用 client-core，正式商店分发仍不在本期 |
| `@cherishron/sacode-client-core` | `0.1.0` | 部分验收 | HTTP、SSE、Task Protocol、approval、Agent 类型已被 Desktop 与 VSCode 使用，尚未形成独立正式发布承诺 |
| Tauri Desktop | `0.1.0` | 部分验收 | Tauri shell、loopback sidecar、IPC 代理和四面板 UI 已提交；安装包与跨平台发布门禁未通过 |
| Task Protocol | `1` | 部分验收 | daemon、client-core、VSCode 和 Desktop 已使用；跨 Backend 全链路一致性仍待验收 |

### 8.3 能力状态矩阵

| 能力 | 状态 | 已有证据 | 仍需完成 |
|---|---|---|---|
| CLI/TUI/REPL 核心编程闭环 | 部分验收 | 统一 Rust workspace、provider/model、工具、审批、审计、checkpoint、队列和 daemon 已存在 | 当前脏工作区的产品路径改动须独立提交并补回归；四类核心场景仍需统一端到端证据 |
| VSCode 客户端 | 部分验收 | 任务、SSE 重连、审批恢复、Diff 审批、兼容门禁；本次 compile 与 32 项测试通过 | 与 Desktop/CLI 的真实跨入口一致性及正式发行回归 |
| client-core 共享层 | 部分验收 | Desktop 与 VSCode 均直接复用；本次 typecheck、build 与 7 项测试通过 | 增强契约 fixture、发布策略和多客户端版本兼容证据 |
| Desktop 本地 MVP | 部分验收 | Tauri sidecar、动态端口、Rust 内存 token、IPC/SSE bridge、任务/审批/取消、工具卡、简易 Diff、四面板 UI；本次 typecheck、build、6 项前端测试和 3 项 Rust 测试通过 | Desktop→sidecar→SaCode 真实 E2E、持久会话恢复、规范 Diff 数据源、安装包、跨平台进程树清理和独立 CI |
| OpenCode ACP Backend | 部分验收 | ACP stdio client、Backend registry、事件投影、失败分类已提交；仓库记录 OpenCode `1.18.31` 的 `PONG` smoke | 权限请求到 daemon 审批的真实闭环、cancel 先协议后杀进程、probe/restart 管理 API、兼容矩阵和正式版本 smoke |
| I3 统一身份客户端 | 部分验收 | 已提交 OIDC/PKCE、secret store、网关换钥与模型同步，并有本机联调记录 | 当前未提交的 headless/device/TUI 增量不计入验收；仍需在独立提交和目标环境中回归 |
| 手机端通信与远程 daemon | 延后 | 仅保留可复用协议接缝 | Desktop 退出门禁通过后另立专项；SaApp 不属于本仓库本期实施 |
| Scheduled Tasks / Agent Teams / Channels | 延后 | 无本期实现承诺 | 平台化收敛后重新评审 |

### 8.4 本次验证结果与边界

2026-09-22 在当前工作区执行：

- `cargo check --workspace`：通过；
- `cargo test -p sacode-desktop`：3 项通过；
- client-core：typecheck、build、7 项测试通过；
- Desktop：typecheck、Vite build、6 项测试通过；
- VSCode：compile、32 项测试通过；
- `cargo test --workspace --lib --bins --tests`：编译阶段因 E 盘空间不足（`os error 112`）中止，不能据此判定代码测试失败，也不能据此宣称 Rust 全量测试通过。

当前正式版本仍为 CLI/daemon `1.1.1` 与 VSCode `0.2.1`。Desktop、client-core 与 OpenCode Backend 属于已提交开发能力；只有第 7.4 节门禁全部通过后，Desktop 才可升级为“已验收”。`docs/product/status.json`、`docs/PROGRESS.md`、实施计划和专项 PRD 仍需在发布收口任务中同步，陈旧状态不得反向覆盖代码与测试事实。

## 9. 核心能力范围

### 9.1 当前必须稳定的能力

1. `sacode` CLI 主入口
2. Ghost / Chat / Agent 三类使用方式
3. `plan` / `build` / `auto` 模式切换
4. 工作区扫描、文件读取、搜索、Shell 执行、Git diff 等核心工具
5. 统一事件流与结构化结果输出
6. 审批流基础能力
7. Profile 与 provider/model 配置

### 9.2 阶段增强能力

1. 多 Agent 协同
2. TUI 多面板任务可视化
3. Daemon + HTTP API + SSE
4. WASM 插件系统
5. SDK / FFI
6. 更强的沙箱与权限隔离

## 10. 核心交互模式

### 10.1 Plan 模式

仅生成计划，输出结构化执行方案。适用于需求拆解、方案评审、改动预演。

### 10.2 Build 模式

生成计划并执行，在高风险节点请求审批。典型审批点包括写文件、执行命令、调用外部工具、批量改动。

### 10.3 Auto 模式

在既定权限策略下自动执行，适用于低风险、可重复、可脚本化任务。

旧输入值 `yolo` 仅用于兼容已有配置和命令，面向用户的输出统一使用 `auto`。

## 11. 能力模型

### 11.1 ToolSpec

统一描述内置工具、插件和未来外部能力，至少包含：

1. `name`
2. `description`
3. `input_schema`
4. `output_schema`
5. `side_effect_level`
6. `approval_required`
7. `timeout_ms`
8. `tags`

### 11.2 Event

CLI、TUI、Daemon 和未来 SDK 共享统一事件模型。当前与规划中应覆盖：

1. `message`
2. `thinking`
3. `plan_generated`
4. `tool_call_started`
5. `tool_call_finished`
6. `approval_requested`
7. `approval_resolved`
8. `command_output`
9. `file_changed`
10. `done`
11. `error`

### 11.3 ExecutionContext

执行上下文至少包括：

1. `cwd`
2. `mode`
3. `profile`
4. `approval_policy`
5. `token_budget`
6. `available_tools`
7. `session_id`

### 11.4 持久化对象

统一运行时应逐步收敛到以下真源对象：

1. `SessionRun`
2. `TaskRun`
3. `WorkerRun`
4. `EventLog`
5. `SummarySnapshot`
6. `RouteSnapshot`
7. `ConflictSnapshot`

## 12. 架构要求

### 12.1 分层架构

1. `kernel`：纯数据结构、状态模型、结构化输出
2. `runtime`：统一任务运行时、工具、沙箱、队列、流式、daemon、memory/wiki
3. `interfaces`：CLI、TUI、REPL、ACP、LSP 等交互与协议适配层

### 12.2 架构原则

1. 所有入口共享同一套任务生命周期与状态语义。
2. 所有副作用由 `runtime` 承载。
3. 所有结构化结果以 `kernel` 数据模型为真源。
4. 文本展示与界面状态属于 `interfaces`，不反向污染核心模型。

## 13. 技术与工程约束

1. 语言：Rust
2. 异步：Tokio
3. Web / Daemon：Axum
4. TUI：Ratatui + Crossterm
5. REPL：Rustyline
6. 存储：SQLite
7. 插件：Extism
8. 配置：Serde + Figment

工程约束：

1. 所有长任务必须可取消。
2. 所有副作用必须带超时。
3. 所有工具调用必须结构化记录输入、输出和状态。
4. 优先保证稳定性、可解释性和跨入口一致性。

## 14. 历史版本路线优先级

### 14.1 P0：核心体验闭环

以下为历史版本阶段的交付优先级，不作为 1.1.1 之后的当前任务清单：

1. SSE / 实时流式输出
2. 持久化任务存储
3. `apply_patch` / `diff_edit`
4. Git 提交闭环工具

目标：让 SaCode 具备“可持续执行、可实时反馈、可精确修改、可形成提交”的完整主回路。

### 14.2 P1：统一运行时与平台底座

1. 统一任务运行时与状态机
2. 统一 CLI / TUI / daemon 的任务模型
3. Sub-agents
4. Daemon + HTTP API

### 14.3 P2：代码智能深度

1. AST 解析与语义级编辑
2. 符号索引
3. LSP 诊断集成
4. 测试运行器 `test.run`

### 14.4 P3：生态与协作

1. MCP stdio
2. 插件发现与分发
3. Agent Teams
4. Channels
5. IDE 插件

## 15. 里程碑规划

### v0.3

交付核心体验闭环：流式输出、持久化任务、精确编辑、Git 提交。

### v0.5

交付代码智能深度：AST、符号索引、测试运行器、LSP 诊断。

### v0.7

交付生态与集成：MCP stdio、插件发现、检查点增强、IDE 客户端接入。

### v1.0+

交付产品就绪能力：自动修复闭环、多模态、Agent 协作协议、学习型记忆。

### 当前里程碑：Desktop 0.1 正式验收

按以下顺序收口，不并行扩张到手机通信或通用平台能力：

1. **P0 本地真实闭环**：完成 Desktop→sidecar→SaCode 的工作区、任务、SSE、审批、取消、结果、恢复与 Diff E2E；
2. **P0 外部 Backend 对齐**：完成目标 OpenCode 版本的 probe、prompt、权限审批、cancel、失败和审计 smoke，明确实验性兼容矩阵；
3. **P0 发布工程**：新增 Desktop/client-core 独立 CI，完成 Windows/macOS/Linux 构建、安装包内容、版本一致性和子进程树清理验证；
4. **P1 协议补口**：仅实现首版确需的 Agent 探测/重启和持久会话查询，不为远程控制提前扩张 daemon；
5. **P1 文档收口**：同步主 PRD、专项 PRD、实施计划、`status.json`、`PROGRESS.md` 和发布说明。

里程碑完成标准沿用第 7.4 节退出门禁，任何单项代码落地都不能替代整体验收。

## 16. 成功指标

### 16.1 产品指标

1. 用户能在终端中完成从分析到执行的完整闭环。
2. 用户能清楚理解当前模式、计划、执行状态和风险边界。
3. 用户能将 SaCode 稳定接入脚本、管道和自动化流程。

### 16.2 工程指标

1. 关键路径冷启动与反馈延迟可接受。
2. 常见工具调用具备稳定超时与错误处理。
3. 事件流与状态模型可在 CLI、TUI、Daemon、后续 SDK 中复用。
4. 文档结构、产品路线与当前代码现状保持一致。

## 17. 风险与待确认事项

1. **发布基线漂移**：`dev` 已明显领先 `v1.1.1`，必须区分已提交代码、正式发行物和本地未提交增量，避免错误对外承诺。
2. **外部 Agent 安全语义未闭环**：OpenCode 事件映射已存在，但权限请求响应、审批恢复、cancel 协议与强制杀进程的顺序仍需真实联调。
3. **Desktop 发布工程不足**：当前通用 Rust/VSCode workflow 未覆盖 Desktop 安装包、跨平台 sidecar 和进程树清理。
4. **会话与 Diff 语义偏 UI 原型**：当前会话列表主要来自前端内存时间线，Diff 依赖事件 detail 解析，尚未等价于持久 session 与规范变更模型。
5. **文档状态漂移**：`status.json` 与 `PROGRESS.md` 仍含“待 Tauri sidecar”等陈旧描述，发布前必须与代码和专项 PRD 对齐。
6. **验证环境容量**：本次 Rust 全量测试被磁盘空间阻断；发布门禁必须在资源充足的干净环境重新执行，不得复用本次部分结果冒充全量通过。
7. 统一运行时收口过程中，旧入口与新入口的兼容成本需要持续控制。
8. AST 编辑、符号索引和多语言支持的投入需分阶段验证收益。
9. TUI 复杂度增长较快，需要持续控制交互与渲染复杂度。

## 18. 结论

SaCode 当前的产品策略基于《可行性评估报告》（docs/report.md）调整后聚焦三条主线：

1. **先让用户能用起来**（最高 ROI）：
   - IDE 插件（VSCode 扩展，P1）
   - 国内 provider 零配置接入（DeepSeek/Qwen/GLM，P0）
   - 首次使用体验优化（配置 ≤2 步，P0）
2. **强化差异化**：
   - 三级执行模式（plan/build/auto）+ 沙箱审计 + checkpoint 恢复作为企业决策因子
3. **控制平台化范围**：
   - 当前先完成 Desktop 本地闭环、多客户端共享层和 ACP Agent Backend
   - 手机端通信、远程 daemon、跨设备控制和签名中继待 Desktop 退出门禁通过后再单独立项
   - Scheduled Tasks / Agent Teams / Channels 继续延后
   - OpenCode 等外部 Agent 必须进入统一审批、审计与事件模型

专项方案见 [Desktop 与多 Agent 客户端 PRD](desktop-multi-agent-prd.md)，详细实施见 [Desktop 与多 Agent 客户端实施计划](../plans/desktop-multi-agent-implementation-plan.md)。

## 19. 相关文档

- [Desktop 与多 Agent 客户端 PRD](desktop-multi-agent-prd.md) — 桌面端、Agent Backend 与 OpenCode ACP 接入专项真源
- [Desktop 与多 Agent 客户端实施计划](../plans/desktop-multi-agent-implementation-plan.md) — 目录调整、版本切片、任务依赖和发布门禁
- [可行性评估报告](../report.md) — 四维评估（竞争差距/规则审查/方向/UI）
- [改进规划方案](../report-plan.md) — 基于评估报告的 12 周实施方案
- [产品路线图](roadmap.md) — 版本阶段与交付计划
- [功能升级方案](../plans/capability-upgrade-plan.md) — 基于竞品对比的能力补齐
- [架构说明](../reference/architecture.md) — 分层与执行链路
- [开发指南](../reference/development.md) — 本地开发与贡献
