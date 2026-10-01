# SSE 流式输出稳定性增强 — 后续开发任务规划

> 关联文件：[runtime/src/streaming/sse.rs](../../runtime/src/streaming/sse.rs) · [runtime/src/daemon/events.rs](../../runtime/src/daemon/events.rs) · [runtime/src/daemon/types.rs](../../runtime/src/daemon/types.rs)
> 版本基线：v0.3 阶段一 1.1
> 文档创建：2026-08-03

## 一、背景与已交付成果

### 1.1 问题诊断

前序版本 SSE 流式输出存在三类端到端连通性断点：

| # | 缺口 | 根因 | 影响 |
|---|------|------|------|
| 1 | 任务终结后流不关闭 | `stream_from_broadcast` 仅依赖 broadcast Closed 退出 | 订阅特定任务的客户端无限挂起，无法感知结束 |
| 2 | broadcast Lagged 静默丢弃 | `Lagged(_) => continue` 不通知消费方 | 关键 `task_completed` 丢失，客户端无法判断任务结束 |
| 3 | executor→daemon forwarder Lagged 静默 | `events.rs` forwarder 同样 `continue` | executor 产生的事件从 daemon 断流，SSE 客户端永久漏事件 |
| 4 | 无断线重连续传机制 | broadcast 不缓存历史，无 Last-Event-ID 支持 | 网络抖动导致事件永久丢失，端到端流式任务无法保证无中断 |
| 5 | broadcast 容量偏小 | executor/daemon 各 100，单任务多事件突发易溢出 | 慢消费方触发 Lagged 概率高 |
| 6 | KeepAlive 默认无文本 | `KeepAlive::default()` 发空注释 `:` | 部分代理/客户端误判为空数据 |

### 1.2 已交付的全面修复（本期完成）

| 修复项 | 文件 | 行为变更 |
|--------|------|----------|
| **A. 任务终结自动关闭流** | [sse.rs](../../runtime/src/streaming/sse.rs) | `task_filter` 非空且收到 `task_completed`/`task_failed`/`task_cancelled` 时 yield 后 break；全局 `/events` 不关闭 |
| **B. Lagged 提示事件** | [sse.rs](../../runtime/src/streaming/sse.rs) | 消费侧 Lagged 时发出 `event: lagged`（含 skipped 数与 hint），消费方可补偿拉取 |
| **C. forwarder Lagged 可观测化** | [events.rs](../../runtime/src/daemon/events.rs) | executor→daemon forwarder Lagged 时 `tracing::warn` 记录，不再静默 |
| **D. 事件历史缓冲（EventHistory）** | [types.rs](../../runtime/src/daemon/types.rs) | `Arc<EventHistory>` 环形缓冲 256 条事件 + AtomicU64 递增 seq，push/sync 同步可用 |
| **E. Last-Event-ID 续传** | [sse.rs](../../runtime/src/streaming/sse.rs) + [events.rs](../../runtime/src/daemon/events.rs) | `/events/:id`、`/api/stream?task_id=` 接受 `Last-Event-ID` header，回放 seq > last 的历史后切 live，seq 去重防重复 |
| **F. broadcast 容量提升** | [executor/mod.rs](../../runtime/src/executor/mod.rs) + [types.rs](../../runtime/src/daemon/types.rs) | executor/daemon 各提升到 256（`EXECUTOR_EVENT_BUS_CAPACITY` / `DAEMON_EVENT_BUS_CAPACITY` 常量），与 `agents::message_bus` 对齐 |
| **G. KeepAlive 显式化** | [sse.rs](../../runtime/src/streaming/sse.rs) | `interval=15s` + `text="ping"`，跨代理兼容 |
| **H. StreamEvent.seq 字段** | [types.rs](../../runtime/src/daemon/types.rs) | `#[serde(skip)] pub seq: Option<u64>`，作为 SSE `id` 字段下发，不污染 data payload |
| **I. 单元测试覆盖** | [sse.rs](../../runtime/src/streaming/sse.rs) | 7 个测试：流关闭、过滤、lagged 提示、全局不关闭、history push/replay、环形淘汰、replay+live 去重 |

### 1.3 验证结果

