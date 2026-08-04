# SaCode 项目优化与问题修复计划

> 生成时间：2026-06-04

## 项目概况

SaCode 是一个 Rust 多工作区项目，包含 kernel（纯执行逻辑）、runtime（副作用与连接）、interfaces/cli（TUI/REPL/CLI）、interfaces/acp、interfaces/lsp 等模块。本文档记录代码质量审查发现的问题及修复计划。

---

## 问题总览

| 优先级 | 问题 | 影响 |
|--------|------|------|
| **P0 严重** | 并发信号量 Permit 生命周期错误 (`queue/mod.rs:66`) | 并发控制完全失效 |
| **P0 严重** | `fs.search` 依赖系统 `grep` 命令 (`fs/search.rs:58`) | Windows 上完全不可用 |
| **P1 高** | UTF-8 字符串字节切片 (`shell/exec.rs:148-149`) | 多字节文本可能导致 Panic |
| **P1 高** | `InMemoryStore.update_status` 空操作 | 队列状态更新无效 |
| **P1 高** | 生产路径 `unwrap()` 若干处 | 潜在运行时 Panic |
| **P2 中** | 关键路径 `let _ =` 静默吞错 | 错误难以排查 |
| **P2 中** | Provider URL 定义不一致 (Mimo) | 默认配置与运行时入口可能指向不同端点 |
| **P2 中** | TUI 排队消息过早显示 | 队列中的用户消息会提前出现在消息区 |
| **P3 低** | TUI 渲染重复逻辑、废弃 API、Unix 依赖、魔法数字 | 可维护性问题 |

---

## 详细问题分析

### P0-1: 并发信号量 Permit 泄漏

**文件**: `runtime/src/queue/mod.rs:66`

**问题**: `next_ready()` 方法获取 `SemaphorePermit` 后立即释放（作用域结束 drop），而非在任务完成 `mark_completed()` / `mark_failed()` 时释放。导致并发限制完全失效。

```rust
// 当前代码（简化）：
pub async fn next_ready(&self) -> Option<ScheduledTask> {
    let permit = self.concurrency_semaphore.try_acquire();
    if permit.is_err() { return None; }
    // permit 在这里 drop，立即释放回信号量
    // ... 返回 task，但并发限制已失效
}
```

**修复方案**: 使用 `tokio::sync::OwnedSemaphorePermit`，但 permit 仅保存在 `runtime::TaskQueue` 内部，避免把运行时同步原语塞进 `kernel::ScheduledTask` 纯数据模型。

- `concurrency_semaphore` 改为 `Arc<Semaphore>`
- `TaskQueue` 新增 `running_permits: RwLock<HashMap<String, OwnedSemaphorePermit>>`
- `next_ready()` 成功取到任务时，将 permit 以 `task_id` 为键放入 `running_permits`
- `mark_completed()` / `mark_failed()` / `cancel()` 中移除对应 permit，借由 drop 释放并发槽位

**原因**: `ScheduledTask` 属于 kernel 数据结构，保持纯数据职责更符合当前分层约束：`interfaces/* -> runtime -> kernel`。

---

### P0-2: fs.search 跨平台不可用

**文件**: `runtime/src/tools/fs/search.rs:58`

**问题**: 直接调用系统 `grep` 命令，Windows 上不存在原生 `grep`。

```rust
let mut cmd = Command::new("grep");
cmd.arg("-n").arg("-r").arg("--line-buffered");
```

**修复方案**: 使用纯 Rust 实现替代系统 `grep`，消除平台依赖。

- 在 `runtime/Cargo.toml` 显式加入 `ignore` 和 `regex`
- 使用 `ignore::WalkBuilder` 处理目录遍历与 `.gitignore` 语义
- 使用 `regex::Regex` 处理模式匹配
- 输出结构保持兼容：`matches/count/returned/truncated`

**注意**: 当前 workspace 已声明 `ignore`，`runtime` crate 仍需显式接入 `ignore.workspace = true`，并新增 `regex` 依赖后再落地实现。

---

### P1-1: UTF-8 字节切片 Panic

**文件**: `runtime/src/tools/shell/exec.rs:148-149`

**问题**: 按字节偏移截断字符串，可能在多字节 UTF-8 字符中间截断，导致后续使用 panic。

