# SaCode PRD

## 1. 文档信息

- 产品名称：SaCode
- 文档版本：v1.1
- 更新时间：2026-06-05
- 文档类型：产品需求文档（PRD）
- 产品定位：终端优先的 AI 编程助手与可扩展运行时平台

## 2. 产品愿景

SaCode 面向重度终端开发者，提供从代码分析、任务规划、工具执行到结果审查的完整闭环。它以 CLI 为主入口，以 TUI、REPL、Daemon 和协议接口为延伸，把 AI 编程能力融入现有工程工作流。

SaCode 的长期目标有三项：

1. 成为终端环境中的默认 AI 编程入口。
2. 建立统一的执行运行时，支撑 CLI、TUI、Daemon、HTTP API 和后续 IDE 集成。
3. 在多 Agent 编排、模型智能路由、结构化记忆和可审计执行上形成差异化能力。

## 3. 目标用户

### 3.1 核心用户

1. 重度使用终端的后端工程师
2. 依赖 Git、Shell、CLI 完成主要开发任务的全栈工程师
3. 需要在本地、远程、容器和 CI 中复用同一套 AI 工作流的开发者

### 3.2 扩展用户

1. 需要集成 AI 编程能力的平台团队
2. 需要通过 Daemon、HTTP API、ACP/LSP 接入 SaCode 的工具开发者

## 4. 核心问题

当前同类 AI 编程工具普遍存在以下问题：

1. 终端工作流支持弱，管道、脚本、Git、Shell 协同体验不连续。
2. 工作区理解能力不稳定，常缺少代码库感知与上下文裁剪。
3. 自动执行可解释性不足，写文件、跑命令、调用工具的风险边界不清晰。
4. 工具与插件扩展能力割裂，难以形成统一能力模型。
5. 多模型与多角色配置成本高，跨场景切换体验不统一。

## 5. 产品原则

1. 终端优先
2. 工作区感知优先
3. 所有副作用可审计
4. 所有长任务可暂停、可恢复、可取消
5. 默认小步执行
6. 统一能力协议优先于零散特性堆叠

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
2. 用户可以根据风险等级在 `plan`、`build`、`yolo` 之间切换。
3. 用户可以在不同 provider、不同模型、不同成本档位之间切换。
4. 用户可以在 CLI、TUI、REPL 和后续 Daemon 接口中共享核心能力。

### 7.2 平台目标

1. 建立统一的任务运行时和状态机。
2. 建立统一的事件流、结构化输出和持久化模型。
3. 建立统一的工具、插件、权限与沙箱能力模型。

### 7.3 范围边界

1. 当前阶段聚焦终端与开发工作流，不承担完整 IDE 替代目标。
2. 当前阶段聚焦 CLI / TUI / REPL / Daemon，不提供桌面 GUI。
3. 当前阶段优先闭环高频编程任务，不追求一次性覆盖所有语言智能编辑能力。

## 8. 当前产品现状

截至 `0.1.23`，SaCode 已具备以下基础能力：

1. Rust workspace 三层架构：`interfaces/* -> runtime -> kernel`
2. CLI、TUI、REPL 主入口
3. 多角色编排与结构化总结输出
4. 模型智能路由与 profile 配置
5. 项目级记忆、wiki、checkpoint、队列与 daemon 雏形
6. MCP、ACP、LSP 等扩展入口

当前仍影响 1.0 体验闭环的关键缺口包括：

1. SSE/实时流式输出仍在补齐
2. 持久化任务存储刚进入落地阶段，统一运行时仍需继续收口
3. 精确编辑能力仍缺 `apply_patch / diff_edit`
4. Git 提交闭环、测试运行器、AST/符号级智能尚未完备

## 9. 核心能力范围

### 9.1 当前必须稳定的能力

1. `sacode` CLI 主入口
2. Ghost / Chat / Agent 三类使用方式
3. `plan` / `build` / `yolo` 模式切换
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

### 10.3 YOLO 模式

在既定权限策略下自动执行，适用于低风险、可重复、可脚本化任务。

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

## 14. 当前版本路线优先级

### 14.1 P0：核心体验闭环

这是当前版本最优先交付的能力：

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

1. 统一运行时收口过程中，旧入口与新入口的兼容成本需要持续控制。
2. AST 编辑、符号索引和多语言支持的投入需分阶段验证收益。
3. Daemon、HTTP API 与权限模型的统一设计需要避免重复实现第二套状态机。
4. TUI 复杂度增长较快，需要持续控制交互与渲染复杂度。

## 18. 结论

SaCode 当前的产品策略应聚焦两条主线：

1. 先补齐终端主回路，让 CLI / TUI / REPL 达到稳定、可持续使用的完成态。
2. 再以统一运行时为底座，向 Sub-agents、Daemon、HTTP API、Agent Teams 和生态集成逐层扩展。

这条路线能同时保证短期体验提升和长期平台演进空间。

## 19. 相关文档

- [产品路线图](roadmap.md) — 版本阶段与交付计划
- [功能升级方案](../plans/capability-upgrade-plan.md) — 基于竞品对比的能力补齐
- [架构说明](../reference/architecture.md) — 分层与执行链路
- [开发指南](../reference/development.md) — 本地开发与贡献