| 验证项 | 结果 |
|--------|------|
| `cargo check --workspace` | 通过（无 error，仅预存在 warning） |
| 灵枢 smoke test（`cargo test -p sacode-runtime --lib ling_shu`） | 11/11 通过 |
| runtime 全量测试 | 286 passed / 11 预存在失败（279 基线 + 7 新增测试），无新增回归 |
| daemon SSE 相关测试 | `test_daemon_api_stream_endpoint_streams_sse`、`test_daemon_events_endpoint_streams_sse`、`test_daemon_api_stream_task_event_contains_normalized_fields`、`test_daemon_api_stream_endpoint_supports_task_filter`、`test_daemon_task_events_endpoint_filters_by_task_id`、`test_daemon_emit_event_normalizes_payload_shape` 全通过 |

---

## 二、后续开发任务规划

后续任务按优先级分四个阶段，每个任务明确目标、优先级、时间节点、所需资源、技术方案、验收标准。

### 阶段一 P0 — 端到端集成验证与可观测性补全

#### 任务 1.1 SSE 端到端集成测试（HTTP 层）

| 维度 | 内容 |
|------|------|
| **任务目标** | 在 `runtime/src/tests/daemon_queue.rs` 补充 HTTP 层集成测试，覆盖 Last-Event-ID 续传、任务终结流关闭、lagged 补偿全链路 |
| **优先级** | P0 |
| **时间节点** | v0.3.1（紧跟本期修复） |
| **所需资源** | 复用现有 `test_daemon_api_stream_endpoint_streams_sse` 测试基础设施；无需新依赖 |
| **技术方案** | 1. 构造 `DaemonState` 写入若干 `EventHistory` 事件<br>2. 用 `axum::test` 或 `tokio::net::TcpListener` 启动 daemon<br>3. 客户端携带 `Last-Event-ID` header 请求 `/events/:id`，断言响应中包含 replay 事件 + live 事件<br>4. 验证 `Event::id` 字段通过 HTTP 响应正确下发（解析 SSE 帧） |
| **验收标准** | 1. 新增 ≥3 个集成测试覆盖 replay/live/terminal 三场景<br>2. 测试在 `cargo test -p sacode-runtime --test daemon_queue` 下通过<br>3. 无新增 flaky 测试 |

#### 任务 1.2 SSE 流量与 lagged 指标埋点

| 维度 | 内容 |
|------|------|
| **任务目标** | 暴露 SSE 流量指标（连接数、事件吞吐、lagged 次数），接入 daemon `/api/health` 或新增 `/api/metrics` |
| **优先级** | P0 |
| **时间节点** | v0.3.1 |
| **所需资源** | `parking_lot` 或 `std::sync::atomic` 计数器；可选 `prometheus` crate |
| **技术方案** | 1. `DaemonState` 增加 `metrics: Arc<SseMetrics>`（AtomicU64 连接数、事件数、lagged 数）<br>2. `stream_from_broadcast_with_replay` 入口 inc 连接数，出口 dec<br>3. forwarder Lagged 分支 inc lagged 计数<br>4. `/api/health` 响应附带 metrics 快照 |
| **验收标准** | 1. `/api/health` 返回 `sse_connections`/`sse_events_sent`/`sse_lagged_total`<br>2. 集成测试验证计数器在连接/断开/lagged 后正确变化 |

### 阶段二 P1 — 持久化与跨重启恢复

#### 任务 2.1 EventHistory 持久化到 `.sacode/event_history.jsonl`

| 维度 | 内容 |
|------|------|
| **任务目标** | daemon 重启后保留最近 N 条事件历史，支持跨重启的 Last-Event-ID 续传 |
| **优先级** | P1 |
| **时间节点** | v0.3.2（配合阶段一 1.2 持久化任务存储） |
| **所需资源** | 复用 `StoreDb` 持久化模式；JSON 行格式 |
| **技术方案** | 1. `EventHistory` 增加 `flush_to_disk(path)` / `load_from_disk(path)`<br>2. daemon 启动时加载 `.sacode/event_history.jsonl`<br>3. 每次 `push` 后异步 flush（节流，如每 100ms 或每 16 条）<br>4. 文件轮转：单文件 ≤1MB，保留最近 1 个轮转 |
| **验收标准** | 1. daemon 重启后 `/events/:id` 携带 Last-Event-ID 仍能回放重启前事件<br>2. 持久化不阻塞主路径（异步 flush）<br>3. 文件损坏时降级为空历史，不 panic |

