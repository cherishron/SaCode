# 验证报告：`--agent-loop ling_shu` 端到端通路

> 审计日期：2026-08-19  
> 审计范围：CLI 参数解析 → CliOptions 传递 → 编排入口 → Loop 工厂 → Loop 执行 → 编排主循环  
> 分支：`dev`（提交 `ccf4ec4` 起后续 5 个 commit 前的 clean 状态）

---

## 1. 各环节代码审查

### 环节 1 — CLI 参数解析

| 项 | 内容 |
|---|---|
| **代码路径** | `interfaces/cli/src/cmd/arg_parser.rs` → `parse_run_args` (L70) → `match "--agent-loop"` (L93-L96) → 写入 `CliOptions.agent_loop` (L137) |
| **数据流** | `env::args()` → `parse_args` → 进入 `parse_run_args`，逐 token 匹配。遇到 `--agent-loop` 后调用 `iter.next()` 取下一个 token 赋给 `agent_loop: Option<String>`。解析结果随 `CliOptions { agent_loop, ... }` 返回。 |
| **⚠️ unwrap/panic 风险** | 若用户传 `--agent-loop` 但后跟参数缺失（如 `sacode --agent-loop orchestrator`），`iter.next()` 返回 `None`，`agent_loop` 保持 `None`，不会 panic，但会**静默丢失该参数**。无告警/错误提示。 |
| **结论** | ⚠️ **有风险** — 参数值缺失时静默吞掉，建议改为 `if let Some(v) = iter.next() { ... } else { eprintln!("error: --agent-loop requires a value"); return ... }` |

---

### 环节 2 — CLI options 传递

| 项 | 内容 |
|---|---|
| **代码路径** | `interfaces/cli/src/cmd/mod.rs` → `pub struct CliOptions` (L108-L120) 定义 `pub agent_loop: Option<String>`；`run()` (L122) 调用 `parse_args` 后 match 分发 |
| **数据流** | `CliOptions` 结构体携带 `agent_loop` 字段。`run()` 中 `options.command == CliCommand::Orchestrator` 时调用 `run_with_orchestrator(options).await`，将整个 `CliOptions` 传入编排入口。注意：`CliCommand::Run` 路径走 `run_task`，**不经过** orchestrator 入口，因此 `--agent-loop` 仅在 `orchestrator` 子命令下生效。 |
| **⚠️ unwrap/panic 风险** | 无。`Option<String>` 正常传递。 |
| **结论** | ✅ **正常** — 但存在隐式限制：`--agent-loop` 只在 `orchestrator` 子命令下才生效（`Run` 命令直接走 `run_task` 而不读 `agent_loop`）。这不是 bug，但用户可能误以为 `sacode --agent-loop ling_shu <prompt>` 有效。 |

---

### 环节 3 — 编排入口

| 项 | 内容 |
|---|---|
| **代码路径** | `interfaces/cli/src/cmd/orchestrator_entry.rs` → `run_with_orchestrator` (L28) → 加载 `LoopConfigStore` (L48) → CLI 覆盖 `kind` (L49-L51) → `build_agent_loop` (L52) → 多 Agent 路径调用 `agent_loop.orchestrate_turn` (L62-L64) |
| **数据流** | `options.agent_loop: Option<String>` → 若有值，调用 `AgentLoopKind::parse(kind_str)` 覆盖 `loop_config.kind` → `build_agent_loop(&loop_config)` 返回 `LingShuLoop` → 若 `execution_plan.use_multi_agent` 为真，调用 `orchestrate_turn` 进入 Loop 执行。 |
| **⚠️ unwrap/panic 风险** | 无。`options.agent_loop` 为 `None` 时直接跳过覆盖，使用 `loop.json` 或默认值。`orchestrate_turn` 返回 `Result<ExecutionReport>`，通过 `?` 传播错误。`env::current_dir()?` 失败时返回 `Result`。 |
| **结论** | ✅ **正常** |

---

### 环节 4 — Loop 工厂

| 项 | 内容 |
|---|---|
| **代码路径** | `runtime/src/agents/loop_impl.rs` → `build_agent_loop` (L282-L288)；`AgentLoopKind::parse` (L120-L125)；`LoopConfig` struct (L138-L146) |
| **数据流** | 接收 `&LoopConfig`，`match config.kind`。目前仅 `AgentLoopKind::LingShu` 一个变体，返回 `LingShuLoop::with_subsystems(RoleRegistry::builtin(), config.subsystems)`。`AgentLoopKind::parse` 对未知字符串（含空字符串）一律回退到 `LingShu`。 |
| **⚠️ unwrap/panic 风险** | 无 `unwrap`/`panic`。但 `build_agent_loop` 使用 exhaustive match，若将来新增 `AgentLoopKind` 变体而未匹配，编译会报错（安全）。运行时不存在 panic 风险。 |
| **结论** | ✅ **正常** — `AgentLoopKind::parse` 对任何非法输入都优雅回退到 `LingShu`，不会 panic。 |

