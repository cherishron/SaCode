# SaCode 项目优化与问题修复计划

> 生成时间：2026-06-04

## 项目概况

SaCode 是一个 Rust 多工作区项目，包含 kernel（纯执行逻辑）、runtime（副作用与连接）、interfaces/cli（TUI/REPL/CLI）、interfaces/acp、interfaces/lsp 等模块。本文档记录代码质量审查发现的问题及修复计划。

---

## 问题总览

| 优先级 | 问题 | 影响 |
|--------|------|------|
| **P0 严重** | 并发信号量 Permit 泄漏 (`queue/mod.rs:66`) | 并发控制完全失效 |
| **P0 严重** | `fs.search` 依赖系统 `grep` 命令 (`fs/search.rs:58`) | Windows 上完全不可用 |
| **P1 高** | UTF-8 字符串字节切片 (`shell/exec.rs:148-149`) | 多字节文本可能导致 Panic |
| **P1 高** | Provider URL 定义不一致 (Mimo) | 可能连接到错误端点 |
| **P1 高** | 生产路径 `unwrap()` (queue 7处, FFI 4处等) | 潜在运行时 Panic |
| **P2 中** | 86+ 处 `let _ =` 静默吞掉错误 | 错误难以排查 |
| **P2 中** | 565+ 处 `.clone()` 大量使用 | 性能浪费、可能掩盖所有权设计问题 |
| **P2 中** | InMemoryStore.update_status 空操作 | 状态更新无效 |
| **P2 中** | 6 个空壳模块 | 代码整洁度 |
| **P3 低** | 硬编码 URL 散布 6+ 位置 | 维护困难 |
| **P3 低** | TUI 渲染重复逻辑 | 代码冗余 |
| **P3 低** | 废弃的 `margin()` API | 未来兼容性 |
| **P3 低** | stty/id 命令 Unix 依赖 | 跨平台兼容 |
| **P3 低** | 魔法数字 `120_000` | 可读性 |

---

## 详细问题分析

### P0-1: 并发信号量 Permit 泄漏

**文件**: `runtime/src/queue/mod.rs:66`

**问题**: `next_ready()` 方法获取 `SemaphorePermit` 后立即释放（作用域结束 drop），而非在任务完成 `mark_completed()` 时释放。导致并发限制完全失效——信号量形同虚设。

```rust
// 当前代码（简化）：
pub async fn next_ready(&self) -> Option<ScheduledTask> {
    let permit = self.concurrency_semaphore.try_acquire();
    if permit.is_err() { return None; }
    // permit 在这里 drop，立即释放回信号量
    // ... 返回 task，但并发限制已失效
}
```

**修复方案**: 使用 `tokio::sync::OwnedSemaphorePermit`，将 permit 存储在 `ScheduledTask` 中，随任务传递到 `mark_completed/mark_failed` 时才释放。

- `concurrency_semaphore` 需从 `Semaphore` 改为 `Arc<Semaphore>`
- `ScheduledTask` 新增 `permit: Option<OwnedSemaphorePermit>` 字段
- `mark_completed/mark_failed` 中 drop permit

---

### P0-2: fs.search 跨平台不可用

**文件**: `runtime/src/tools/fs/search.rs:58`

**问题**: 直接调用系统 `grep` 命令，Windows 上不存在原生 `grep`。

```rust
let mut cmd = Command::new("grep");
cmd.arg("-n").arg("-r").arg("--line-buffered");
```

**修复方案**: 使用项目已有的 `ignore` crate（gitignore 语义）配合 `regex` crate 实现纯 Rust 跨平台搜索，消除对系统 `grep` 的依赖。

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

### P1-2: Provider URL 定义不一致

**问题**: Mimo base URL 在 `kernel` 和 `interfaces` 中不一致，共 6+ 处硬编码重复。

| 位置 | Mimo URL |
|------|----------|
| `kernel/src/model/provider.rs` | `https://api.xiaomimimo.com/v1` |
| `runtime/src/provider/client.rs` | `https://api.xiaomimimo.com/v1` |
| `interfaces/cli/src/tui/provider_actions.rs` | `https://token-plan-cn.xiaomimimo.com/v1` |
| `interfaces/cli/src/tui/bootstrap.rs` | `https://token-plan-cn.xiaomimimo.com/v1` |
| `interfaces/cli/src/repl.rs` | `https://token-plan-cn.xiaomimimo.com/v1` |

**修复方案**: 在 `kernel/src/model/provider.rs` 中统一定义常量，其他模块引用 kernel 常量。需先确认正确的生产地址。