```rust
format!("{}... (truncated, {} bytes total)",
    &output[..MAX_OUTPUT_LEN], output.len())
```

**修复方案**: 使用 `floor_char_boundary()` (Rust 1.73+) 或 `char_indices()` 找到安全截断点。

```rust
let trunc_at = output.floor_char_boundary(MAX_OUTPUT_LEN);
format!("{}... (truncated, {} bytes total)", &output[..trunc_at], output.len())
```

---

### P1-2: InMemoryStore.update_status 空操作

**文件**: `runtime/src/queue/mod.rs:396`

**问题**:

```rust
async fn update_status(&self, task_id: &str, _status: TaskQueueStatus) -> anyhow::Result<()> {
    // 当前实现重新插入了 clone，但没有真正更新状态
}
```

**修复方案**:

- 在 `ScheduledTask` 上确认状态字段的更新入口
- `update_status()` 中实际更新存储对象状态后再写回
- 为状态流转补测试：`Pending -> Running -> Completed/Failed/Cancelled`

---

### P1-3: 生产路径 unwrap()

**高优先级修复范围**:

| 文件 | 行号 | 代码 | 风险说明 |
|------|------|------|----------|
| `runtime/src/queue/mod.rs` | 48,102,118,136,162,174,188 | `self.store.as_ref().unwrap()` | `is_some()` + `unwrap()` 反模式 |
| `runtime/src/daemon/handlers.rs` | 349-350 | `.bind(addr).await.unwrap()` | 端口占用时 panic |
| `runtime/src/checkpoint/mod.rs` | 62 | `checkpoints.last().unwrap()` | 空列表时 panic |
| `interfaces/cli/src/tui/task_runtime.rs` | 450 | `child.lock().unwrap().kill()` | Mutex poisoned 时 panic |
| `interfaces/cli/src/cmd/checkpoint.rs` | 77 | `checkpoint.pending_approval.unwrap()` | 直接 unwrap Option |

**暂缓项**:

- `kernel/src/ffi.rs` 的 `CString::new(...).unwrap()` 不能简单替换成固定字符串兜底，否则会隐式改写 FFI 返回语义。
- FFI 需要单独设计明确的错误返回策略，而不是在本轮和通用 panic 修复混做。

**修复方案**:

- `is_some() + unwrap()` 改成 `if let Some(store) = self.store.as_ref()`
- `Option` 改成 `ok_or_else(...)?` 或带上下文的早返回
- `Mutex` 改成 `if let Ok(child) = child.lock()` 或记录 poisoned 状态

---

### P2-1: 关键路径 let _ = 静默错误忽略

**优先处理位置**:

| 文件 | 行号 | 被忽略的操作 |
|------|------|-------------|
| `interfaces/cli/src/tui/task_runtime.rs` | 119, 141 | `sender.send(...)` |
| `interfaces/cli/src/tui/session_store.rs` | 106-107 | `fs::write(...)` |
| `interfaces/cli/src/tui/provider_actions.rs` | 401, 424 | provider 数据变更 |
| `interfaces/cli/src/runner.rs` | 122,136,333,410,418,447 | 初始化和错误记录 |

**修复方案**:

- 关键路径改为 `if let Err(error) = ... { tracing::warn!(...) }`
- 非关键路径保留忽略时，补一行注释说明原因

---

### P2-2: Provider URL 定义不一致

**问题**: Mimo base URL 在 `kernel`、`runtime` 和 `interfaces` 中不一致，默认配置与运行时入口存在分叉。

| 位置 | Mimo URL |
|------|----------|
| `kernel/src/model/provider.rs` | `https://api.xiaomimimo.com/v1` |
| `runtime/src/provider/client.rs` | `https://api.xiaomimimo.com/v1` |
| `kernel/src/model/config.rs` | `https://token-plan-cn.xiaomimimo.com/v1` |
| `interfaces/cli/src/tui/provider_actions.rs` | `https://token-plan-cn.xiaomimimo.com/v1` |
| `interfaces/cli/src/tui/bootstrap.rs` | `https://token-plan-cn.xiaomimimo.com/v1` |
| `interfaces/cli/src/repl.rs` | `https://token-plan-cn.xiaomimimo.com/v1` |

**修复方案**: 分两步执行，避免先改错地址。