#### 任务 2.2 任务状态与事件历史一致性保证

| 维度 | 内容 |
|------|------|
| **任务目标** | 确保任务终结事件（`task_completed` 等）写入 history 与 `tasks` 状态更新原子化 |
| **优先级** | P1 |
| **时间节点** | v0.3.2 |
| **所需资源** | 现有 `RwLock<HashMap<String, TaskStatus>>` |
| **技术方案** | 1. `update_task_status_from_executor_event` 与 `history.push` 顺序约束：先 push history 再更新 status（或反之，明确文档）<br>2. 重连客户端若 Last-Event-ID 命中终结事件，应能从 `/task/:id/status` 确认终态<br>3. 测试：任务完成后立即重连，验证 history replay 与 status 一致 |
| **验收标准** | 1. 新增一致性测试：任务终结后 history 与 status 同步<br>2. 无 race condition 导致的 status 与事件不一致 |

### 阶段三 P1 — 客户端 SDK 与协议文档

#### 任务 3.1 SSE 客户端重连规范文档

| 维度 | 内容 |
|------|------|
| **任务目标** | 在 `docs/reference/API.md` 补充 SSE 协议规范，包含事件类型、id 字段、重连流程、lagged 补偿策略 |
| **优先级** | P1 |
| **时间节点** | v0.3.2 |
| **所需资源** | 无 |
| **技术方案** | 1. 文档化所有事件类型（`task_started`/`tool_call_started`/`task_completed`/`task_failed`/`task_cancelled`/`lagged`）<br>2. 说明 `Last-Event-ID` header 用法<br>3. 说明 `id` 字段语义（递增 seq）<br>4. 说明 lagged 事件的补偿路径（重连 + `/task/:id/status`） |
| **验收标准** | 1. API.md 新增 SSE 章节<br>2. 包含可运行的 curl 示例 |

#### 任务 3.2 TypeScript/Python 客户端 SDK 原型

| 维度 | 内容 |
|------|------|
| **任务目标** | 提供 `npm-package/` 下的 SSE 客户端封装，自动处理重连与 Last-Event-ID |
| **优先级** | P2 |
| **时间节点** | v0.4 |
| **所需资源** | TypeScript；`EventSource` 或 `fetch` + ReadableStream |
| **技术方案** | 1. `SacodeSseClient` 类，构造参数 `{ baseUrl, taskId? }`<br>2. 自动记录最后收到的 `id`，重连时携带 `Last-Event-ID`<br>3. 收到 `lagged` 事件时触发 `onLagged` 回调，消费方可选拉取 `/task/:id/status`<br>4. 收到终结事件时自动关闭连接 |
| **验收标准** | 1. SDK 单元测试覆盖重连场景<br>2. 示例：中断网络后恢复，任务事件无丢失 |

### 阶段四 P2 — 高级特性

#### 任务 4.1 事件历史分 task_id 索引

| 维度 | 内容 |
|------|------|
| **任务目标** | EventHistory 支持 `replay_after(task_id, last_seq)`，仅回放特定任务事件，避免全局回放成本 |
| **优先级** | P2 |
| **时间节点** | v0.5 |
| **所需资源** | 现有 `EventHistory`，新增 `task_id → Vec<seq>` 索引 |
| **技术方案** | 1. EventHistory 增加 `task_index: HashMap<String, VecDeque<u64>>`<br>2. push 时同步更新 task_index<br>3. replay_after 支持按 task_id 过滤，减少回放数据量 |
| **验收标准** | 1. 全局 `/events` 重连性能不退化<br>2. 单任务回放数据量 ≤ 单任务事件数 |

#### 任务 4.2 broadcast 背压与降级策略

| 维度 | 内容 |
|------|------|
| **任务目标** | 当 lagged 频繁触发时，自动降级（如丢弃非关键事件）或限流新连接 |
| **优先级** | P2 |
| **时间节点** | v0.5 |
| **所需资源** | 现有 metrics（依赖任务 1.2） |
| **技术方案** | 1. metrics 检测 lagged 频率超阈值<br>2. 降级策略：优先保留终结事件与高优先级任务事件<br>3. 限流：新连接返回 503 + Retry-After |
| **验收标准** | 1. 压测下 lagged 频率下降<br>2. 终结事件在背压下不丢失 |

