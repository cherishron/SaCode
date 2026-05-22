# SaCode PRD

## 1. 文档信息

- 产品名称：SaCode
- 文档版本：v1.0
- 文档类型：产品需求文档（PRD）
- 产品定位：AI 编程工具
- 产品目标：像 `grep` 一样快，像 `docker` 一样稳，比 Cursor 更懂终端
- 设计哲学：隐形的复杂性，可见的简洁

## 2. 产品愿景

SaCode 是一个面向终端开发者的 AI 编程工具。它以 CLI 为核心入口，结合工作区感知、工具调用、执行审批和多模式交互，为开发者提供从分析、规划到执行的完整编程辅助能力。

SaCode 的核心价值有三点：

1. 深度融入终端工作流，成为开发者现有命令链路的一部分。
2. 具备真实的代码库理解与工具执行能力，覆盖分析、规划和执行闭环。
3. 在自动化和可控性之间提供明确的模式切换，适配不同风险等级的任务。

## 3. 目标用户

### 3.1 核心用户

1. 重度使用终端的后端工程师
2. 使用 Git、Shell、CLI 工具完成主要开发任务的全栈工程师
3. 需要在本地、远程、容器和 CI 环境中复用同一套 AI 工作流的开发者

### 3.2 次级用户

1. 需要以 API 或 SDK 集成 AI 编程能力的平台团队
2. 希望通过 Daemon 模式对编辑器、IDE 或自动化系统提供能力的工具开发者

## 4. 核心问题

当前 AI 编程工具存在以下共性问题：

1. 终端工作流支持弱，管道、脚本、Git、Shell 协同体验差。
2. 代码库上下文获取不稳定，常常缺少工作区感知能力。
3. 自动执行能力不透明，开发者难以信任写文件、跑命令等副作用操作。
4. 工具系统封闭，扩展成本高。
5. 多模型、多场景切换成本高，缺少统一配置与角色分工能力。

## 5. 产品目标

### 5.1 业务目标

1. 构建一个终端优先的 AI 编程入口。
2. 提供可从 CLI 逐步扩展到 Daemon、SDK 和插件生态的平台底座。
3. 在代码分析、任务规划、工具执行和审批控制四个环节建立差异化能力。

### 5.2 用户目标

1. 用户可以直接在终端里调用 SaCode 分析代码、生成计划、修改文件和执行命令。
2. 用户可以根据任务风险选择 Plan、Build、YOLO 三种模式。
3. 用户可以在不同成本档位、本地模型和云模型之间切换配置。
4. 用户可以通过统一工具协议接入内置工具和外部插件。

### 5.3 首版范围边界

1. 首版聚焦终端工作流，不承担完整 IDE 替代目标。
2. 首版聚焦 CLI 和 TUI，不包含完整桌面图形界面。
3. 首版聚焦高频语言和核心场景，不覆盖所有语言的 AST 编辑。
4. 首版聚焦插件协议与加载能力，不包含完整插件市场和远程分发体系。

## 6. 使用场景

### 6.1 Ghost 模式

适用于脚本、管道和自动化流程。

示例：

```bash
cat main.rs | sacode "找 bug" --json
git diff | sacode "生成提交信息" | git commit -F -
```

### 6.2 Chat 模式

适用于日常交互式开发。

示例：

```bash
sacode
>>> /mode plan
>>> 分析当前仓库里最值得优先修复的问题
```

### 6.3 Agent 模式

适用于多步骤复杂任务。

示例：

```bash
sacode "重构用户认证模块并补齐测试" --mode build
```

## 7. 产品原则

1. 默认终端优先。
2. 默认工作区感知。
3. 默认可审计。
4. 默认可暂停、可恢复、可审批。
5. 默认小步执行。
6. 默认扩展能力通过统一协议接入。

## 8. 功能范围

### 8.1 首发必须具备

1. CLI 主入口 `sacode`
2. Ghost 模式
3. Chat 模式基础版
4. Plan / Build / YOLO 模式切换
5. 基础工作区扫描
6. 文件读取、搜索、Shell 执行、Git Diff 等核心工具
7. 统一事件流输出
8. 审批流基础能力
9. Profiles 配置

### 8.2 首发后增强

1. 多 Agent 协同
2. 多面板 Agent TUI
3. WASM 插件系统
4. Daemon + SSE
5. SDK/FFI
6. Seccomp / Landlock 沙箱

## 9. 核心交互模式

### 9.1 Plan 模式

仅生成计划，输出结构化执行方案。

适用任务：

1. 需求拆解
2. 重构方案设计
3. 改动预演

