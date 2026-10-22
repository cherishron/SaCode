# 手机 ↔ PC：Agent 桥协议

> **2026-10-14 更新：本文保留旧骨架记录，部分任务参数、认证报文、审批与续读说明已经过时。** 当前工作区契约以 [接入方案](<sa-code-mobile-integration-plan.md>) 为准，客户端落地/验证边界见 [实施记录](<sa-code-integration-progress.md>)。新 Android 设备入口为安全只读接入，旧任务与审批通道已禁用。
>
> 本文档原先描述 App 与 `sa-code` daemon 的通信契约。
> 所有结论逐条核对自 `sa-code/apps/daemon/src/*.cj`，不是设计意图的转述。
> 改协议前先改这里，再改代码——顺序反了就会出现"两边都以为对方这么发"。

## 1. 端点

daemon 只暴露三个网络端点（`daemon.cj:369-468`）：

| 端点 | 方法 | 用途 | 认证 |
|---|---|---|---|
| `/health` | GET | 最小存活信息 | 本机免认证；接入启用后非本机要 Bearer |
| `/rpc` | POST | **全部业务调用**（JSON-RPC 2.0） | 接入启用后每条都要过 gate |
| `/sse` | GET | 事件流 | 接入启用后建连即认证 |
| `/auth/enroll` | POST | 设备身份登记 | 仅接入启用时注册 |
| `/auth/token` | POST | 令牌兑换 | 同上 |

> `/health` 只返回 `{"status":"ok"}`（接入启用且认证通过时才附带 `sseSubscribers`）。
> `daemon.cj:367-368` 明确：**不含**能力、目录、设备列表。所以它不能用来判断"能做什么"。

## 2. 监听地址

- 默认 `127.0.0.1:18937`（`daemon.cj:285` + `remote_access.cj:350`）
- `--port <n>` 覆盖端口；`SACODE_REMOTE_BIND` 覆盖 bind
- 默认只监听回环。远程接入必须显式开启，且启动时会校验 TLS / 身份 / 策略，
  任一缺失即**拒绝启动**，不降级裸跑（`daemon.cj:296-302`）

> 注意端口是 **18937**，不是 sa-idp 开发环境的 8080。

## 3. JSON-RPC 帧

请求（`daemon.cj:50-60`）：

```json
{"jsonrpc": "2.0", "id": "1234-0", "method": "task/start", "params": {"prompt": "..."}}
```

硬性约束（违反直接回 `-32600`）：

- `jsonrpc` 必填且必须等于 `"2.0"`
- `id` **只接受字符串或整数**，其他类型一律拒（`daemon.cj:135-138`）
- `params` 若存在必须是对象（`daemon.cj:145` 的 `asObject()`）
- 请求体上限 1 MiB（`daemon.cj:31`）
- `Content-Type` 必须以 `application/json` 开头（`daemon.cj:105`）
- 只接受 POST

响应：

```json
{"jsonrpc":"2.0","id":"...","result":{...}}
{"jsonrpc":"2.0","id":"...","error":{"code":-32010,"message":"..."}}
```

> **关键**：`/rpc` 的处理器**从不设置 HTTP 状态码**（`daemon.cj:392-398` 只写
> `Content-Type` 与响应体）。所以业务失败也是 **HTTP 200**，失败信息在 `error` 帧里。
> 客户端不能靠 `isSuccess` 判成败，必须解析 JSON-RPC 帧。
> 仓库里 `AgentRpc.parseHttp()` 就是干这件事的，并有对应单测。

## 4. 方法

### daemon 自有（总是可用）

| 方法 | 返回 | 出处 |
|---|---|---|
| `initialize` | `{"protocolVersion":"0.1","capabilities":[...],"core":"cangjie","transport":"http-sse"}` | `daemon.cj:172-191` |
| `session/catalog` | `{"root":"...","entries":[{"id","title","durable","status","workspaceDirectory","current"}]}` | `daemon.cj:192-201` |
| `daemon/shutdown` | `{"ok":true}` | `daemon.cj:210-216` |

> `session/catalog` 的 `current` 恒为 `false`——`daemon.cj:196` 写死的字面量。
> 客户端不能依赖它做选中态。

### 转发宿主（需 `SACODE_HOST` 已配置）

白名单在 `host_proxy.cj:38-44`，**不在其中的一律 -32601**：

```
session/create  session/select  session/projection  session/submit  session/flush
workspace/get   workspace/set-directory
task/start      turn/poll       turn/cancel
worktree/enter  worktree/describe  worktree/exit
worktree/agent-prepare  worktree/agent-finish  worktree/cleanup
```

