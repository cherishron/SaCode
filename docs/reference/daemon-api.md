# Daemon HTTP、SSE 与审批 API

本文档描述 `sacode serve` 暴露的本地 daemon 协议。实现真源位于 `runtime/src/daemon/` 与 `runtime/src/streaming/sse.rs`。

## 启动与安全边界

```bash
sacode serve
sacode serve --host=127.0.0.1 --port=8080
```

默认监听 `127.0.0.1:8080`。daemon 当前不提供内建认证、授权或 TLS，并且能够创建任务、取消任务和批准具有副作用的工具调用，因此默认安全假设是：

- 仅由本机可信用户访问；
- 启动目录就是任务工作目录与本地状态存储基准；
- 不把端口直接暴露到局域网、公网或不可信容器网络；
- 如需绑定非 loopback 地址，应在前置代理或网络层补充 TLS、强认证、来源限制与防火墙规则。

不建议使用 `--host=0.0.0.0` 直接对外提供服务。审批端点不是认证机制，能够访问 daemon 的调用方也能够提交审批结果。

## 路由概览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查与版本 |
| POST | `/task` | 创建任务 |
| GET | `/task/:id/status` | 查询任务状态 |
| GET | `/task/:id/result` | 查询任务结果 |
| GET | `/task/:id/checkpoint` | 按任务查询 checkpoint |
| POST | `/task/:id/retry` | 重试失败任务 |
| POST | `/task/:id/cancel` | 取消任务，并清理该任务的待审批请求 |
| POST | `/task/:id/approve` | 回传一次审批结果 |
| GET | `/task/:id/approvals` | 查询任务当前待审批列表，用于客户端恢复 |
| GET | `/metrics` | 查询 daemon 审批指标快照 |
| GET | `/events` | 全局 SSE；不支持历史回放 |
| GET | `/events/:id` | 单任务 SSE；支持 `Last-Event-ID` |
| GET | `/api/stream` | 统一 SSE；可用 `task_id` 查询参数过滤 |
| GET | `/tools` | 列出内置工具 |
| GET | `/queue/status` | 查询队列统计 |
| GET | `/queue/pending` | 查询待处理数量 |

## 创建与跟踪任务

创建 Build 模式任务：

```bash
curl -X POST http://127.0.0.1:8080/task \
  -H "content-type: application/json" \
  -d '{"prompt":"分析代码结构","mode":"build"}'
```

请求字段：

| 字段 | 必填 | 说明 |
|------|------|------|
| `prompt` | 是 | 任务文本 |
| `mode` | 是 | `plan`、`build`、`auto`；旧值 `yolo` 按 `auto` 处理，其他未知值回退为 `build` |
| `priority` | 否 | `low`、`normal`、`high`、`urgent`；未知值按 `normal` 处理 |
| `dependencies` | 否 | 前置任务 ID 数组 |
| `retry_policy` | 否 | 重试策略对象 |
| `scheduled_at` | 否 | 调度时间元数据 |
| `deadline` | 否 | 截止时间元数据 |

返回示例：

```json
{
  "task_id": "task-1717670400000",
  "status": "queued",
  "message": "Task created and submitted to queue",
  "queue_status": "running"
}
```

使用返回的 `task_id` 查询状态或结果：

```bash
curl http://127.0.0.1:8080/task/task-1717670400000/status
curl http://127.0.0.1:8080/task/task-1717670400000/result
```

除审批端点外，部分 daemon 路由当前会用 JSON 字段表达业务错误而不是切换 HTTP 状态码；调用方应同时检查 HTTP 状态与响应体中的 `status`、`error`、`message`。

## SSE 协议

### 入口与生命周期

| 入口 | 过滤 | `Last-Event-ID` 回放 | 终结事件后关闭 |
|------|------|----------------------|----------------|
| `/events` | 无 | 否 | 否 |
| `/events/:id` | 路径中的任务 ID | 是 | 是 |
| `/api/stream` | 无 | 是 | 否 |
| `/api/stream?task_id=<ID>` | 查询参数中的任务 ID | 是 | 是 |

单任务流在收到 `task_completed`、`task_failed` 或 `task_cancelled` 后关闭。全局流保持打开。服务端每 15 秒发送文本为 `ping` 的 SSE keep-alive 注释。

每个事件使用标准 SSE 字段：

```text
id: 42
event: approval_requested
data: {"task_id":"task-1","event_type":"approval_requested","timestamp":"...","payload":{...}}
```

- `id` 是 daemon 进程内递增的事件序号，用于断线续传；daemon 重启后不要假设序号连续。
- `event` 与 JSON 中的 `event_type` 一致。
- `data` 是 JSON 对象。

### 稳定 data 结构