- 第一步：抽取常量，统一引用当前各处已在使用的值
- 第二步：确认 Mimo 正式生产地址后，再统一切换

**注意**: 这个问题当前影响真实流量入口，优先级低于并发、跨平台和 panic 修复。

---

### P2-3: TUI 排队消息显示时机错误

**文件**: `interfaces/cli/src/tui/send_actions.rs`, `interfaces/cli/src/tui/task_runtime.rs`

**问题**: 用户消息在发送时就写入消息区，而实际任务可能只是进入等待队列。这样会让未执行的任务看起来像已经开始执行，和等待队列语义不一致。

**修复状态**: 已完成。

- `send_message()` 只负责清空输入并入队
- `start_queued_message()` 在任务真正开始执行时追加 `MessageRole::User`
- 队列提示文案调整为：单项显示具体任务内容，多项显示前方任务数量
- 已补定向测试覆盖单项排队、多项排队和渲染文案

---

## 灵枢架构与扩展能力实证审查（2026-08-03）

> 本节基于对灵枢三子系统、工具分层、SDK/Daemon/MCP、代码智能的代码级审查，所有结论附代码行号证据。审查目的：核对文档宣称与代码实际是否一致，识别"已写但未闭环"或"宣称但未实现"的问题。

### 审查问题总览

| 编号 | 优先级 | 问题 | 类别 | 状态 |
|------|--------|------|------|------|
| L0-1 | **P0 严重** | 多 Agent 子 Agent 路径不记录模型健康，自愈合闭环断裂 | 灵枢-自愈合 | ✅ 已修复 |
| L0-2 | **P0 严重** | FailoverContext 上下文字段全部填空 Vec，故障切换不继承进度 | 灵枢-自愈合 | ✅ 已修复 |
| L0-3 | **P1 高** | NodeDecision 的 WaitForUser/WaitForApproval/Fail 分支未处理 | 灵枢-自愈合 | ✅ 已修复 |
| L0-4 | **P0 严重** | 工具分层 for_prompt() 仅 SDK 路径调用，主流程全量注入 | 工具分层 | ✅ 已修复 |
| L0-5 | **P1 高** | 五维冲突检测只报告不拦截，无自动回路 | 灵枢-自防护 | ✅ 已修复 |
| L0-6 | **P2 中** | MCP 暴露侧仅 3 个工具，协议方法不全 | MCP 暴露侧 | ✅ 已修复 |
| L0-7 | **P2 中** | LSP 跳转/引用/重命名等核心能力缺失 | LSP 短板 | ✅ 已修复 |
| L0-8 | **P2 中** | ACP capabilities 声明 tools:true 但无 tools method | ACP 协议 | ✅ 已修复 |

---

### L0-1: 多 Agent 子 Agent 路径自愈合闭环断裂

**优先级**: P0 严重

**文件**: `runtime/src/agents/worker.rs:127`

**问题**: `run_sub_agent` 调用 `execute_task_with_failover` 时，第 6 个参数 `model_health_recorder` 显式传入 `None`，注释为"子 Agent 暂不记录模型健康"。

```rust
// runtime/src/agents/worker.rs:121-128
let task_run_result = execute_task_with_failover(
    &config,
    resolved_route.as_ref().map(|r| &r.plan),
    &candidates,
    profile,
    None, // 子 Agent 暂不支持流式输出
    None, // 子 Agent 暂不记录模型健康  ← 问题点
)
.await;
```

**闭环断裂证据链**:

1. 单 Agent CLI 路径（`interfaces/cli/src/runner.rs:264-275`）传入真实 recorder 闭包，调用 `record_model_health` 写入 `.sacode/model-health.json`
2. `runtime/src/agents/model_router.rs:241-255` 的 `score_candidate` 真实读取 `health_store.entries` 调整路由打分（`model_health_score_delta`）
3. 但多 Agent 编排路径（`worker.rs:127`）传 `None`，导致：
   - 子 Agent 执行成功/失败**不写入** `model-health.json`
   - 下次 `resolve_role_route` → `score_candidate` 读取的健康缓存**不包含本次编排的执行结果**
   - 自愈合在灵枢主推的"多 Agent 编排"场景下**失去反馈闭环**

**影响**: 灵枢架构宣称的"自愈合"在多 Agent 主战场名不副实。子 Agent 反复失败的模型不会被健康缓存降权，下次编排仍可能被选为主模型。