### 9.2 Build 模式

生成计划并执行，但在高风险节点请求审批。

审批节点包括：

1. 写文件
2. 执行 Shell 命令
3. 调用外部插件
4. 批量改动

### 9.3 YOLO 模式

在既定权限策略内全自动执行。

适用任务：

1. 批量格式化
2. 低风险修复
3. 可重复脚本化任务

## 10. 核心能力模型

为了统一内置工具、插件和未来外部能力，SaCode 需要定义统一能力抽象。

### 10.1 ToolSpec

每个工具必须描述以下字段：

1. `name`
2. `description`
3. `input_schema`
4. `output_schema`
5. `side_effect_level`
6. `approval_required`
7. `timeout_ms`
8. `tags`

### 10.2 Event

所有界面和输出层共享统一事件模型。首版至少支持：

1. `message`
2. `thinking`
3. `plan_generated`
4. `tool_call_started`
5. `tool_call_finished`
6. `approval_requested`
7. `approval_resolved`
8. `file_changed`
9. `command_output`
10. `done`
11. `error`

### 10.3 ExecutionContext

执行上下文至少包括：

1. `cwd`
2. `mode`
3. `profile`
4. `approval_policy`
5. `token_budget`
6. `available_tools`
7. `session_id`

### 10.4 Checkpoint

用于中断恢复、审批续跑和长任务状态持久化。首版可先支持：

1. 当前任务
2. 当前步骤
3. 已执行工具记录
4. 待审批动作
5. 最近事件摘要

## 11. 核心对象模型

### 11.1 Task

用户输入的目标描述，是一次执行的顶层对象。

### 11.2 Plan

由多个步骤组成，是 Task 的结构化拆解结果。

### 11.3 Step

最小执行单元。每个 Step 应该具备清晰目标、输入上下文和成功标准。

### 11.4 Action

单次模型调用或工具调用。Action 是 Runtime 的实际执行对象。

### 11.5 Review

对 Step 结果的结构化判断。至少包括：

1. 是否通过
2. 问题列表
3. 建议下一步

## 12. 架构设计

### 12.1 分层架构

1. `Interfaces`：CLI、Daemon、SDK/FFI
2. `Runtime`：Tools、Workspace、Sandbox、Store、Plugin、Streaming
3. `Kernel`：Agent、Model、Schema

### 12.2 分层原则

1. `Kernel` 负责计划、决策、状态迁移和能力编排。
2. `Runtime` 负责真实副作用执行。
3. `Interfaces` 负责交互呈现和输入输出适配。
4. 依赖方向保持自上而下，接口层调用内核抽象，内核编排运行时能力。

### 12.3 工程边界建议

虽然目录采用三层表达，实际实现时建议进一步明确 Runtime 的三类职责：

1. 执行层：FS、Shell、Git、Sandbox
2. 上下文层：Scanner、Graph、Context、AST、Symbol
3. 平台层：Store、Plugin、Streaming

## 13. 技术方案约束

### 13.1 技术栈

1. 语言：Rust
2. 异步：Tokio
3. Web / Daemon：Axum
4. TUI：Ratatui + Crossterm
5. REPL：Rustyline
6. 解析：Tree-sitter
7. 配置：Serde + Figment
8. 插件：Extism
9. 缓存：Moka
10. 存储：SQLite

### 13.2 工程要求

1. 核心路径保持低启动开销。
2. 所有长任务必须可取消。
3. 所有副作用操作必须具备超时控制。
4. 所有工具调用必须结构化记录输入、输出和状态。
5. 首版优先保证稳定性和可解释性。

## 14. Profiles 设计

### 14.1 目标

Profiles 用于管理多模型、多角色、多成本档位配置。

### 14.2 配置要求

1. 支持当前激活 profile
2. 支持按角色配置模型
3. 支持 provider 独立配置
4. 支持命令行临时覆盖

### 14.3 示例

```yaml
current: default

providers:
  openai:
    api_key_env: OPENAI_API_KEY
  deepseek:
    api_key_env: DEEPSEEK_API_KEY
  ollama:
    base_url: http://127.0.0.1:11434

profiles:
  default:
    agents:
      planner: { provider: openai, model: gpt-4o }
      coder: { provider: deepseek, model: deepseek-coder }
      reviewer: { provider: openai, model: gpt-4o-mini }
```

### 14.4 CLI 目标

```bash
sacode profile ls
sacode profile use economy
sacode "修复 bug" --profile local
```

## 15. 多 Agent 设计策略

### 15.1 终态目标

引入 `planner`、`coder`、`reviewer` 等角色，由 `supervisor` 统一调度。