---

### 环节 5 — Loop 执行

| 项 | 内容 |
|---|---|
| **代码路径** | `runtime/src/agents/loop_impl.rs` → `impl AgentLoop for LingShuLoop` (L254-L275) → `orchestrate_turn` 委托 `execute_role_driven_orchestration` (L270-L272) → `Ok(report)` (L273) |
| **数据流** | `orchestrate_turn` 接收 `context`、`checkpoints`、`workdir`、`named_profile` → 直接调用 `execute_role_driven_orchestration` → 解包 `(report, _plan)` 元组 → 丢弃 `_plan`，只返回 `ExecutionReport`。`?` 操作符将 orchestrator 的错误传播到调用方。 |
| **⚠️ unwrap/panic 风险** | `execute_role_driven_orchestration` 返回 `Result<...>`，通过 `?` 安全传播。`orchestrate_step` 退化实现中 `let _ = step` 无风险。测试中 `ling_shu_loop_step_delegates_without_panic` 验证了 step 入口不 panic。 |
| **结论** | ✅ **正常** |

---

### 环节 6 — 编排主循环

| 项 | 内容 |
|---|---|
| **代码路径** | `runtime/src/agents/orchestrator.rs` → `execute_role_driven_orchestration` (L29-L108) → `execute_parallel_groups` (L220+) → `handle_conflict_disposition` (L115+) → 冲突检测/修复回路 |
| **数据流** | 构建 `ExecutionReport` → 创建 `MessageBus` → `execute_parallel_groups` 按 DAG 并行组调度 worker → 收集 `WorkerRunResult` → `build_summary_record` → `handle_conflict_disposition` 检测 `validation_conflict` 并触发修复闭环 → 返回 `(report, plan)` |
| **⚠️ unwrap/panic 风险** | 测试代码中有 `.expect("应包含 roles= 行")` (L1054) 和 `.unwrap()` (L1084, L1106)，但均在 `#[cfg(test)]` 块内，不影响生产代码。生产代码无显式 `unwrap`/`panic!`。`handle_conflict_disposition` 中 `message_bus.send()` 返回 `Result` 但用 `.await` 未捕获错误——若消息发送失败会被静默忽略，但不会导致 crash。 |
| **结论** | ✅ **正常** — 生产路径无 panic 风险。消息总线发送失败静默忽略是一个轻微的设计选择，非阻塞性风险。 |

---

## 2. `loop.json` 加载失败的回退行为

| 代码位置 | 失败场景 | 回退行为 |
|---|---|---|
| `LoopConfigStore::load()` L254 | 文件不存在（`.sacode/loop.json` 不存在） | 直接返回 `LoopConfig::default()`（即 `LingShu` + 全开子系统） |
| `LoopConfigStore::load()` L257-L259 | 文件存在但读取失败（IO 错误、权限问题） | `.ok()` 将 `Err` 转 `None`，后续 `.and_then(...).ok()` 转 `None`，返回 `LoopConfig::default()` |
| `LoopConfigStore::load()` L259 | 文件内容 JSON 格式错误或字段类型不匹配 | `serde_json::from_str` 返回 `Err`，`.ok()` 转 `None`，返回 `LoopConfig::default()` |
| `AgentLoopKind::parse()` L120-L125 | CLI `--agent-loop` 传入未知值（如 `--agent-loop foo`） | 匹配到 `_` 分支，返回 `AgentLoopKind::LingShu`（优雅降级，无告警） |

**结论**：所有失败场景均优雅回退到 `LingShu` + 全开子系统默认值，无 panic 风险。唯一可改进点是无日志输出，用户无法知道是加载成功还是使用了默认值。

---

## 3. 单元测试结果

### 命令 1：`cargo test --workspace agents::loop_impl`

```
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 539 filtered out; finished in 47.00s
```

| 测试名 | 状态 | 覆盖环节 |
|---|---|---|
| `ling_shu_loop_carries_builtin_roles` | ✅ passed | 环节 5 — 验证 LingShuLoop 携带内置角色注册表 |
| `loop_subsystems_default_all_on` | ✅ passed | 环节 4 — 默认子系统全开 |
| `loop_subsystems_presets` | ✅ passed | 环节 4 — 预定义子系统组合 |
| `agent_loop_kind_parse_known_and_unknown` | ✅ passed | 环节 4 — parse 已知/未知值回退 |
| `build_agent_loop_carries_subsystems` | ✅ passed | 环节 4 — build_agent_loop 携带子系统 |
| `build_agent_loop_default_full_subsystems` | ✅ passed | 环节 4 — 默认构建全开 |
| `ling_shu_loop_turn_entrypoint_compiles_and_dispatches` | ✅ passed | 环节 5 — orchestrate_turn 入口可编译并派发 |
| `ling_shu_loop_step_delegates_without_panic` | ✅ passed | 环节 5 — step 退化入口不 panic |