**修复方案**:

- 让 `run_sub_agent` 接收一个 `model_health_recorder` 参数（或通过 ExecutionContext 传递）
- 在 `execute_role_driven_orchestration`（`orchestrator.rs:28-109`）构建 recorder 闭包，传入 `execute_parallel_groups` → `run_sub_agent`
- recorder 闭包复用 `interfaces/cli/src/provider_runtime.rs:45` 的 `record_model_health` 逻辑

**风险**: 极低。一行代码级修改，且单 Agent 路径已验证该机制可用。

---

### L0-2: FailoverContext 上下文字段全部填空 Vec

**优先级**: P0 严重

**文件**: `runtime/src/executor/task_runner.rs:251-259`

**问题**: 故障切换构建 `FailoverContext` 时，`completed_steps`/`tool_summary`/`retained_facts` 三个字段全部填空 Vec，切换时不继承上一次执行的上下文。

```rust
// runtime/src/executor/task_runner.rs:251-259
let failover_context = FailoverContext {
    original_task: config.user_prompt.clone(),
    completed_steps: vec![],        // ← 空，未收集已完成步骤
    tool_summary: vec![],           // ← 空，未收集工具调用摘要
    last_error: result.response.clone().err(),
    low_score_reasons: vec!["node scored low, switching model".to_string()],
    workspace_summary: profile.evidence.clone(),
    retained_facts: vec![],         // ← 空，未提取关键事实
};
```

**影响**: 故障切换到 fallback 模型时，下一个模型只能看到 `last_error` 和原始 prompt，**无法继承上一次执行已完成的步骤、已调用的工具结果、已确认的关键事实**。导致：

- fallback 模型可能重复执行已完成的工作
- 长任务切换后上下文丢失，效率下降
- `FailoverContext` 数据结构定义完整但实际填充不完整，是"骨架就绪但未闭环"

**修复方案**:

- `execute_task_with_provider` 返回值需携带 `tool_calls` 摘要和已完成步骤
- 在 `task_runner.rs:251` 处从 `result` 中提取这些信息填入 `FailoverContext`
- `retained_facts` 可从 `result.response`（若成功部分）提取关键结论

**风险**: 中。需要扩展 `TaskRunResult` 或 `execute_task_with_provider` 的返回值，涉及签名变更。

---

### L0-3: NodeDecision 分支未完整处理

**优先级**: P1 高

**文件**: `runtime/src/executor/task_runner.rs:228-240`

**问题**: `NodeDecision` 枚举定义 5 个变体（`model_routing/mod.rs:68-74`）：

```rust
pub enum NodeDecision {
    Accept,
    SwitchModel,
    WaitForUser,
    WaitForApproval,
    Fail,
}
```

但 `execute_task_with_failover` 的 failover 循环只处理 `SwitchModel`：

```rust
// runtime/src/executor/task_runner.rs:228-240
let should_switch = if result.response.is_err() {
    true
} else if let Ok(ref response) = result.response {
    let score = NodeScore::evaluate(None, response, &[], profile);
    score.decision == crate::NodeDecision::SwitchModel  // ← 仅检查 SwitchModel
} else {
    false
};

if !should_switch || result.pending_question.is_some() {
    break;  // ← WaitForUser/WaitForApproval/Fail 等价于 break，不处理
}
```

**影响**: `NodeScore::evaluate`（`model_routing/mod.rs:294-436`）有能力判定 `WaitForUser`/`WaitForApproval`/`Fail`，但这些决策当前等价于 `Accept`（break 退出循环，返回当前 result），**未被区分处理**。这意味着：

- 该 `Fail` 的任务可能被当作成功返回
- 该等待用户的场景没有触发 `pending_question`
- 决策系统的细分能力被浪费

**修复方案**:

- 在 `should_switch` 判断后，增加对其他 decision 变体的分支处理
- `WaitForUser`/`WaitForApproval` → 设置 `result.pending_question`
- `Fail` → 直接返回错误结果，不进入 failover 循环

**风险**: 低。逻辑分支扩展，不破坏现有 `SwitchModel` 路径。

---

### L0-4: 工具分层 for_prompt() 仅 SDK 路径调用

**优先级**: P0 严重

