# Desktop 与多 Agent 客户端实施计划

> 状态：待执行
> 日期：2026-09-20
> 对应 PRD：[SaCode Desktop 与多 Agent 客户端 PRD](../product/desktop-multi-agent-prd.md)

## 1. 实施目标

在不回退 CLI/TUI/VSCode 现有能力的前提下，交付：

1. Tauri Desktop 客户端；
2. VSCode/Desktop 共用的 client-core；
3. daemon 可插拔 Agent Backend；
4. 通用 ACP stdio Client；
5. OpenCode ACP Adapter；
6. 统一审批、事件、取消、审计和恢复；
7. 跨平台构建与发布门禁。

实施遵循“协议先行、原生 Backend 先行、OpenCode 后接入、最后发布”的顺序。

## 2. 目录迁移策略

### 2.1 目标目录

```text
SaCode/
├── Cargo.toml
├── kernel/
├── runtime/
│   └── src/
│       └── agent_backends/
│           ├── mod.rs
│           ├── registry.rs
│           ├── native.rs
│           └── acp.rs
├── integrations/
│   └── acp/
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs
│           ├── protocol.rs
│           ├── framing.rs
│           ├── client.rs
│           ├── transport.rs
│           └── process.rs
├── interfaces/
│   ├── cli/
│   ├── acp/
│   │   └── src/server/
│   ├── lsp/
│   ├── client-core/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   ├── vscode/
│   └── desktop/
│       ├── package.json
│       ├── src/
│       └── src-tauri/
├── docs/
└── scripts/
```

### 2.2 不立即调整的目录

以下目录首期保持位置不变：

- `interfaces/vscode`
- `interfaces/cli`
- `interfaces/lsp`
- `npm-package`
- `runtime/src/daemon`

原因：它们已被 CI、发布脚本、文档或 npm/VSIX 产物引用。首期只通过依赖和模块抽取改变职责，不做无收益搬迁。

### 2.3 迁移顺序

1. 新增 `integrations/acp`，先不改现有 ACP Server。
2. 为通用 ACP 类型添加 fixture 测试。
3. 让 `interfaces/acp` 渐进引用通用类型。
4. 新增 `runtime/agent_backends`，先封装 native 路径。
5. daemon 接入 BackendRegistry，但保持默认行为。
6. 新增 `interfaces/client-core`，迁移 VSCode 通用逻辑。
7. 新增 Desktop。
8. 最后接入 OpenCode ACP Adapter。

## 3. 版本切片与依赖

```text
M0 决策与协议冻结
  ↓
M1 client-core 抽取 ─────────┐
  ↓                          │
M2 Desktop + SaCode Backend  │
                             │
M3 ACP Protocol/Client ──────┤
  ↓                          │
M4 OpenCode Backend ◄────────┘
  ↓
M5 安全、恢复、发布
```

M1 与 M3 可以并行，但 M2 依赖 M1，M4 依赖 M2/M3。

## 4. M0：协议与架构冻结

### 4.1 交付物

- 本 PRD 与实施计划合入；
- `AgentDescriptor`、`AgentCapabilities`、内部 `AgentEvent` 草案；
- `AgentEvent` 到现有 Task Protocol/SSE 的投影表，明确它不是第二套客户端公开协议；
- `TaskRequest.backend_id/session_id` 兼容策略；
- daemon token 方案；
- OpenCode 目标版本和 ACP 命令记录；
- ACP transcript fixture；
- ADR：为什么 Agent Backend 不等于 Provider。

### 4.2 代码任务

1. 在 kernel 定义最小稳定类型：
   - `AgentBackendId`；
   - `AgentDescriptor`；
   - `AgentCapabilities`；
   - `AgentEvent`；
   - Backend 失败码。
2. `TaskRequest` 增加可选 `backend_id`、`session_id`。
3. TaskSnapshot 增加可选 Backend 元数据，协议版本按兼容规则升级。
4. 更新 `docs/reference/daemon-api.md` 草案。