#### 任务 4.3 SSE 流式输出压缩

| 维度 | 内容 |
|------|------|
| **任务目标** | 启用 HTTP gzip 压缩，减少高吞吐场景带宽占用 |
| **优先级** | P2 |
| **时间节点** | v0.5+ |
| **所需资源** | `tower_http::compression` |
| **技术方案** | 1. daemon router 启用 `CompressionLayer`<br>2. 注意 SSE 流式压缩与 KeepAlive 的兼容性 |
| **验收标准** | 1. 响应头包含 `Content-Encoding: gzip`<br>2. KeepAlive 仍正常工作 |

---

## 三、风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| EventHistory 内存占用随任务数增长 | 当前 256 条 × 单事件 ~1KB ≈ 256KB，可接受；后续若任务数爆炸再引入分 task_id 索引（任务 4.1） |
| Last-Event-ID replay 与 live 之间的微小重复窗口 | 已通过 seq 去重过滤；客户端可通过 seq 幂等处理 |
| 持久化 flush 阻塞主路径 | 任务 2.1 采用异步 flush + 节流，不阻塞 push |
| 客户端不实现 Last-Event-ID 重连 | 文档明确（任务 3.1）；SDK 原型自动处理（任务 3.2） |

---

## 四、验收追踪矩阵

| 任务 | 优先级 | 状态 | 验收测试 | 关联文件 |
|------|--------|------|----------|----------|
| 本期已交付（A-I） | P0 | ✅ 完成 | 7 单元测试 + 灵枢 11/11 + runtime 无新增回归 | sse.rs / events.rs / types.rs / executor/mod.rs |
| 1.1 集成测试 | P0 | ⏳ 待启动 | ≥3 HTTP 层测试 | tests/daemon_queue.rs |
| 1.2 metrics 埋点 | P0 | ⏳ 待启动 | /api/health 返回指标 | types.rs / handlers.rs |
| 2.1 history 持久化 | P1 | ⏳ 待启动 | 跨重启续传测试 | types.rs / daemon 启动 |
| 2.2 一致性保证 | P1 | ⏳ 待启动 | 终结事件与 status 一致测试 | events.rs |
| 3.1 协议文档 | P1 | ⏳ 待启动 | API.md 新增章节 | docs/reference/API.md |
| 3.2 客户端 SDK | P2 | ⏳ 待启动 | SDK 单元测试 | npm-package/ |
| 4.1 task_id 索引 | P2 | ⏳ 待启动 | 全局回放性能测试 | types.rs |
| 4.2 背压降级 | P2 | ⏳ 待启动 | 压测 lagged 频率下降 | events.rs / sse.rs |
| 4.3 压缩 | P2 | ⏳ 待启动 | 响应头验证 | daemon/mod.rs |

---

## 五、变更摘要（本期）

**修改文件**：
- [runtime/src/streaming/sse.rs](../../runtime/src/streaming/sse.rs) — 重构为 `build_sse_response` + `filter_stream_events` + `replay_then_live_stream`，新增 Last-Event-ID replay、seq 注入 Event::id、7 个单元测试
- [runtime/src/daemon/events.rs](../../runtime/src/daemon/events.rs) — emit_event/forwarder 写入 history、forwarder Lagged tracing::warn、SSE 端点接受 Last-Event-ID
- [runtime/src/daemon/types.rs](../../runtime/src/daemon/types.rs) — `EventHistory` 结构、`StreamEvent.seq` 字段、`DAEMON_EVENT_BUS_CAPACITY` 常量、容量 100→256
- [runtime/src/executor/mod.rs](../../runtime/src/executor/mod.rs) — `EXECUTOR_EVENT_BUS_CAPACITY` 常量、容量 100→256
- [runtime/src/daemon/mod.rs](../../runtime/src/daemon/mod.rs) — 导出 `EventHistory` / `DAEMON_EVENT_BUS_CAPACITY`

**新增能力**：端到端 SSE 流式任务无中断（任务终结流关闭 + lagged 提示 + 断线重连续传 + 容量提升 + 可观测性）