**文件**: `runtime/src/agents/worker.rs:50`、`runtime/src/session/mod.rs`（主流程）、`runtime/src/sdk.rs:184`（SDK 路径）

**问题**: `ToolRegistry::for_prompt()` 实现了完整的四级筛选（Core 层 → 角色白名单 → TaskProfile → token 预算），但在主流程中**未被调用**：

| 调用点 | 文件 / 行号 | 实际用法 | 是否分层筛选 |
|--------|------------|----------|--------------|
| `agents/worker.rs` | 第 50 行 | `ToolRegistry::builtin()` + `tools.names()` 全量 | **否** |
| `session/mod.rs` | 第 308-312 行 | `ToolRegistry::builtin()` + `tools.names()` 全量 | **否** |
| `daemon/handlers.rs` | 第 345 行 | `ToolRegistry::builtin()`（仅展示） | **否** |
| `sdk.rs`（SDK 路径） | 第 184 行 | `for_prompt(role, profile, budget)` | **是** |

全代码库搜索 `for_prompt` 调用点：仅 `sdk.rs:184` 一处真实调用（测试除外）。

**影响**: AGENTS.md 宣称"目标降低 system prompt token 60-70%"的优化，**目前仅在 SDK 嵌入式场景生效**。常规 CLI/REPL/TUI/agents 编排路径仍把 26 个工具 schema 全量注入 prompt，分层筛选对主流程的 token 优化**当前未产生实际作用**。

**修复方案**:

- `agents/worker.rs:50` 处：用 `for_prompt(Some(&role), Some(profile), None)` 替代 `builtin()` + `names()`
- `session/mod.rs:308-312` 处：用 `for_prompt(None, Some(profile), context_budget)` 替代全量注入
- daemon 路径按需接入

**风险**: 中。主流程 prompt 注入变更，需验证角色白名单和 TaskProfile 在这些路径有正确来源，且工具调用不会因未注入而失败。

---

### L0-5: 五维冲突检测只报告不拦截

**优先级**: P1 高

**文件**: `runtime/src/agents/orchestrator.rs:82-98`

**问题**: `collect_conflict_records`（`orchestrator.rs:336-474`）真实实现了五维冲突检测（status_conflict/route_conflict/validation_conflict/conclusion_conflict/polarity_conflict），但检测到冲突后**只生成报告，无自动处置回路**：

```rust
// orchestrator.rs:82-98
report.conflict_records = collect_conflict_records(&results.iter().collect::<Vec<_>>());
report.conflicts = report.conflict_records.iter().map(|r| r.summary.clone()).collect();
report.summary_record = Some(build_summary_record(
    &context.task.prompt, &results, &report.conflicts, &report.conflict_records,
));
report.final_output = Some(aggregate_worker_results(
    &context.task.prompt, &results, &report.conflicts,
));
// ← 到此结束，无重试/回滚/重新调度/阻塞执行
```

`recommended_next_action`（`orchestrator.rs:576-648`）只是给用户的**文字建议字符串**，没有任何代码消费它触发自动执行。

**影响**: AGENTS.md 把自防护描述为"五维冲突检测**与拦截**"，但代码只做"检测与记录"。冲突被发现后：

- 不会阻塞任务完成
- 不会触发 reviewer 重新裁决
- 不会回滚 implementer 的改动
- 不会标记任务需人工介入

是"诊察"但非"治愈"，"自防护"能力被高估。

**修复方案**:

- 检测到 `validation_conflict` 时，触发 reviewer 角色重新裁决
- 或在 `execute_role_driven_orchestration` 中加入冲突处置策略：标记任务状态为 `NeedsReview`，设置 `pending_question` 等待用户
- 至少让 `recommended_next_action` 能被 `/loop` 消费自动执行

**风险**: 中。需设计冲突处置策略，避免无限重试循环。

---

### L0-6: MCP 暴露侧工具覆盖率低且协议方法不全

**优先级**: P2 中

**文件**: `runtime/src/mcp/servers/stdio.rs:82-95`、`runtime/src/mcp/servers/stdio.rs:102`

**问题**: 内置 MCP stdio server 仅暴露 3 个工具，且协议方法不全：