**编译警告**（非阻塞，记录存档）：
- `loop_impl.rs:190` — `context` 未使用（`orchestrate_step` 退化实现）
- `summary_compactor.rs:225` — `OutputPolarity::as_str` 未使用
- `db.rs:316` — `StoreDb::load_session` 未使用
- `apply_patch.rs:153` — `Hunk` 结构体字段未读

### 命令 2：`cargo test --workspace config::`

```
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 541 filtered out; finished in 0.01s
```

| 测试名 | 状态 | 覆盖环节 |
|---|---|---|
| `loop_config_store_roundtrip` | ✅ passed | 环节 3 — LoopConfig 序列化/反序列化往返 |
| `loop_config_store_corrupt_falls_back_to_default` | ✅ passed | 环节 3 — loop.json 损坏时回退默认 |
| `load_server_config_absent_returns_default` | ✅ passed | config 基础设施 |
| `load_server_config_invalid_json_returns_default` | ✅ passed | config 基础设施 |
| `load_project_access_config_absent_returns_default` | ✅ passed | config 基础设施 |
| `load_project_access_config_corrupt_returns_default` | ✅ passed | config 基础设施 |
| `project_config_store_roundtrip` | ✅ passed | config 基础设施 |

**全部通过**，7 个测试中包含了 LoopConfig 的往返和损坏回退两个核心测试。

---

## 4. 总结论与已知限制

### 总结论：✅ 通路贯通，无阻塞性缺陷

`--agent-loop ling_shu` 从 CLI 参数解析到编排主循环的 6 个环节数据流完全贯通：

```
--agent-loop ling_shu (arg_parser.rs)
    → CliOptions.agent_loop: Some("ling_shu")  (mod.rs)
        → Orchestrator 入口解析并覆盖 LoopConfig.kind (orchestrator_entry.rs)
            → build_agent_loop 构造 LingShuLoop (loop_impl.rs)
                → LingShuLoop::orchestrate_turn 委托 (loop_impl.rs)
                    → execute_role_driven_orchestration 执行 DAG 并行 + 冲突修复 (orchestrator.rs)
```

全部 16 个相关单元测试通过，无 panic 风险在生产代码路径上。

### 已知限制与改进建议

| # | 严重度 | 描述 | 位置 |
|---|---|---|---|
| 1 | ⚠️ 低 | `--agent-loop` 参数值缺失时静默吞掉，无错误提示 | `arg_parser.rs` L93-L96 |
| 2 | ⚠️ 低 | `--agent-loop` 仅在 `orchestrator` 子命令下生效，`sacode --agent-loop ling_shu <prompt>`（Run 模式）无效 | `mod.rs` L129 vs L130 |
| 3 | ⚠️ 低 | `LoopConfigStore::load()` 加载失败/回退时无日志输出，用户无法区分"使用了配置"vs"使用了默认" | `config/mod.rs` L253-L263 |
| 4 | ⚠️ 低 | `AgentLoopKind::parse()` 对未知值静默回退到 `LingShu`，无告警，用户可能拼写错误而不自知 | `loop_impl.rs` L120-L125 |
| 5 | ⚠️ 极低 | `build_agent_loop` 目前是 `match` 单变体（仅 `LingShu`），未来新增 Loop 实现时需要修改此函数和 CLI 测试 | `loop_impl.rs` L282-L288 |
| 6 | ℹ️ 设计选择 | `LoopSubsystems` 当前在 LingShuLoop 中作为数据面暴露但尚未真正驱动 orchestrator 内部的子系统开关，`config.subsystems` 目前不影响实际行为 | `loop_impl.rs` L269 注释中明确标注 |
| 7 | ℹ️ 设计选择 | `handle_conflict_disposition` 中 `message_bus.send()` 的错误被静默忽略（`.await` 无 `?`），但消息发送失败不影响核心编排流程 | `orchestrator.rs` `handle_conflict_disposition` |
| 8 | ℹ️ 设计选择 | `loop_impl.rs:190` `orchestrate_step` 退化实现中 `context` 未使用，产生编译警告，但不影响功能 | `loop_impl.rs` L190 |

### 建议优先级

1. **P2**：为 `--agent-loop` 添加值缺失的错误提示（#1）
2. **P3**：为 `LoopConfigStore::load()` 添加调试日志，当回退默认时输出告警（#3）
3. **P3**：为 `AgentLoopKind::parse()` 添加 `eprintln!` 告警当输入未知值（#4）
4. **P4**：将 `LoopSubsystems` 真正透传到 orchestrator 内部子系统钩子（#6，需架构变更）