### 4.3 验收

- 旧 TaskRequest JSON 可继续反序列化；
- 新字段缺失默认 `sacode`；
- 新 daemon 对旧 VSCode contract 测试通过；
- kernel 类型无 I/O 依赖。

## 5. M1：client-core 抽取

### 5.1 目标

消除 VSCode 与 Desktop 之间的 HTTP/SSE/审批协议重复。

### 5.2 新增包

client-core 拆为协议/状态机与可注入 transport，避免 Desktop WebView 为复用代码而直接持有 daemon bearer token：

```text
interfaces/client-core/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── transport.ts
│   ├── daemon-client.ts
│   ├── event-stream.ts
│   ├── task-protocol.ts
│   ├── approval-client.ts
│   ├── agent-types.ts
│   ├── errors.ts
│   └── validators.ts
└── test/
```

### 5.3 从 VSCode 迁出的逻辑

- `SseClient` 的 HTTP/SSE 通用状态机，具体 transport 可由 Node fetch 或 Tauri IPC 注入；
- Task Protocol 类型和运行时解析；
- `Last-Event-ID` 重连；
- pending approvals 对账；
- approval submit；
- daemon 版本/协议 capability 判断；
- 与 VSCode API 无关的 Diff 数据结构。

保留在 VSCode：

- `vscode.window` UI；
- QuickPick；
- Diff Editor；
- ExtensionContext；
- 状态栏；
- VSCode 配置读取。

### 5.4 验收

- VSCode 功能和 VSIX 产物不变；
- client-core 单测覆盖断线、重放、非法 payload、审批恢复和 transport contract；
- Desktop WebView 使用 Tauri IPC transport，daemon token 只存在于 Rust shell；
- VSCode 不再包含第二份 HTTP/SSE parser；
- `node scripts/check-vscode-release.js` 继续通过。

## 6. M2：Desktop MVP + SaCode Native Backend

### 6.1 初始化 Desktop

新增：

```text
interfaces/desktop/
├── package.json
├── vite.config.ts
├── src/
│   ├── app/
│   ├── components/
│   ├── features/session/
│   ├── features/approval/
│   ├── features/changes/
│   ├── features/settings/
│   └── services/
└── src-tauri/
    ├── Cargo.toml
    ├── tauri.conf.json
    └── src/
        ├── main.rs
        ├── sidecar.rs
        ├── workspace.rs
        ├── secrets.rs
        └── process.rs
```

### 6.2 Sidecar 生命周期

实现流程：

1. 用户选择工作区；
2. 查找内嵌/配置的 `sacode` binary；
3. 生成高熵 token、实例 nonce，并创建当前用户私有的 ready-file 路径；token 只传入 sidecar 环境，不写 ready-file；
4. 以工作区为 cwd 启动 `sacode serve --port 0`；
5. daemon 让 OS 原子分配 loopback 端口，并把实际端口和实例 nonce 写入 ready-file/启动管道；禁止先扫描端口再启动；
6. 校验 ready 信息和 `/health`；
7. 删除或失效 ready-file；
8. 构建 client-core 实例；
9. 窗口关闭时优雅停止；
10. 超时则终止进程树。

### 6.3 UI 任务

- Workspace Welcome；
- 会话列表；
- Agent/Mode Selector；
- 消息时间线；
- Tool Call Card；
- Approval Dialog；
- Changes/Diff；
- Task Stop/Retry；
- Daemon/Backend 状态；
- 设置和诊断导出。

### 6.4 Native Backend 与任务分发

新增：

```text
runtime/src/agent_backends/native.rs
```

第一步不创建第二个队列，也不让多个 Backend 竞争消费 `TaskQueue`。保留现有 daemon queue/executor 作为唯一生命周期所有者，在任务出队后根据 `backend_id` 分发：

```text
TaskQueue
  -> TaskExecutor/BackendDispatcher
       -> sacode: existing task_runner
       -> acp: AcpProcessBackend
```