> `session/catalog` **不在**白名单里：`host_proxy.cj:35` 说明理由——它由 daemon 自己
> 按本地会话根回答，转调只会得到两个真源。
> `session/subscribe` 也不在：宿主的长连接通知由代理读线程统一收帧送 bus，
> 一次性 HTTP RPC 转它只会等到一个永远不来的应答。

### 转发团队宿主（需团队宿主已配置）

`team_host_bridge.cj:13-15`：

```
team/describe        team/member/create    team/message/send
team/message/broadcast  team/task/create   team/task/assign
team/task/claim      team/task/complete    team/member/stop
team/approval/answer
```

## 5. 能力驱动，不是版本驱动

daemon 的基础能力只有两项（`daemon.cj:38`）：

```json
["initialize", "session/catalog"]
```

其余能力**按运行时状态追加**（`daemon.cj:172-188`）：
- 团队宿主配置后 → 追加 `team/*` 与 `daemon/shutdown`
- 执行宿主配置后 → 追加宿主白名单里的方法

**宿主不可用时 daemon 不宣称其能力**——注释写得很明确（`daemon.cj:181-183`），
理由是"免得调用方按不存在的能力发请求"。

所以 App 的做法是：先 `initialize`，再按能力决定按钮是否可用
（`AgentPage.has(method)`）。不要按 App 版本或 daemon 版本猜能力——
同一台机器上，PC 有没有起宿主会直接改变清单。

## 6. 错误码

| 码 | 含义 | 出处 |
|---|---|---|
| `-32700` | 请求体不是合法 JSON | `daemon.cj:126` |
| `-32600` | id 非法 / jsonrpc 版本不对 / 字段缺失 / params 非对象 | `daemon.cj:138-154` |
| `-32601` | 方法不存在或不在白名单 | `daemon.cj:218`、`host_proxy.cj:53` |
| `-32602` | params 不合法 | `host_proxy.cj:54` |
| `-32001` | 鉴权/授权拒绝（附 `<denyReason>`） | `daemon.cj:159` |
| `-32002` | daemon 正在关闭 / 宿主已退出 | `daemon.cj:171`、`host_proxy.cj:55` |
| `-32003` | 分派过程抛异常（message 是异常原文） | `daemon.cj:219` |
| `-32005` | 超出并发限额（每设备 8 槽） | `daemon.cj:165` |
| `-32010` | 宿主未配置 | `host_proxy.cj:56` |
| `-32011` | 宿主应答超时（默认 30s） | `host_proxy.cj:57` |
| `-32012` | 宿主进程已退出 | `daemon.cj:206` 注释 |
| `-32013` | 转发前置失败 | `host_proxy.cj:58` |

用户可见文案统一走 `AgentRpc.describeError()`，不要各页面各写一份映射。

## 7. 事件流 `GET /sse`

`daemon.cj:436-443` 的行为：

```
: connected          ← 建连确认，是 SSE 注释不是数据
data: {"..."}        ← 真实事件
: keepalive          ← 空闲心跳，每秒一次
```

**必须过滤 `:` 开头的注释行**，否则会把心跳当事件解析。
`AgentSse.dataLine()` / `AgentSse.isComment()` 负责这件事，并有单测。

响应头：`Content-Type: text/event-stream`、`Cache-Control: no-cache`、
`Connection: keep-alive`、`transfer-encoding: chunked`。

状态码：非 GET 回 405；未过认证回 401；并发超限回 429（`daemon.cj:404-424`）。

## 8. App 侧对应实现

| 文件 | 职责 |
|---|---|
| `shared/.../agent/rpc/AgentRpc.kt` | 帧编解码、错误码文案、能力摘要、目录解析（纯函数，全单测） |
| `shared/.../agent/rpc/AgentMethods.kt` | 方法名与端点常量、`AgentSse` 事件解析 |
| `shared/.../agent/rpc/DaemonTransport.kt` | `POST /rpc`、`GET /sse`、能力门控 |
| `shared/.../agent/AgentLink.kt` | 链路枚举与探测契约（多目标） |
| `shared/.../agent/AgentRegistry.kt` | 绑定关系、断点续传游标 |
| `shared/.../feature/agent/AgentPage.kt` | 设备页 UI，能力驱动 |

## 9. 尚未落地的部分

- **`/auth/enroll` / `/auth/token` 的具体报文格式**：这两个端点属于"远程接入"
  扩展，**在未启用接入时不注册**（`daemon.cj:69-72`），不是"注册了返回 404"。
  启用后的报文形状还需在 daemon 侧确认后再写客户端，目前 App 侧不假设其结构。
- **审批的事件推送**：App 能主动调 `team/approval/answer`，但"有哪些待审批"
  从哪来（是否走 `/sse` 的事件）尚未确认。当前 UI 要求手动填 `approvalId`。
- **重连与断点续传**：`AgentResume` 已有游标结构，但 SSE 断线后的自动重连未实现。