---

### P1-3: 生产路径 unwrap()

**高风险文件列表**:

| 文件 | 行号 | 代码 | 风险说明 |
|------|------|------|----------|
| `runtime/src/queue/mod.rs` | 48,102,118,136,162,174,188 | `self.store.as_ref().unwrap()` | `is_some()` + `unwrap()` 反模式 (7处) |
| `kernel/src/model/provider.rs` | 288,296 | `self.tool_calls.as_ref().unwrap().is_empty()` | 应用 `map_or` 替代 |
| `kernel/src/ffi.rs` | 50,57,69,84 | `CString::new(...).unwrap().into_raw()` | FFI 层，NUL 字节导致 panic |
| `runtime/src/daemon/handlers.rs` | 349-350 | `.bind(addr).await.unwrap()` | 端口占用时 panic |
| `runtime/src/checkpoint/mod.rs` | 62 | `checkpoints.last().unwrap()` | 空列表时 panic |
| `interfaces/cli/src/cmd/init.rs` | 575,581,590 | `.find(...).unwrap()` | 目录结构不符预期时崩溃 |
| `interfaces/cli/src/tui/plugin_actions.rs` | 100 | `plugin_file.parent().unwrap()` | 路径解析失败时 panic |
| `interfaces/cli/src/tui/task_runtime.rs` | 450 | `child.lock().unwrap().kill()` | Mutex poisoned 时 panic |
| `interfaces/cli/src/cmd/checkpoint.rs` | 77 | `checkpoint.pending_approval.unwrap()` | 直接 unwrap Option |

**修复方案**:
- queue 模块: `is_some() + unwrap()` → `if let Some(store) = self.store.as_ref()`
- provider.rs: `.as_ref().unwrap().is_empty()` → `.as_ref().map_or(true, |v| v.is_empty())`
- FFI: `.unwrap()` → `.unwrap_or_else(|_| CString::new("error").unwrap())`
- daemon: `.bind().unwrap()` → `.bind().await?` 或错误日志+退出
- checkpoint/init/tui: 使用 `ok_or`/`context` 提供有意义的错误信息

---

### P2-1: 静默错误忽略 (86+ 处 `let _ =`)

**高风险忽略点**:

| 文件 | 行号 | 被忽略的操作 |
|------|------|-------------|
| `interfaces/cli/src/tui/task_runtime.rs` | 119, 141 | `sender.send(...)` — channel 发送失败 |
| `interfaces/cli/src/tui/session_store.rs` | 106-107 | `fs::write(...)` — 会话持久化失败 |
| `interfaces/cli/src/tui/provider_actions.rs` | 401, 424 | `provider_store.rename/remove` — 数据变更失败 |
| `interfaces/cli/src/runner.rs` | 122,136,333,410,418,447 | 多个初始化和错误记录操作 |
| `interfaces/cli/src/repl.rs` | 48,425,684,713,750 | provider 配置变更失败 |
| `interfaces/cli/src/version_check.rs` | 114,129,184 | 缓存写入/清理失败 |
| `interfaces/cli/src/tui/tui_entry.rs` | 70, 79 | `stty` 命令执行失败 |

**修复方案**: 关键操作（channel 发送、数据持久化、配置变更）改用 `if let Err(e) = ... { tracing::warn!(...) }` 或 `log::error!()` 记录错误；不关键的操作（stty、缓存清理）保留忽略但添加注释说明原因。

---

### P2-2: 重度 clone 使用 (565+ 处)

**最密集区域**:

- `runtime/src/orchestrator.rs` — ~30 处 clone，`context.clone()` 重复出现
- `runtime/src/provider/client.rs` — `messages.clone()` 每轮工具调用创建完整消息列表副本
- `runtime/src/memory/mod.rs` — `entry.content.clone()`, `entry.context.clone()` 反复出现
- `runtime/src/mcp/mod.rs` — `server.clone()`, `server_name.clone()`, `tool.clone()` 大量使用

**修复方案**: 渐进式优化——高频路径引入 `Arc` 减少克隆，低频路径保持 clone 确保正确性。

---

### P2-3: InMemoryStore.update_status 空操作

**文件**: `runtime/src/queue/mod.rs:396`

```rust
async fn update_status(&self, task_id: &str, _status: TaskQueueStatus) -> anyhow::Result<()> {
    // 获取了 _task 和 stored_task，但从未实际修改状态就重新插入了
    // 等效于无操作
}
```

**修复方案**: 实际更新 `stored_task.status` 字段后重新插入。