### 15.2 首发策略

首版采用“单执行器 + 多阶段角色提示”的方式验证闭环：

1. 先拆解任务
2. 再执行步骤
3. 最后审查结果

这样可以先验证：

1. 任务分解质量
2. 工具执行可靠性
3. 审查反馈结构
4. 重试终止条件

### 15.3 正式多 Agent 的进入条件

1. Step 结构稳定
2. Review 数据结构稳定
3. 重试策略稳定
4. 事件流稳定

## 16. 工作区感知能力

这是 SaCode 的核心差异化能力之一。

首版至少需要：

1. 文件扫描
2. 按路径、后缀和模式过滤
3. 文本搜索
4. Git Diff 感知
5. 上下文裁剪

后续增强：

1. 符号索引
2. 依赖图
3. AST 编辑
4. 语言级导航

## 17. 审批与安全模型

### 17.1 审批原则

高风险操作在 Build 模式下默认请求审批。

### 17.2 首版安全策略

1. 工具白名单
2. 路径范围限制
3. 命令执行超时
4. 输出截断
5. 写入前展示摘要或 diff

### 17.3 后续增强

1. Seccomp
2. Landlock
3. 插件权限隔离
4. 更细粒度审批策略

## 18. 界面设计要求

### 18.1 Ghost

1. 无 TUI
2. 支持 JSON 输出
3. 支持脚本和管道集成

### 18.2 Chat

1. 支持 REPL
2. 支持流式输出
3. 支持命令面板
4. 支持模式切换
5. 支持工具事件展示

### 18.3 Agent

1. 多面板布局
2. 工作区预览
3. 计划与活动面板
4. 工具状态面板
5. 文件 diff 预览

## 19. 里程碑规划

### Phase 1：CLI 核心回路

目标：

1. `sacode "task"` 可运行
2. Ghost 模式可用
3. 基础工具调用可用
4. 统一事件输出可用

验收标准：

1. 支持读取 stdin
2. 支持输出结构化 JSON
3. 支持至少 3 个基础工具
4. 能完成只读分析类任务

### Phase 2：交互能力

目标：

1. Chat 模式
2. REPL
3. 命令面板
4. Plan / Build 模式
5. 审批流基础版

验收标准：

1. 支持模式切换
2. 支持审批继续执行
3. 支持显示工具调用过程

### Phase 3：工作区感知

目标：

1. 文件扫描
2. 搜索
3. Git 感知
4. 上下文预算管理

验收标准：

1. 能基于工作区定位相关文件
2. 能在上下文限制下完成常见代码分析任务

### Phase 4：配置与闭环增强

目标：

1. Profiles
2. Provider Router
3. 单执行器多角色
4. Review 闭环

验收标准：

1. 支持多 profile 切换
2. 支持按角色选择模型
3. 支持基于 review 的有限次重试

### Phase 5：平台化扩展

目标：

1. 多 Agent
2. 插件系统
3. Daemon + SSE

验收标准：

1. 支持至少一个 WASM 插件示例
2. 支持 Daemon 暴露统一事件流

### Phase 6：安全与发布

目标：

1. 沙箱增强
2. 发布流程
3. SDK/FFI

验收标准：

1. 形成可分发版本
2. 形成最小集成接口

## 20. 成功指标

### 20.1 产品指标

1. 用户能在终端完成从分析到执行的完整任务闭环
2. 用户能明确理解当前模式、当前计划和当前执行状态
3. 用户能将 SaCode 融入脚本和管道工作流

### 20.2 工程指标

1. CLI 冷启动足够快
2. 常见工具调用具备稳定超时和错误处理
3. 事件流结构稳定，可被 CLI、Daemon、SDK 复用
4. 配置、工具和模型边界清晰，可持续扩展

## 21. 风险与待确认事项

1. Rust Nightly 是否为必须依赖仍需确认。
2. 存储层使用 SeaORM 的收益与复杂度仍需评估。
3. 首版是否需要真正多 Agent 仍需以单执行器闭环验证结果为准。
4. TUI 复杂度高，需控制 Phase 2 和 Phase 3 的界面范围。
5. AST 编辑和符号索引的语言覆盖范围需明确优先级。

## 22. 最终结论

SaCode 首发阶段应聚焦四件事：

1. 稳定的 CLI 主回路
2. 强工作区感知能力
3. 可解释的工具执行与审批流
4. 清晰的模式切换与配置体系

在这四项能力稳定后，再逐层扩展多 Agent、插件、Daemon 和系统级沙箱，能以更低风险把 SaCode 做成真正的平台型 AI 编程工具。