```json
{
  "task_id": "task-1",
  "event_type": "tool_call_started",
  "timestamp": "2026-09-03T01:00:00Z",
  "payload": {
    "name": "fs.write",
    "input": { "path": "README.md" }
  },
  "name": "fs.write",
  "input": { "path": "README.md" }
}
```

稳定字段是 `task_id`、`event_type`、`timestamp` 和 `payload`。为兼容旧消费方，`payload` 的对象字段目前还会复制到 data 顶层；新客户端应优先读取 `payload.*`，并可将顶层字段作为兼容回退。

常见事件包括：

- 任务：`task_created`、`task_started`、`task_completed`、`task_failed`、`task_cancelled`；
- 输出：`message`、`thinking`；
- 工具：`tool_call_started`、`tool_call_finished`；
- 重试：`retry_scheduled`、`retry_started`；
- 审批：`approval_requested`、`approval_resolved`；
- 流控：`lagged`。

收到 `lagged` 表示客户端消费过慢，broadcast 中已有事件被跳过。调用方应使用最后成功处理的 SSE `id` 重连，或查询 `/task/:id/status` 和 `/task/:id/result` 对账。

### Last-Event-ID

单任务或统一流重连示例：

```bash
curl -N http://127.0.0.1:8080/api/stream?task_id=task-1 \
  -H "Accept: text/event-stream" \
  -H "Last-Event-ID: 41"
```

服务端会先从内存事件历史中回放 `id > 41` 的事件，再切到 live 流，并按序号去重。历史缓冲当前最多保留 256 条事件；它不是持久化日志，也不保证覆盖长时间离线、超高事件量或 daemon 重启。

`/events` 不读取 `Last-Event-ID`。需要续传时使用 `/events/:id` 或 `/api/stream`。

## 审批协议

### 触发条件与默认行为

当前 daemon 在 `build` 模式下对非 `mcp.*` 工具走交互式审批。每次审批使用独立 `approval_id`，同一任务中的连续或并发审批不会互相覆盖。

安全默认值：

- 未收到有效审批时不执行该工具调用；
- 等待 300 秒后自动拒绝，并发出 `reason: "timeout"`；
- 任务取消或审批通道关闭时拒绝，并发出 `reason: "cancelled"`；
- 服务端先登记 pending 审批，再发布 `approval_requested`，避免客户端立即回传时遇到注册竞态。

### approval_requested

```text
event: approval_requested
data: {
  "task_id": "task-1",
  "event_type": "approval_requested",
  "timestamp": "2026-09-03T01:00:00Z",
  "payload": {
    "approval_id": "task-1-7",
    "tool_name": "fs.write",
    "side_effect_level": "Modify",
    "args": { "path": "README.md", "content": "..." }
  }
}
```

字段说明：

| 字段 | 说明 |
|------|------|
| `approval_id` | 一次性审批标识；必须原样回传 |
| `tool_name` | 待执行工具名 |
| `side_effect_level` | 工具副作用级别的字符串表示 |
| `args` | 待执行工具参数；UI 应在批准前向用户展示关键操作与目标 |

客户端不得仅用 `task_id` 回传审批，也不得把旧 `approval_id` 用于后续请求。

### GET /task/:id/approvals

客户端可在首次订阅或 SSE 重连成功后查询任务当前仍在等待的审批：

```bash
curl http://127.0.0.1:8080/task/task-1/approvals
```

响应示例：

```json
{
  "task_id": "task-1",
  "approvals": [
    {
      "approval_id": "task-1-7",
      "task_id": "task-1",
      "tool_name": "fs.write",
      "side_effect_level": "Modify",
      "args": { "path": "README.md", "content": "..." },
      "waited_secs": 12,
      "timeout_secs": 300,
      "expires_in_secs": 288
    }
  ]
}
```

无待审批时返回 200 和空数组。该接口只反映 daemon 进程内当前 pending 状态，不恢复 daemon 重启前的审批；重启会关闭原审批通道并安全拒绝。客户端应按 `approval_id` 与已处理事件/UI 去重。

### POST /task/:id/approve

批准：

```bash
curl -X POST http://127.0.0.1:8080/task/task-1/approve \
  -H "content-type: application/json" \
  -d '{"approval_id":"task-1-7","approved":true}'
```

只批准多文件 `fs.apply_patch` 中经审阅的文件：

```bash
curl -X POST http://127.0.0.1:8080/task/task-1/approve \
  -H "content-type: application/json" \
  -d '{"approval_id":"task-1-7","approved":true,"reason":"diff_review_partial","args_override":{"paths":["src/a.rs","src/b.rs"]}}'
```