取消句柄、终态落盘、TaskSnapshot 和 SSE 发布仍由同一 executor/daemon 层收口。Native 路径只做薄封装，不重写 `TaskExecutor`：

```rust
NativeBackend -> existing task_runner
```

`BackendRegistry` 默认只注册 `sacode`。当请求没有 `backend_id` 时，行为与当前完全一致。

### 6.5 验收

- Desktop 可以完成 SaCode 普通请求；
- `fs.read` 工具事件可见；
- `fs.write` 审批拒绝不落盘；
- 批准后落盘并显示 Diff；
- Stop 可取消任务；
- 断开 SSE 后自动恢复；
- Desktop 关闭后没有遗留 `sacode serve`。

## 7. M3：通用 ACP Protocol 与 Client

### 7.1 新 crate

根 workspace 增加：

```toml
"integrations/acp"
```

crate 名建议：`sacode-acp-protocol` 或 `sacode-acp-client`。若协议类型和 Client 同时存在，建议首期使用一个 crate，待第二个 ACP Agent 接入后再拆分。

### 7.2 模块职责

#### `protocol.rs`

- JSON-RPC request/response/notification；
- initialize；
- session 生命周期；
- prompt 内容；
- event/update；
- permission request/response；
- error 类型。

#### `framing.rs`

- stdio 消息边界；
- 最大消息大小；
- 不接受 `event: ` 等非标准前缀，兼容逻辑放 adapter；
- malformed input 错误。

#### `client.rs`

- request ID；
- pending map；
- timeout；
- notification dispatch；
- Agent 反向 request dispatch。

#### `process.rs`

- `tokio::process::Command`；
- stdin writer task；
- stdout reader task；
- stderr collector；
- process exit watcher；
- cancel/kill；
- Windows process tree cleanup。

### 7.3 必需测试

- initialize transcript；
- 并发请求乱序 response；
- notification 与 response 交错；
- Agent 发起 permission request；
- invalid JSON；
- oversized message；
- request timeout；
- process exit 清空 pending；
- cancel；
- stderr 脱敏；
- Windows newline/framing。

### 7.4 现有 ACP Server 调整

1. 保留现有 public command；
2. Server dispatcher 迁移到 `interfaces/acp/src/server`；
3. 逐步使用通用 JSON-RPC 类型；
4. 为当前 `event:` framing 建 fixture，明确兼容策略；
5. 未完成标准兼容验证前，不删除旧 framing。

### 7.5 验收

- crate 无 UI 和 daemon 依赖；
- stdio Client 可与 fixture Agent 完成完整会话；
- 现有 ACP Server 4 个测试及新增兼容测试通过；
- 不改变 `interfaces/* -> runtime -> kernel` 主方向。

## 8. M4：OpenCode ACP Backend

### 8.1 实现位置

```text
runtime/src/agent_backends/acp.rs
```

OpenCode 特定配置和事件差异通过 adapter 处理，不把 `opencode` 特例写进通用 ACP transport。

### 8.2 BackendRegistry

```rust
pub struct BackendRegistry {
    factories: HashMap<AgentBackendId, Arc<dyn AgentBackendFactory>>,
}
```

注册：

- `sacode` -> NativeBackendFactory；
- `opencode` -> AcpProcessBackendFactory。

`BackendRegistry` 只提供构造、能力和会话路由，不自行消费 `TaskQueue`。唯一出队点仍在 `TaskExecutor/BackendDispatcher`，避免任务被错误 Backend 抢占。

安全约束：Backend executable、args 和环境变量策略只从用户级受信配置读取；仓库内项目配置最多选择已批准的 Backend ID，不能定义或覆盖启动命令。

### 8.3 OpenCode 探测任务

实施前先生成兼容证据：

1. 安装目标版本；
2. 记录 `opencode --version`；
3. 记录实际 ACP 启动命令；
4. 捕获 initialize request/response；
5. 捕获 session/new；
6. 捕获 session/prompt 与流式事件；
7. 捕获 permission request；
8. 捕获 cancel；
9. 形成脱敏 fixture；
10. 写入兼容矩阵。

