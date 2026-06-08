# SaCode 架构说明

本文档描述 SaCode 的 workspace 分层、主执行链路和关键运行数据。

## 1. 总体分层

SaCode 是一个 Rust workspace，当前成员包括：

- `kernel/`
- `runtime/`
- `interfaces/cli/`
- `interfaces/acp/`
- `interfaces/lsp/`

依赖方向：

```text
interfaces/* -> runtime -> kernel
```

## 2. 各层职责

### `kernel/`

纯逻辑层，负责稳定的数据结构和执行语义：

- agent 抽象
- orchestration 计划与角色模型
- execution 上下文、审批与报告结构
- 统一事件模型
- schema、task、checkpoint、queue 等核心模型

这一层尽量不直接接触文件系统、网络、命令执行等副作用。

### `runtime/`

副作用层，负责把内核语义接到真实世界：

- provider 客户端
- tools 注册和执行
- memory / wiki
- MCP / plugin / skills
- workspace 扫描
- sandbox / retry / queue / session
- 多 agent 编排与模型路由

### `interfaces/cli/`

用户主入口，负责：

- `sacode` CLI
- 默认 TUI
- REPL
- 交互命令分发
- 输出格式化与运行协调

### `interfaces/acp/` 与 `interfaces/lsp/`

负责把 SaCode 能力暴露给外部协议和开发工具。

## 3. 主执行链路

典型任务执行链路如下：

```text
用户输入
-> CLI/TUI/REPL
-> runner / RuntimeOrchestrator
-> provider + tools + memory/wiki/workspace
-> execution report / events
-> TUI 或终端输出
```

在 role-driven orchestration 场景中，链路会扩展为：

```text
任务分析
-> 角色评分与路由
-> 子 agent 执行
-> orchestrator 汇总
-> SummaryRecord / ConflictRecord
-> CLI/TUI 摘要展示
```

## 4. 命令入口

CLI 主入口在：

- `interfaces/cli/src/cmd/mod.rs`

二进制定义在：

- `interfaces/cli/Cargo.toml`

当前可执行文件：

- `sacode`
- `sacode-tui`

## 5. 运行时能力模块

### Tool 系统

`runtime/src/tools/` 当前包括：

- `fs`
- `shell`
- `git`
- `web`
- `browser`
- `media`
- `interaction`
- `task`
- `code`

每个工具通过统一 `ToolSpec` 和 `SideEffectLevel` 暴露给执行器。

### 模型与路由

模型相关能力分散在：

- `runtime/src/provider/`
- `runtime/src/model_routing/`
- `runtime/src/agents/model_router.rs`

当前方向包括：

- 任务画像 `TaskProfile`
- 节点级动态模型路由
- 失败切换上下文 `FailoverContext`
- 角色绑定模型策略

### 多 agent 编排

编排相关代码主要位于：

- `runtime/src/agents/orchestrator.rs`
- `runtime/src/agents/worker.rs`
- `runtime/src/agents/summary_compactor.rs`
- `runtime/src/agents/role_registry.rs`

当前重点包括：

- 结构化摘要 `SummaryRecord`
- 结构化冲突 `ConflictRecord`
- 角色结论压缩
- TUI 编排可视化

### Memory / Wiki

知识相关能力位于：

- `runtime/src/memory/`
- `runtime/src/wiki/`

目标是把用户级和项目级知识接到同一条上下文注入链路。

## 6. 配置与数据落点

项目级运行数据写入 `.sacode/`：

- `provider.json`
- `mcp.json`
- `profile.json`
- `mistakes.json`
- `project.json`
- `skills/`
- `checkpoints/`

调试日志常见位置：

- `~/.sacode/logs/tui.log`

## 7. 发布与分发

发布相关目录：

- `npm-package/`
- `scripts/`
- `docs/release/RELEASE.md`

版本真源：

- 根 `Cargo.toml` 的 `[workspace.package].version`

## 8. 当前架构重点

SaCode 当前的工程重点主要集中在：

1. 统一 CLI / REPL / TUI 执行状态机
2. 强化多 agent 编排摘要与冲突闭环
3. 收敛动态模型路由
4. 把 memory / wiki / insight 接入稳定知识链路
5. 持续提升 TUI 可观察性和可维护性

## 9. 相关文档

- [API 文档](API.md) — 工具系统、Daemon、MCP 接口说明
- [开发指南](development.md) — 本地开发与贡献
- [命令参考](command-reference.md) — CLI / TUI 命令速查
- [产品 PRD](../product/PRD.md) — 产品定位与能力全景
- [功能升级方案](../plans/capability-upgrade-plan.md) — 当前工具与架构补齐计划