```rust
// stdio.rs:82-95 — 仅暴露 3 个工具
fn builtin_stdio_tools(registry: &ToolRegistry) -> Vec<serde_json::Value> {
    ["fs.read", "fs.list", "git.diff"]  // ← 仅 3 个，26 个工具覆盖率 11.5%
        .iter()
        .filter_map(|name| registry.get(name))
        ...
}

// stdio.rs:102 — 白名单硬编码
if !matches!(name, "fs.read" | "fs.list" | "git.diff") {
    return json!({ "isError": true, ... });
}
```

**缺失的协议方法**:

- 无 `resources/list`、`resources/read`
- 无 `prompts/list`、`prompts/get`
- 无 `notifications/initialized` 处理
- 错误码粗糙，除 `-32601` 外都用 `isError: true` 包裹

**影响**: SaCode 作为 MCP server 对外暴露能力偏弱，26 个内置工具仅 3 个可被外部 MCP 客户端使用，限制了"被集成"场景的能力输出。

**修复方案**:

- 扩展白名单到更多 ReadOnly 工具：`code.symbols`、`code.deps`、`code.search`、`test.run`、`web.fetch`、`web.search`、`fs.search`、`fs.read_multi`、`git.diff`
- 补 `resources/*`、`prompts/*` 方法
- 细化 JSON-RPC 错误码

**风险**: 低。ReadOnly 工具暴露安全风险小，扩展白名单是增量改动。

---

### L0-7: LSP 跳转/引用/重命名等核心能力缺失

**优先级**: P2 中

**文件**: `interfaces/lsp/src/server.rs:44-56`、`interfaces/lsp/src/server.rs:399-407`

**问题**: LSP initialize 声明的 capabilities 仅 4 项：

```rust
// server.rs:47-54
capabilities: ServerCapabilities {
    text_document_sync: Some(TextDocumentSyncCapability::Kind(TextDocumentSyncKind::FULL)),
    completion_provider: Some(CompletionOptions::default()),
    hover_provider: Some(HoverProviderCapability::Simple(true)),
    code_action_provider: Some(CodeActionProviderCapability::Simple(true)),
    ..Default::default()  // ← 其余 capability 为 None
}
```

**已实现方法**（7 项，stdio 路径真实工作）：`initialize`/`initialized`/`did_open`/`did_change`/`did_close`/`completion`/`hover`/`code_action` + 诊断（cargo/tsc/py_compile）。

**缺失的 LSP 能力**:

- `textDocument/references` — 引用查找
- `textDocument/definition` / `typeDefinition` / `implementation` / `declaration` — 跳转
- `textDocument/rename` / `prepareRename` — 重命名
- `textDocument/documentSymbol` / `workspace/symbol` — 符号（**讽刺：`code.symbols` 工具内部已有此能力，未桥接到 LSP**）
- `textDocument/formatting` / `rangeFormatting`
- `textDocument/semanticTokens`
- `textDocument/signatureHelp` / `codeLens` / `inlayHint`

**TCP server 仅骨架**（`server.rs:399-407`）：

```rust
pub async fn run_tcp_server(config: &LspConfig) -> Result<()> {
    let listener = tokio::net::TcpListener::bind(...).await?;
    loop {
        let (_stream, _addr) = listener.accept().await?;  // ← accept 后丢弃，不处理
    }
}
```

**影响**: 相对 Cursor/Cline 的 LSP 能力是明显短板。已有 `code.symbols` 的 AST 符号索引能力**未桥接到 LSP documentSymbol**，是能力浪费。

**修复方案**:

- **第一阶段**（低成本高收益）：桥接 `code.symbols` 到 LSP `documentSymbol`/`workspaceSymbol`
- **第二阶段**：基于 AST 引用图实现 `references`/`definition`
- **第三阶段**：补 `rename`/`formatting`/`semanticTokens`
- TCP server 补完整处理或明确移除

**风险**: 中。`references`/`definition` 需基于 AST 构建引用图，工作量大。

---

### L0-8: ACP capabilities 声明与实际不符

**优先级**: P2 中

**文件**: `interfaces/acp/src/server.rs:54-60`

**问题**: `initialize` 方法返回的 capabilities 声明 `tools: true`，但 `handle_request` 中**没有任何 `tools/*` method**：

```rust
// server.rs:54-60
"initialize" => serde_json::json!({
    "capabilities": {
        "session": true,
        "loadSession": true,
        "tools": true  // ← 声明为 true
    }
}),
```