### 8.4 事件映射

建立显式映射表：

| ACP 事件 | SaCode AgentEvent | Task/SSE 事件 |
|---|---|---|
| session started | `session_started` | `backend_session_started` |
| text delta | `message_delta` | `message` |
| reasoning | `reasoning_delta` | `thinking` |
| tool start | `tool_call_started` | `tool_call_started` |
| tool end | `tool_call_finished` | `tool_call_finished` |
| permission request | `approval_requested` | `approval_requested` |
| result | `completed` | `task_completed` |
| protocol error | `failed` | `task_failed` |

未知事件：

- 保存原始类型和脱敏 metadata；
- 不导致进程崩溃；
- 计入 `backend_event_unmapped` 指标。

### 8.5 审批桥接

```text
OpenCode permission request
    → AcpBackend
    → HttpApprovalDecider/PendingApproval
    → SSE/Desktop
    → POST approve
    → ACP permission response
```

必须验证：

- approval ID 映射唯一；
- 任务取消会取消等待中的 permission；
- UI 断开不自动批准；
- timeout 默认拒绝；
- args override 只用于协议明确允许的字段。

### 8.6 验收

- OpenCode probe 成功；
- 新建 session；
- prompt 流式输出；
- 完成结果；
- permission allow/deny；
- cancel；
- crash recovery；
- 切换回 SaCode 无需重启 Desktop。

## 9. M5：安全、恢复与发布

### 9.1 daemon token

修改：

- CLI `serve` 参数；
- daemon auth middleware；
- client-core header；
- SSE header；
- Desktop token 生成；
- VSCode 保持可选 token 配置。

测试：

- 无 token 兼容；
- 错 token 401；
- SSE 错 token；
- token 不出现在日志；
- `/health` 最小暴露。

### 9.2 Secret Store

Desktop 使用系统 keyring。定义：

```text
secret_ref = os-keyring:sacode/<profile>/<provider>
```

迁移：

1. 检测旧明文；
2. 用户确认迁移；
3. 写 keyring；
4. 配置改为引用；
5. 验证成功后再清除旧值。

### 9.3 恢复

- sidecar 崩溃提示并可重启；
- Backend 崩溃只失败关联 session；
- Desktop 重连后调用 status/result/approvals 对账；
- checkpoint 只用于 SaCode Native；
- ACP session 是否可恢复由 capability 决定，不伪造恢复能力。

### 9.4 发布产物

- Windows：NSIS/MSI；
- macOS：DMG/App bundle；
- Linux：AppImage/deb；
- 每个平台内嵌匹配的 `sacode` sidecar；
- 产物包含版本和协议 metadata；
- Desktop 与 sidecar 兼容范围写入 release manifest。

### 9.5 发布门禁

新增 workflow：

```text
.github/workflows/desktop.yml
```

职责：

1. client-core install/test/build；
2. Desktop frontend test/build；
3. Tauri cargo check/test；
4. sidecar smoke；
5. 产物结构检查；
6. Windows/macOS/Linux matrix；
7. 不默认自动发布到商店。

新增脚本：

```text
scripts/check-desktop-release.js
scripts/desktop-sidecar-smoke.js
scripts/check-acp-compatibility.js
```

## 10. 建议任务拆分

### Epic A：协议与 Backend 基础

- A1 kernel Agent 类型；
- A2 TaskRequest 兼容扩展；
- A3 BackendRegistry；
- A4 NativeBackend 封装；
- A5 daemon `/agents`；
- A6 backend 失败码。

### Epic B：共享客户端

- B1 初始化 client-core；
- B2 HTTP client；
- B3 SSE/replay；
- B4 approval client；
- B5 validators；
- B6 VSCode 迁移；
- B7 contract tests。

### Epic C：Desktop Native MVP