---

### P2-4: 空壳模块

| 文件 | 空结构体 |
|------|----------|
| `runtime/src/store/cache.rs` | `StoreCache` |
| `runtime/src/store/db.rs` | `StoreDb` |
| `runtime/src/streaming/sse.rs` | `SseStream` |
| `runtime/src/tools/code/ast.rs` | `AstEditor` |
| `runtime/src/tools/code/symbol.rs` | `SymbolIndex` |
| `runtime/src/tools/git/commit.rs` | `GitCommitTool` |

**修复方案**: 添加 `// TODO: implement` 注释标记，或在后续版本中按需实现。

---

### P3: 低优先级清理项

1. **TUI 渲染重复** (`interfaces/cli/src/tui/tui_entry.rs:164-178`): 相同渲染条件重复两次，提取为函数
2. **废弃 margin() API** (`interfaces/cli/src/tui/tui_entry.rs:91,110`): ratatui 0.28+ 已标记 deprecated，改用 `Layout::new().horizontal_margin()/vertical_margin()`
3. **反直觉条件** (`runtime/src/tools/fs/search.rs:74`): `result.stdout.is_empty() == false` → `!result.stdout.is_empty()`
4. **魔法数字** (`runtime/src/tools/task/spawn.rs:63`): `120_000` 提取为 `const DEFAULT_SPAWN_TIMEOUT_MS: u64 = 120_000;`
5. **stty 依赖** (`interfaces/cli/src/tui/tui_entry.rs`): 仅 Unix 有效，添加平台条件编译或注释
6. **id 命令依赖** (`runtime/src/sandbox/executor.rs`): `id -u` Windows 不存在，添加平台分支

---

## 修改文件清单

```
kernel/
├── src/model/provider.rs          # 定义 Provider URL 常量，修复 has_tool_calls/has_reasoning unwrap
├── src/model/config.rs            # 引用 kernel 常量替代硬编码 URL
└── src/ffi.rs                     # CString unwrap 防御性处理

runtime/
├── Cargo.toml                     # 可能新增 grep/ignore crate 依赖
├── src/queue/mod.rs               # 修复信号量泄漏、is_some+unwrap 反模式、update_status 空操作
├── src/tools/fs/search.rs         # 替换 grep 命令为跨平台方案、修复 is_empty()==false
├── src/tools/shell/exec.rs        # 修复 UTF-8 字节切片截断
├── src/tools/task/spawn.rs        # 魔法数字提取为常量
├── src/provider/client.rs         # 引用 kernel 常量替代硬编码 URL，优化 messages.clone()
├── src/daemon/handlers.rs         # TCP bind/listen unwrap 改为错误处理
├── src/checkpoint/mod.rs          # last().unwrap() 改为安全访问
├── src/workspace/mod.rs           # metadata/languages unwrap 改为安全写法
└── src/sandbox/executor.rs        # id 命令跨平台处理

interfaces/cli/
├── src/tui/tui_entry.rs           # 删除重复渲染逻辑，margin() 废弃 API 替换
├── src/tui/bootstrap.rs           # 引用 kernel 常量替代硬编码 URL
├── src/tui/provider_actions.rs    # 引用 kernel 常量替代硬编码 URL
├── src/tui/task_runtime.rs        # let _ = sender.send 改为错误处理
├── src/tui/session_store.rs       # fs::write 错误不再静默忽略
├── src/tui/plugin_actions.rs      # parent().unwrap() 改为安全访问
├── src/cmd/init.rs                # find().unwrap() 改为安全错误处理
├── src/cmd/checkpoint.rs          # unwrap 改为安全访问
├── src/repl.rs                    # 引用 kernel 常量替代硬编码 URL
└── src/runner.rs                  # let _ = 错误忽略改为日志记录
```

## 实施注意事项

1. **信号量修复**: `OwnedSemaphorePermit` 需要 `Arc<Semaphore>`，当前 `concurrency_semaphore` 是直接值类型，需改为 `Arc<Semaphore>`
2. **fs.search 重写**: 使用项目已有依赖 `ignore` + `regex` 手动实现，避免引入大型 `grep` crate
3. **URL 统一**: 需先确认 Mimo 正确的生产地址（`api.xiaomimimo.com` vs `token-plan-cn.xiaomimimo.com`）
4. **Blast radius**: 所有修复应保持 API 兼容，不改变公开接口签名
5. **测试验证**: 每个 P0/P1 修复后运行 `cargo test --workspace` 确保不引入回归