`args_override` 不是通用参数重写接口。daemon 只接受 `fs.apply_patch.paths` 白名单；如果原工具调用已带 `paths`，覆盖值只能缩小该集合、不能扩大。校验失败返回 400 且不消费 pending 审批；原始 `patch`、`check` 等字段仍由 daemon 保存的审批请求决定。

拒绝并附理由：

```bash
curl -X POST http://127.0.0.1:8080/task/task-1/approve \
  -H "content-type: application/json" \
  -d '{"approval_id":"task-1-7","approved":false,"reason":"user_denied"}'
```

请求字段：

| 字段 | 必填 | 约束 |
|------|------|------|
| `approval_id` | 是 | 非空字符串，必须属于路径中的任务 |
| `approved` | 是 | JSON boolean |
| `reason` | 否 | 字符串，最多 128 字节 |
| `args_override` | 否 | 仅 `approved=true` 的 `fs.apply_patch` 支持；对象只能包含 `paths`，值为 1–128 个非空路径字符串 |

响应状态：

| HTTP | 含义 | 客户端处理 |
|------|------|------------|
| 200 | 本次审批已被接收并消费 | 等待 `approval_resolved` 或后续任务事件 |
| 400 | 缺字段、字段类型错误或 `reason` 过长 | 修正请求；不要盲目重试相同错误 |
| 404 | `approval_id` 不存在、已处理、已超时或已因取消而清理 | 视为陈旧审批；查询任务状态，不要尝试用它批准后续调用 |
| 409 | `approval_id` 属于另一任务 | 丢弃错误的任务/审批配对并重新同步 |

幂等语义是“一次性消费”，不是“重复请求都返回 200”：第一次有效提交消费 pending 项；相同请求再次提交返回 404。该设计确保迟到或重复响应不能批准下一次工具调用。

200 响应示例：

```json
{
  "task_id": "task-1",
  "approval_id": "task-1-7",
  "status": "resolved",
  "approved": false,
  "reason": "user_denied"
}
```

### approval_resolved

```text
event: approval_resolved
data: {
  "task_id": "task-1",
  "event_type": "approval_resolved",
  "timestamp": "2026-09-03T01:00:05Z",
  "payload": {
    "approval_id": "task-1-7",
    "approved": false,
    "reason": "user_denied"
  }
}
```

`reason` 可省略。daemon 自动产生的理由包括 `timeout` 与 `cancelled`；客户端也可以提交不超过 128 字节的自定义理由。

### GET /metrics

`/metrics` 返回 daemon 生命周期内累计的审批指标：

```json
{
  "approval": {
    "requested": 8,
    "pending": 1,
    "approved": 4,
    "denied": 1,
    "timed_out": 1,
    "cancelled": 1,
    "resolved": 7,
    "total_wait_ms": 18342,
    "avg_wait_ms": 2620
  }
}
```

- `pending` 是查询时实时待审批深度；
- `requested` 在审批登记后累加；
- `approved`、`denied`、`timed_out`、`cancelled` 为互斥终态计数；
- `resolved` 是四种终态计数之和；
- `total_wait_ms` 与 `avg_wait_ms` 只统计已解决审批；
- 指标保存在内存中，daemon 重启后归零。

### 审批事件与断线回放

`approval_requested` 和 `approval_resolved` 与其他事件一样进入 256 条内存历史。使用 `Last-Event-ID` 重连时可能出现以下情况：

1. 只回放 `approval_requested`：它通常仍在等待，或正处于审批提交/结果事件发射的竞态边界；尝试回传时以 HTTP 结果为准。
2. 同时回放 requested 与 resolved：按 `approval_id` 关联，resolved 表示该请求已结束，不应再次弹窗。
3. 只回放 `approval_resolved`：客户端应清理同 ID 的本地待处理 UI。
4. requested 已陈旧：回传会得到 404，客户端应关闭该审批 UI 并查询任务状态。

客户端应按 `approval_id` 去重，而不是按工具名或任务 ID 去重。当前 VSCode 扩展会携带 `Last-Event-ID` 自动重连，并在每次连接成功后查询 `/task/:id/approvals` 对账；事件回放与查询结果共享同一个去重器，因此同一审批不会重复弹窗。自定义客户端若实现自动重连，也必须保持同等语义。

## 兼容性约定

- 新客户端读取 `payload`，可回退到 data 顶层字段。
- `approval_id` 是审批回传的必填字段；不支持该字段的旧客户端无法完成新审批，最终会安全拒绝。
- 未识别的事件类型应被忽略或记录，不应导致 SSE 连接整体失败。
- 单任务消费者应同时处理 SSE 终结事件和 HTTP 状态查询，不能把网络断开直接等同于任务完成。

VSCode 扩展的安装、daemon 自动管理和审批排障参见 [VSCode 扩展使用与排障](../guides/vscode-extension.md)。