- C1 Tauri 工程；
- C2 Workspace；
- C3 Sidecar Manager；
- C4 Session UI；
- C5 Tool/Approval UI；
- C6 Diff；
- C7 Settings；
- C8 E2E。

### Epic D：ACP Client

- D1 JSON-RPC 类型；
- D2 framing；
- D3 process transport；
- D4 request dispatcher；
- D5 reverse requests；
- D6 timeout/cancel；
- D7 transcript fixtures；
- D8 ACP Server 兼容迁移。

### Epic E：OpenCode

- E1 真实协议探测；
- E2 compatibility matrix；
- E3 AcpBackend；
- E4 event mapping；
- E5 permission bridge；
- E6 cancel/kill；
- E7 crash recovery；
- E8 real-version smoke。

### Epic F：安全与发布

- F1 daemon token；
- F2 keyring；
- F3 redaction；
- F4 process tree cleanup；
- F5 CI；
- F6 installers；
- F7 release checks；
- F8 docs。

## 11. 测试矩阵

| 层 | 测试 |
|---|---|
| kernel | Agent 类型序列化、状态转换、失败码 |
| ACP protocol | JSON-RPC、framing、capability、fixture |
| ACP process | spawn、并发、退出、cancel、kill |
| runtime | 单队列 BackendDispatcher、BackendRegistry、native/acp event mapping |
| daemon | API 兼容、token、approval、SSE、backend failure |
| client-core | reconnect、validation、approval recovery |
| VSCode | 既有 compile/test + client-core 集成 |
| Desktop | store/component、sidecar、workspace |
| E2E | Desktop→SaCode、Desktop→fixture ACP、Desktop→OpenCode |
| release | 安装、启动、sidecar 版本、卸载清理 |

## 12. Definition of Done

项目达到首版完成态必须同时满足：

1. 主 PRD、专项 PRD、roadmap、architecture、daemon API 文档一致；
2. CLI/TUI/VSCode 无回归；
3. Desktop SaCode E2E 通过；
4. Desktop OpenCode E2E 通过目标版本；
5. 审批拒绝/允许/超时/取消均验证；
6. 由 OS 原子分配的 loopback 端口、私有 ready-file 和 token 生效，且 token 不进入 ready-file/WebView；
7. 无孤儿 sidecar/Agent 进程；
8. 日志无凭据泄漏；
9. 三平台构建通过，支持状态有真实证据；
10. 发布兼容矩阵更新；
11. 所有内部 AgentEvent 均已投影到现有 Task Protocol，客户端不需要订阅第二套事件流；
12. 所有新增配置有 schema/version/migration 测试；
13. `cargo test --workspace`、VSCode、Desktop 和 ACP 门禁全部通过。

## 13. 回滚策略

1. Backend 功能通过 capability flag 控制；
2. `backend_id` 缺失永远回退 native SaCode；
3. OpenCode Adapter 可单独禁用，不影响 daemon；
4. Desktop 只依赖稳定 daemon API，ACP 故障不阻塞 SaCode；
5. client-core 迁移分文件进行，VSCode 每步都保持可构建；
6. 现有 `interfaces/acp` 在新 Client 稳定前保留旧实现；
7. 发布包可不包含实验性 OpenCode 预设，但保留通用 ACP 配置入口。

## 14. 首批执行顺序

建议首批只启动以下 8 项，完成后再进入大规模 UI 开发：

1. M0-1：冻结 Agent/Event 数据模型；
2. M0-2：确认 OpenCode 实际 ACP 命令和版本；
3. M0-3：保存脱敏 transcript fixture；
4. M1-1：创建 client-core；
5. M1-2：迁移 Task Protocol 与 SSE；
6. M2-1：创建 Tauri 空壳和 sidecar health smoke；
7. M3-1：创建 integrations/acp crate；
8. M3-2：实现 initialize fixture 测试。

这 8 项完成后，应进行一次架构门评审，确认协议没有被具体 OpenCode 行为绑死，再推进完整 ACP Backend。