全文件搜索 `"tools/` / `"tools.` / `tools/list` / `tools/call`：**No matches found**。

**已实现 method**（8 个，真实工作）：`initialize`/`session/new`/`session/load`/`session/prompt`/`session/cancel`/`session/close`/`session/get`/`session/list`。

**影响**: capabilities 声明虚高，外部客户端基于 `tools:true` 调用 `tools/list` 或 `tools/call` 会收到 `unsupported method` 警告。协议不诚信，影响集成体验。

**修复方案**（二选一）:

- **方案 A**：补 `tools/list`（列出内置工具 spec）和 `tools/call`（调用指定工具）method，让声明成真
- **方案 B**：删除 `tools: true` 声明，明确重新定位为"SaCode Session RPC"而非标准 ACP

**推荐**: 方案 A，与 MCP 暴露侧能力对齐，增强"被集成"价值。

**风险**: 低。`tools/list` 和 `tools/call` 可复用 `ToolRegistry::builtin()` 已有逻辑。

---

### 修复优先级建议

按"投入产出比 × 风险"排序：

| 顺序 | 编号 | 任务 | 投入 | 收益 | 风险 |
|------|------|------|------|------|------|
| 1 | L0-1 | 修复 worker.rs:127 健康反馈断裂 | 极小 | 极高 | 极低 |
| 2 | L0-4 | 工具分层接入主流程 | 中 | 极高 | 中 |
| 3 | L0-2 | 填充 FailoverContext 上下文 | 小 | 高 | 中 |
| 4 | L0-5 | 冲突检测加自动回路 | 中 | 高 | 中 |
| 5 | L0-3 | 处理未覆盖 NodeDecision 分支 | 小 | 中 | 低 |
| 6 | L0-8 | ACP 协议修正（方案 A） | 小 | 中 | 低 |
| 7 | L0-6 | MCP 暴露侧扩展 | 小 | 高 | 低 |
| 8 | L0-7 | LSP 能力补齐（分三阶段） | 大 | 极高 | 中 |

**建议立即从 L0-1 开始**（一行代码修复多 Agent 自愈合断裂），这是当前投入产出比最高的改进。

---

### 验证方法说明

本节所有结论均经代码行号直接验证，验证过程：

1. **L0-1**：读取 `worker.rs:121-128` 确认传 `None`；Grep `model_health_recorder` 确认仅 `runner.rs:264-275` 单 Agent 路径传入；读取 `model_router.rs:241-255` 确认真实读取 health_store 调整打分
2. **L0-2**：读取 `task_runner.rs:251-259` 确认三个字段为 `vec![]`
3. **L0-3**：读取 `task_runner.rs:228-240` 确认仅检查 `SwitchModel`；Grep `enum NodeDecision` 确认 5 个变体定义
4. **L0-4**：Grep `for_prompt` 全代码库，确认仅 `sdk.rs:184` 一处真实调用；读取 `worker.rs:50` 确认 `builtin()` + `names()` 全量
5. **L0-5**：读取 `orchestrator.rs:82-98` 确认仅生成报告；Grep `recommended_next_action` 确认无消费方
6. **L0-6**：读取 `stdio.rs:82-95` 确认 3 工具白名单；Grep 协议方法确认缺失
7. **L0-7**：读取 `server.rs:44-56` 确认 capabilities 仅 4 项；Grep `async fn (references|definition|rename|...)` 确认未实现；读取 `server.rs:399-407` 确认 TCP 骨架
8. **L0-8**：读取 `server.rs:54-60` 确认 `tools:true` 声明；Grep `"tools/` 确认无匹配

---

### 暂缓项: 重度 clone 使用 (565+ 处)

**最密集区域**:

- `runtime/src/orchestrator.rs` — ~30 处 clone，`context.clone()` 重复出现
- `runtime/src/provider/client.rs` — `messages.clone()` 每轮工具调用创建完整消息列表副本
- `runtime/src/memory/mod.rs` — `entry.content.clone()`, `entry.context.clone()` 反复出现
- `runtime/src/mcp/mod.rs` — `server.clone()`, `server_name.clone()`, `tool.clone()` 大量使用

**处理建议**: 单列为后续性能优化，不纳入本轮修复。当前 `provider/client.rs` 的 `messages.clone()` 虽有成本，但涉及请求构建边界，修改范围偏大。

