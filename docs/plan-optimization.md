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
5. **stty 依赖** (`interfaces/cli/src/tui/tui_entry.rs`): 仅 Unix 有效，添加平台条件编译或注释
6. **id 命令依赖** (`runtime/src/sandbox/executor.rs`): `id -u` Windows 不存在，添加平台分支

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