---

### P3: 低优先级清理项

1. **TUI 渲染重复** (`interfaces/cli/src/tui/tui_entry.rs:164-178`): 相同渲染条件重复两次，提取为函数
2. **废弃 margin() API** (`interfaces/cli/src/tui/tui_entry.rs:91,110`): ratatui 0.28+ 已标记 deprecated，改用 `Layout::new().horizontal_margin()/vertical_margin()`
3. **反直觉条件** (`runtime/src/tools/fs/search.rs:74`): `result.stdout.is_empty() == false` → `!result.stdout.is_empty()`
4. **魔法数字** (`runtime/src/tools/task/spawn.rs:63`): `120_000` 提取为 `const DEFAULT_SPAWN_TIMEOUT_MS: u64 = 120_000;`
5. ~~**stty 依赖** (`interfaces/cli/src/tui/tui_entry.rs`): 仅 Unix 有效，添加平台条件编译或注释~~ **已完成**：`TerminalFlowControlGuard::new()` 添加 `#[cfg(unix)]`/`#[cfg(not(unix))]` 分支，Windows 上直接返回 `None`，避免 3 次无意义 `stty` 进程创建。
6. ~~**id 命令依赖** (`runtime/src/sandbox/executor.rs`): `id -u` Windows 不存在，添加平台分支~~ **已完成**：`default_container_user()` 添加 cfg 分支，Windows 直接返回 `65534:65534`；`read_id_output` 标注 `#[cfg(unix)]` 消除 dead_code。

---

## 本轮实施范围

### 必修项

1. `P0-1` 并发信号量 Permit 生命周期修复
2. `P0-2` `fs.search` 纯 Rust 跨平台重写
3. `P1-1` UTF-8 安全截断
4. `P1-2` `InMemoryStore.update_status` 实际更新状态
5. `P1-3` 高风险 unwrap 修复：queue / daemon / checkpoint / task_runtime / checkpoint cmd
6. `P2-3` TUI 排队消息显示时机修复（已完成）

### 暂缓项

1. Provider URL 统一，待确认 Mimo 正确生产地址后执行
2. 大规模 `clone()` 优化，单独做性能轮次
3. 空壳模块整理，按需实现时再清理
4. 大面积 `let _ =` 普查，先修关键路径

---

## 修改文件清单

```
kernel/
└── （本轮尽量不改动 kernel，避免扩大 blast radius）

runtime/
├── Cargo.toml                     # 增加 runtime 显式依赖：ignore / regex
├── src/queue/mod.rs               # 修复 permit 生命周期、is_some+unwrap、update_status
├── src/tools/fs/search.rs         # 替换 grep 命令为跨平台方案
├── src/tools/shell/exec.rs        # 修复 UTF-8 字节切片截断
├── src/daemon/handlers.rs         # TCP bind/listen unwrap 改为错误处理
├── src/checkpoint/mod.rs          # last().unwrap() 改为安全访问
└── src/sandbox/executor.rs        # id 命令跨平台处理

interfaces/cli/
├── src/tui/send_actions.rs        # 用户消息发送入口改为只入队
├── src/tui/task_runtime.rs        # child.lock().unwrap() 改为安全处理；任务实际开始时再打印用户消息
├── src/cmd/checkpoint.rs          # unwrap 改为安全访问
└── src/tui/mod.rs                 # 补充队列状态渲染测试
```

## 实施注意事项

1. **信号量修复**: `OwnedSemaphorePermit` 应保存在 `runtime::TaskQueue` 内部映射中，不进入 `kernel::ScheduledTask`
2. **fs.search 重写**: `runtime` 需要先显式接入 `ignore.workspace = true` 并新增 `regex`，再实现纯 Rust 搜索
3. **URL 统一**: 需先确认 Mimo 正确生产地址（`api.xiaomimimo.com` vs `token-plan-cn.xiaomimimo.com`），本轮不先改值
4. **FFI unwrap**: 不使用固定字符串兜底，避免改变 FFI 语义；单独设计错误返回策略
5. **Blast radius**: 所有修复保持 API 兼容，优先限制在 runtime 和少量 CLI 调用点
6. **测试验证**: 每完成一个 P0/P1 修复，优先跑对应定向测试；本轮结束后再跑 `cargo test --workspace`
