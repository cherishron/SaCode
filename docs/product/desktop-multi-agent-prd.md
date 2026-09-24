# SaCode Desktop 与多 Agent 客户端 PRD

> 文档状态：实施中（当前唯一客户端主线）
> 文档版本：v1.2
> 决策日期：2026-09-20
> 阶段顺序更新：2026-09-22
> 仓库审查基线：`dev@9d8f9f8`（2026-09-22）
> 适用产品：SaCode CLI / Daemon / VSCode / Desktop / ACP 集成
> 配套实施计划：[Desktop 与多 Agent 客户端实施计划](../plans/desktop-multi-agent-implementation-plan.md)
> 配套 UI 设计：[Desktop UI Design v1](../design/desktop-ui-design-v1.md)

## 1. 决策摘要

SaCode 将从“终端优先、IDE 延伸”的单一 Agent 产品，演进为“统一运行时、多客户端、多 Agent Backend”的本地 AI 编程工作台。

本次决策不替代 CLI，也不把桌面端做成 CLI 文本套壳。产品采用以下结构：

1. CLI/TUI 继续作为轻量、脚本友好的核心入口。
2. `sacode serve` 作为本地统一 Agent Host，对客户端提供 HTTP、SSE、审批和任务恢复能力。
3. 新增 Tauri Desktop 客户端，通过 daemon 使用 SaCode 原生 Agent。
4. daemon 新增可插拔 `AgentBackend`，首批支持：
   - `sacode`：SaCode 原生运行时；
   - `opencode`：通过 ACP stdio 启动和调用 OpenCode。
5. 当前 `interfaces/acp` 的 SaCode ACP Server 保留；新增独立 ACP 协议/Client 能力，避免混淆“SaCode 被 ACP 调用”和“SaCode 调用 ACP Agent”两个方向。
6. VSCode 与 Desktop 共用 TypeScript 客户端核心，不各自维护一套 daemon/SSE/审批协议。
7. 所有 Agent Backend 的事件、审批、结果和失败统一映射到 SaCode Task Protocol，客户端不直接依赖某个 Agent 的私有事件格式。
8. 当前先完成 Desktop 本地闭环与发布收口；手机端通信、远程 daemon、跨设备控制和签名中继不并行实施，待 Desktop 退出门禁通过后另立专项。

## 2. 背景与问题

### 2.1 当前产品基础

SaCode 当前已具备：

- CLI、TUI、REPL 与单次任务入口；
- 本地 daemon、HTTP API、SSE、任务取消、审批恢复；
- VSCode 扩展与 daemon 自动管理；
- SaCode ACP Server；
- Provider、工具、沙箱、审计、checkpoint 和事件投影；
- 可嵌入的 `SdkClient`。

这些能力说明桌面客户端不需要重建执行引擎。立项时的前三项缺口已取得实现进展：独立 Desktop 已落地、VSCode 与 Desktop 已复用 client-core、SaCode 已新增 ACP Client 调用 OpenCode；当前剩余问题如下：

1. Desktop 尚未通过首个正式版本的真实端到端、安装包和跨平台发布门禁。
2. client-core 已复用，但版本发布、跨客户端 fixture 与兼容策略仍待收口。
3. ACP Client 已能调用 OpenCode，但权限审批回传、取消、恢复和正式兼容矩阵尚未完成。
4. daemon 已具备最小 Agent Backend registry、`backend_id` 分发与 ACP 适配，但仍缺正式的 probe/restart 管理 API、完整权限审批回传和会话生命周期验收。
5. daemon 工作目录在进程启动时固定，不适合一个进程同时管理任意工作区。
6. Desktop sidecar 已使用动态 loopback 端口、高熵 token、ready-file nonce 和 Rust IPC 代理；长期凭据 keyring、日志脱敏、安装包与跨平台进程清理仍需发布验收。
7. Tauri shell 与四面板 UI 已落地，但当前会话列表主要是前端内存投影，Diff 仍依赖事件 detail 解析，不等价于持久会话和规范变更模型。

### 2.2 要解决的核心问题

1. 用户如何在不依赖终端或 IDE 的情况下使用 SaCode？
2. 如何让同一个客户端切换 SaCode 与 OpenCode，而不复制两套 UI？
3. 如何保持工具审批、审计、取消和恢复的一致性？
4. 如何在不破坏现有 CLI、VSCode、ACP Server 的前提下渐进迁移？
5. 如何避免桌面端直接承载复杂 Agent 逻辑，导致运行时分叉？

## 3. 产品定位

### 3.1 新定位

SaCode 是一个面向开发者的本地 AI 编程工作台：

- 终端用户通过 CLI/TUI 使用；
- IDE 用户通过 VSCode 使用；
- 图形客户端用户通过 Desktop 使用；
- 外部系统通过 HTTP、SDK 或 ACP Server 集成；
- 用户可以选择 SaCode 原生 Agent，或通过标准协议接入外部 Agent。

核心叙事扩展为：

> 国内模型原生适配、执行全程可审计、终端与桌面一致、Agent 可插拔。

### 3.2 产品原则

1. **运行时唯一**：客户端不实现第二套任务状态机和工具执行引擎。
2. **协议优先**：客户端只消费稳定 Task Protocol；标准化 `AgentEvent` 是 daemon 内部 Backend 适配模型，必须投影后再对外。
3. **安全默认**：未确认的副作用操作不得执行；外部 Agent 不得绕过 SaCode 审批边界。
4. **本地优先**：默认仅监听 loopback，模型凭据和项目文件不经过 SaCode 自建云服务。
5. **CLI 不退化**：桌面能力不能破坏脚本、管道、TUI 和无头运行。
6. **渐进迁移**：先新增、后抽取、再迁移，禁止一次性移动所有接口目录。
7. **Agent 与 Provider 分离**：OpenCode 是 Agent Backend，不是 Model Provider。

## 4. 用户与场景

### 4.1 核心用户

1. 希望使用图形界面但不想绑定特定 IDE 的开发者。
2. 同时使用 SaCode、OpenCode 等多个编程 Agent 的开发者。
3. 需要在执行前查看命令、文件变更和 Diff 的安全敏感用户。
4. 需要任务恢复、审计记录和可追踪执行过程的团队。
5. 当前 CLI 用户，希望在复杂任务中获得更好的会话和变更可视化。

### 4.2 核心场景

#### 场景 A：使用 SaCode 原生 Agent

1. 用户打开项目目录。
2. 客户端启动该工作区对应的 `sacode serve` sidecar。
3. 用户选择 `SaCode` Agent 和 `build` 模式。
4. 输入任务并查看流式输出、工具调用和模型路由。
5. 修改类工具触发审批；用户查看 Diff 后允许或拒绝。
6. 任务完成后查看结果、变更文件和审计信息。

#### 场景 B：通过 ACP 使用 OpenCode

1. 用户在设置中配置 OpenCode 可执行文件与 ACP 参数。
2. 客户端请求 daemon 探测 OpenCode Backend。
3. daemon 启动 OpenCode ACP 子进程并完成 capability 握手。
4. 用户创建 OpenCode 会话并发送任务。
5. OpenCode 的文本、工具和权限事件被映射为统一事件。
6. 用户仍通过同一审批 UI 处理高风险操作。
7. 用户取消任务时，daemon 先发送 ACP cancel；超时后终止子进程树。

#### 场景 C：在客户端间保持一致

1. 用户可在 CLI、VSCode 或 Desktop 发起 SaCode 任务。
2. 对相同 Task Protocol，状态名、审批语义和失败码一致。
3. Desktop 和 VSCode 可在重连后查询待审批并对账任务状态。

#### 场景 D：OpenCode 不可用

1. 可执行文件不存在、版本不兼容或握手失败。
2. UI 显示结构化诊断，不影响 SaCode 原生 Backend。
3. 用户可重新配置路径、参数或切换回 SaCode。

## 5. 范围

### 5.1 首个正式版本必须包含

#### Desktop

- 打开本地工作区；
- SaCode sidecar 自动发现、启动、健康检查和停止；
- 动态 loopback 端口；
- Agent 选择器；
- 新建会话、发送任务、停止任务；
- `plan` / `build` / `auto` 模式；
- 文本和思考流；
- 工具调用卡片；
- 审批弹窗；
- 文件 Diff；
- 任务状态与错误显示；
- 断线重连和待审批恢复；
- SaCode Backend 完整可用；
- OpenCode ACP Backend 实验性可用。

#### Daemon

- 可选启动令牌认证；
- Agent Backend 注册和探测；
- 任务请求指定 `backend_id`；
- Backend 能力查询；
- OpenCode ACP 进程生命周期管理；
- 统一事件映射；
- ACP 权限请求映射到 daemon 审批；
- cancel、失败、退出和超时处理；
- 原有请求不提供 `backend_id` 时默认走 `sacode`，保持兼容。

#### 共享客户端核心

- daemon HTTP client；
- SSE reconnect 与 `Last-Event-ID`；
- Task Protocol 运行时校验；
- approval API 与恢复；
- Agent/Backend 类型；
- 所有 Backend 事件投影为现有 Task Protocol/SSE 事件，禁止对客户端暴露第二套长期公开事件协议；
- VSCode 和 Desktop 均使用同一包。

### 5.2 当前实施状态（2026-09-22）

状态词仅使用 `已验收 / 部分验收 / 未开始 / 延后 / 不在范围`。代码存在不等于正式验收。

| 交付面 | 状态 | 已落地 | 未通过门禁 |
|---|---|---|---|
| Desktop shell 与 sidecar | 部分验收 | Tauri shell、动态 loopback 端口、ready-file nonce、Rust 内存 token、HTTP IPC 代理、SSE bridge、启动/停止 | 真实安装包 smoke、异常退出与跨平台进程树清理、完整日志脱敏 |
| Desktop UI | 部分验收 | 四面板布局、Agent/模式选择、时间线、工具卡、审批卡、取消、状态、Changes/Approvals/Activity、简易 Diff | 持久会话恢复、规范 Diff 数据源、Retry/归档、可访问性与真实 E2E |
| client-core | 部分验收 | daemon HTTP、SSE reconnect、`Last-Event-ID`、Task Protocol 校验、approval、Agent 类型；Desktop/VSCode 已复用 | 独立发布与版本策略、更多契约 fixture、跨客户端一致性验收 |
| daemon Agent Backend | 部分验收 | `sacode` 默认 Backend、registry、`backend_id` 分发、`GET /api/agents`、ACP stdio 执行、事件投影与失败分类 | `/probe`、`/restart`、持久 session API、统一审计关联 |
| OpenCode ACP | 部分验收 | initialize/session/prompt 和事件映射；仓库记录 OpenCode `1.18.31` 返回 `PONG` 的 smoke | 权限请求→daemon 审批→ACP response 的真实闭环；cancel 先 ACP 后强杀；正式兼容矩阵 |
| Desktop 发布 | 未开始 | 已有前端/Rust 局部构建测试 | 独立 CI、三平台构建、NSIS/DMG/AppImage 或等价安装包、签名/升级策略、版本一致性 |
| 手机/远程通信 | 延后 | 仅复用 Task Protocol、HTTP/SSE 等协议接缝 | Desktop 退出门禁后另立专项 |

本次验证结果：client-core typecheck/build/7 tests、Desktop typecheck/build/6 tests、VSCode compile/32 tests、`cargo check --workspace`、Desktop Rust 3 tests 均通过。Rust workspace 全量测试因本机 E 盘空间不足（`os error 112`）在编译阶段中止，因此不计为通过或代码失败。验证基于存在其他未提交 CLI/identity 修改的工作区；这些未提交修改不计入本专项已验收范围。

### 5.3 后续版本

以下能力均不得与当前 Desktop 本地闭环并行扩张，应在首个正式桌面版本通过发布门禁后重新评审和排期：

- 多窗口、多工作区并发；
- 远程 daemon；
- 手机端绑定、LAN 直连与跨设备控制；
- 签名中继或其他异网通道；
- 更多 ACP Agent；
- 会话跨设备同步；
- 团队策略、RBAC、集中审计；
- 插件市场；
- 自动更新；
- Agent 之间任务转交。

### 5.4 明确不做

首版不做：

1. 把 Desktop 做成完整 IDE；
2. 内置代码编辑器替代 VSCode；
3. 通过解析 OpenCode CLI 人类可读文本实现集成；
4. 把 OpenCode 当作模型 Provider；
5. 允许 ACP Agent 绕过审批直接执行本机副作用；
6. 公网开放 daemon；
7. 一个 daemon 同时管理任意数量工作区；
8. 云端账户、云同步和计费系统；
9. 首版即支持所有 ACP 实现差异；
10. 手机 App、扫码配对、LAN 手机控制、远程 daemon 和 Redis/其他签名中继；
11. 为尚未立项的手机通信提前改变 Desktop 的本机 loopback 安全边界。

## 6. 信息架构与页面

### 6.1 主导航

1. **Workspace**：当前工作区、Git 分支和状态。
2. **Sessions**：会话列表、新建、恢复、归档。
3. **Agent**：SaCode/OpenCode 选择与健康状态。
4. **Changes**：变更文件、Diff、接受/拒绝。
5. **Activity**：工具调用、审批、模型路由和错误。
6. **Settings**：Provider、Agent、权限、凭据、日志。

### 6.2 主会话页面

页面至少包含：

- Agent 和模式选择；
- 输入区；
- 消息时间线；
- reasoning 折叠区域；
- 工具调用状态卡片；
- 审批卡片；
- 文件变更摘要；
- Stop/Retry；
- 任务终态和耗时；
- Backend 崩溃或断连提示。

### 6.3 审批交互

审批动作：

- 拒绝；
- 允许一次；
- 本会话允许同类操作；
- 对文件 Patch 仅允许已接受路径；
- 永久授权仅作为后续能力，不进入首版。

显示内容：

- 请求来源 Agent；
- 工具或权限类型；
- 工作目录；
- 命令或参数；
- 受影响文件；
- 风险等级；
- Diff；
- 超时倒计时。

## 7. 核心领域模型

### 7.1 Agent Backend

以下为目标完整接口，用于描述最终职责边界；当前代码采用 registry + native/ACP 执行路径实现最小子集，尚未具备此处全部 session 生命周期方法。

```rust
pub trait AgentBackend: Send + Sync {
    fn descriptor(&self) -> AgentDescriptor;
    async fn probe(&self, ctx: ProbeContext) -> Result<AgentCapabilities>;
    async fn start_session(&self, ctx: SessionContext) -> Result<BackendSession>;
    async fn prompt(&self, request: BackendPrompt, sink: AgentEventSink)
        -> Result<BackendResult>;
    async fn cancel(&self, session_id: &str) -> Result<()>;
    async fn close(&self, session_id: &str) -> Result<()>;
}
```

接口设计要求：

- Trait 定义在 `runtime`；
- 只依赖 kernel 中的稳定数据结构；
- Backend 实现不得直接操作 UI；
- 所有事件通过 `AgentEventSink` 输出；
- 所有副作用权限请求转换为统一审批请求。

### 7.2 Agent Descriptor

```json
{
  "id": "opencode",
  "display_name": "OpenCode",
  "kind": "acp-process",
  "status": "available",
  "capabilities": {
    "streaming": true,
    "cancel": true,
    "permissions": true,
    "file_diff": true
  }
}
```

### 7.3 统一 Agent Event

必须覆盖：

- `session_started`
- `message_delta`
- `reasoning_delta`
- `plan_updated`
- `tool_call_started`
- `tool_call_finished`
- `approval_requested`
- `approval_resolved`
- `file_changed`
- `backend_status_changed`
- `completed`
- `failed`
- `cancelled`

统一事件进入 Task Protocol 后，继续通过现有 SSE 对外发布。

### 7.4 Task Request 扩展

```json
{
  "prompt": "修复测试失败",
  "mode": "build",
  "backend_id": "opencode",
  "session_id": null,
  "priority": "normal"
}
```

兼容规则：

- `backend_id` 缺失时使用 `sacode`；
- 旧客户端不受影响；
- 服务端拒绝未知 Backend，并返回稳定失败码 `backend/not_found`；
- Backend 不支持的模式返回 `backend/capability_unsupported`。

### 7.5 配置模型

项目配置只允许保存已批准 Backend 的非敏感会话偏好，不得定义可执行文件。外部 Agent 的 `command`、`args` 和环境变量策略属于用户级受信配置，保存在应用配置目录；否则打开恶意仓库可能触发任意程序启动。

用户级 Backend 定义示例：

```json
{
  "default_backend": "sacode",
  "backends": {
    "sacode": {
      "type": "native"
    },
    "opencode": {
      "type": "acp-process",
      "command": "<用户确认的 OpenCode 可执行文件>",
      "args": ["<兼容性探测确认的 ACP 参数>"],
      "env_allowlist": ["PATH", "HOME", "USERPROFILE"]
    }
  }
}
```

上述值仅展示配置结构，不代表已确认的 OpenCode 命令。禁止使用单个 shell 字符串拼接命令；`command` 和 `args` 必须分开存储。

## 8. 技术架构

### 8.1 推荐调用链

```text
Desktop / VSCode
        │ HTTP + SSE
        ▼
  sacode serve
        │
        ├── SaCodeBackend ──> TaskExecutor / Provider / Tools
        │
        └── AcpBackend ─────> ACP stdio ──> OpenCode
```

客户端直接使用方式：

- VSCode/Node：client-core 使用 fetch/SSE transport；
- Desktop WebView：client-core 使用 Tauri IPC transport，由 Rust shell 持有 daemon token 并代理 HTTP/SSE；
- 禁止为 WebView 开放宽泛 daemon CORS，禁止把 bearer token 暴露给 renderer。

采用 daemon 统一托管 Backend，而不是 Desktop 自己同时连接 daemon 和 OpenCode。原因：

1. 客户端只有一套协议；
2. VSCode 未来也能使用 OpenCode Backend；
3. 审批、取消、事件和审计在 daemon 收口；
4. ACP 进程生命周期不污染 UI；
5. 可以对外部 Agent 应用统一安全策略。

### 8.2 ACP 双方向定义

必须区分：

- **ACP Server**：外部 ACP Client 调用 SaCode；现有 `interfaces/acp` 负责。
- **ACP Client**：SaCode daemon 调用 OpenCode；新增通用 ACP Client 负责。

两者共享 ACP 消息类型和 framing，但生命周期、权限方向和会话所有权不同。

### 8.3 工作区模型

首版使用“一工作区一 daemon”模式：

- 每个 Desktop 窗口绑定一个工作区；
- 每个工作区启动一个由 OS 分配端口的 daemon；
- sidecar 使用 `port=0` 或等价机制让监听器原子绑定端口，并通过仅当前用户可读的 ready-file/启动管道返回实际端口和实例 nonce；禁止“先探测空闲端口、后启动监听”的 TOCTOU 方案；
- OpenCode 子进程继承该工作区作为 `cwd`；
- 不允许任务通过请求参数切换到任意工作目录；
- 多工作区通过多窗口和多 daemon 实现。

这比在首版扩展 daemon 为多租户工作区更安全，也更容易复用当前实现。

## 9. 目录结构决策

### 9.1 结论

需要调整目录结构，但采用渐进式新增，不进行全仓搬迁。

保持不变：

- `kernel/`
- `runtime/`
- `interfaces/cli/`
- `interfaces/lsp/`
- `interfaces/vscode/`
- `interfaces/acp/` 的外部路径

新增：

```text
.
├── integrations/
│   └── acp/                    # 通用 ACP 类型、JSON-RPC framing、stdio client
├── interfaces/
│   ├── client-core/            # VSCode/Desktop 共用 TypeScript 客户端 SDK
│   └── desktop/                # Tauri Desktop
│       ├── src/                # Vue 3 + TypeScript UI
│       └── src-tauri/          # Tauri shell 与 sidecar 管理
└── runtime/src/
    └── agent_backends/
        ├── mod.rs
        ├── registry.rs
        ├── native.rs
        └── acp.rs
```

### 9.2 为什么新增 `integrations/acp`

不建议让 `runtime` 依赖 `interfaces/acp`，否则依赖方向会变成 `runtime -> interfaces`。

`integrations/acp` 只负责：

- ACP JSON-RPC 类型；
- 消息 framing；
- request/response ID 匹配；
- stdio transport；
- capability 数据；
- ACP Client 生命周期基础设施。

它不负责：

- SaCode Task Protocol；
- SaCode 工具执行；
- daemon API；
- UI；
- Provider。

依赖方向为：

```text
interfaces/desktop ─┐
interfaces/acp ─────┼──> runtime ──┬──> kernel
interfaces/cli ─────┘              └──> integrations/acp
```

优先让 `integrations/acp` 不依赖 kernel，避免协议层被 SaCode 领域模型污染。

### 9.3 为什么不立即移动 VSCode

`interfaces/vscode` 已绑定：

- 发布脚本；
- CI；
- VSIX 路径；
- 文档；
- 兼容性检查。

首期移动目录会增加无产品价值的发布风险。因此只把通用逻辑抽取到 `interfaces/client-core`，VSCode 保持原路径。

### 9.4 `interfaces/acp` 内部调整

现有目录从单文件 Server 逐步调整为：

```text
interfaces/acp/src/
├── lib.rs
├── server/
│   ├── mod.rs
│   ├── dispatcher.rs
│   └── stdio.rs
└── adapter.rs
```

通用 ACP 类型和 Client 不放在这里，统一来自 `integrations/acp`。

## 10. API 需求

### 10.1 daemon API 增量

| 方法 | 路径 | 状态 | 说明 |
|---|---|---|---|
| GET | `/agents` | 已实现，部分验收 | 列出 Backend、状态与能力；当前实际路由前缀为 `/api` |
| POST | `/agents/:id/probe` | 未开始 | 主动探测 Backend |
| POST | `/agents/:id/restart` | 未开始 | 重启外部 Backend 进程 |
| GET | `/sessions` | 未开始 | 查询当前工作区持久会话 |
| POST | `/sessions/:id/close` | 未开始 | 关闭 Backend 会话 |

`POST /task` 增加可选字段：

- `backend_id`
- `session_id`

首版不删除任何现有端点。

### 10.2 daemon 认证

新增可选启动参数或环境变量：

```text
sacode serve --auth-token <token>
SACODE_DAEMON_TOKEN=<token>
```

规则：

- 未配置 token 时保持当前本地兼容行为；
- Desktop 启动 sidecar 时必须生成高熵随机 token；
- HTTP 使用 `Authorization: Bearer <token>`；
- SSE 同样校验；
- token 只存在于 Desktop Rust shell/daemon 进程内存和子进程环境，不写项目文件，也不写 ready-file；
- ready-file 只包含实际 loopback endpoint、实例 nonce 和非敏感版本信息，必须放在用户私有运行目录，并在握手后删除或使其失效；
- `/health` 可返回最小信息，但不能泄露 token 或敏感配置。

### 10.3 失败码

新增稳定失败码：

- `backend/not_found`
- `backend/unavailable`
- `backend/start_failed`
- `backend/protocol_error`
- `backend/capability_unsupported`
- `backend/session_not_found`
- `backend/crashed`
- `backend/cancel_timeout`
- `acp/handshake_failed`
- `acp/invalid_message`
- `acp/request_timeout`
- `acp/permission_denied`

## 11. OpenCode ACP 集成要求

### 11.1 配置与探测

不得在产品代码中猜测固定命令。产品只提供待验证候选或用户级配置槽位，兼容性探测必须记录最终 executable 与 args：

```json
{
  "command": "<用户确认的 OpenCode 可执行文件>",
  "args": ["<兼容性探测确认的 ACP 参数>"]
}
```

上述占位符不是已确认命令；正式兼容声明必须附目标 OpenCode 版本和脱敏 transcript。

探测步骤：

1. 检查 executable；
2. 启动子进程；
3. 发送 `initialize`；
4. 校验协议和 capabilities；
5. 建立 session；
6. 关闭探测 session；
7. 返回结构化结果。

只有完成真实握手后才能显示 `available`。

### 11.2 Transport

- 默认只支持 stdio；
- stdin 写入必须串行化；
- stdout 按协议 framing 解析；
- stderr 独立采集并脱敏；
- request ID 不能重用；
- pending request 在进程退出时全部失败；
- 单条消息设置大小上限；
- 握手、普通请求、取消分别设置超时；
- Windows 必须确保子进程树可清理。

### 11.3 权限与工具

ACP Agent 发起的权限请求必须：

1. 转换为 daemon `PendingApproval`；
2. 通过 SSE 通知客户端；
3. 等待 `approval_id` 对应决定；
4. 超时、断连、取消时默认拒绝；
5. 写入 SaCode 审计日志；
6. 再转换回 ACP permission response。

对于 ACP Agent 自己直接执行且不经过权限请求的操作，SaCode 只能记录 Agent 报告，不能声称已经沙箱拦截。因此产品必须根据 capability 明确标注：

- `enforced_by_sacode`：SaCode 实际执行/审批；
- `reported_by_agent`：外部 Agent 仅上报；
- `unknown`：协议无法确认。

## 12. 安全与隐私

### 12.1 凭据

- Desktop 发布版不得默认把 API Key 明文写入项目文件；
- Tauri Rust shell 持有 daemon token，renderer 不直接读取 token；Desktop 通过受限 Tauri command/event transport 调用 sidecar；
- 使用系统凭据库保存用户级密钥；
- 配置文件只保存 `secret_ref`；
- 兼容读取旧明文配置，但提供迁移提示；
- 日志、ACP stderr、错误响应必须脱敏。

### 12.2 子进程

- 禁止通过 shell 字符串启动 Agent；
- `command` 与 `args` 分离；
- 默认只透传 allowlist 环境变量；
- 用户级 Backend 配置首次新增或变更 executable 时必须显式确认；项目仓库配置不能覆盖 executable、args 或环境变量；
- 不透传无关 API Key；
- 设置工作目录边界；
- 客户端退出时清理自己启动的 sidecar 和 Agent 子进程；
- 非预期退出后标记所有关联任务失败。

### 12.3 网络

- daemon 默认仅监听 `127.0.0.1`；
- Desktop 使用由 OS 原子分配的 loopback 端口；
- Desktop renderer 不直接跨域访问 daemon；Tauri Rust shell 负责带 token 的 HTTP/SSE transport，避免开放宽泛 CORS 或把 token 暴露给 WebView；
- token 校验防止同机其他进程误操作；
- 首版不支持公网绑定；
- 远程 daemon 后续单独设计 TLS 和身份认证。

## 13. 兼容性

### 13.1 CLI

- 现有命令和默认行为不变；
- `sacode serve` 不提供 token 时保持兼容；
- 可新增 `--backend <id>`，但不作为 Desktop MVP 前置条件；
- JSON 输出继续使用 Task Protocol。

### 13.2 VSCode

- 先切换到 `client-core`，功能保持一致；
- 默认 Backend 为 `sacode`；
- 后续可增加 Agent 选择器；
- VSCode 对旧 daemon 进行版本和 capability 降级处理。

### 13.3 ACP Server

- 保持原命令入口；
- 通用协议类型迁移时提供兼容测试；
- 修正非标准 framing 必须通过版本或兼容层处理，不能静默破坏已有调用方。

### 13.4 配置

- 缺少 `backends` 时自动生成 native `sacode`；
- 未知字段保留或忽略，不导致启动失败；
- 配置 schema 需要版本号和迁移测试。

## 14. 非功能需求

### 14.1 可靠性

- sidecar 启动失败必须可诊断；
- SSE 断线自动重连；
- pending approval 必须恢复；
- Backend 崩溃不得带崩 daemon；
- cancel 最终必须终止任务或返回明确超时；
- Desktop 关闭后不得遗留孤儿 Agent 进程。

### 14.2 性能

- Desktop UI 不因长输出或高频事件冻结；
- 事件列表使用虚拟化；
- daemon 与 ACP 消息设置容量和背压；
- 大 Diff 延迟加载；
- 启动时不自动拉起未选择的外部 Agent。

### 14.3 可观测性

至少记录：

- sidecar 启动与退出；
- Backend probe 结果；
- ACP handshake 版本与能力；
- session 生命周期；
- request timeout；
- cancel 路径；
- 审批等待与结果；
- 子进程崩溃；
- 事件映射失败。

日志不得记录密钥和完整敏感环境变量。

## 15. 成功指标

### 15.1 产品指标

1. 新用户可在 Desktop 内完成打开项目、配置 Provider、发起 SaCode 任务。
2. 用户可在同一会话 UI 中切换新会话的 Backend。
3. OpenCode 可完成握手、创建会话、发送 prompt、流式输出和取消。
4. 所有修改操作在 `build` 模式具有明确审批或安全来源标识。
5. Desktop 和 VSCode 的 daemon 协议实现不再重复维护。

### 15.2 工程指标

1. CLI、VSCode 现有主流程无回归。
2. Rust workspace、Desktop、client-core 均有独立 CI 门禁。
3. ACP transport 具备 transcript/fixture 测试。
4. SaCode/OpenCode Backend 对同一标准事件 contract 通过测试。
5. Windows、macOS、Linux 至少具备构建产物；正式支持状态按真实安装 smoke 更新。
6. sidecar 和 Agent 子进程清理测试通过。

## 16. 验收场景

### A. SaCode 原生闭环

- 打开仓库；
- 启动 sidecar；
- 运行只读任务；
- 调用 `fs.read`；
- 收到完成结果；
- Task Protocol 中有 route/tool records。

### B. SaCode 审批闭环

- Build 模式请求写文件；
- UI 收到审批；
- 拒绝后文件不变；
- 重试并允许后文件写入；
- 审计记录可查询。

### C. OpenCode ACP 闭环

- probe 成功；
- initialize 成功；
- session 创建成功；
- prompt 有增量事件；
- 最终结果完成；
- session 可关闭。

### D. OpenCode 权限闭环

- OpenCode 发起权限请求；
- daemon 创建 pending approval；
- Desktop 展示来源和参数；
- 拒绝正确返回 OpenCode；
- 超时默认拒绝；
- 审计记录完整。

### E. 故障闭环

- executable 不存在；
- 握手版本不兼容；
- stdout 非法消息；
- Agent 中途崩溃；
- cancel 无响应；
- Desktop 与 daemon 断连；
- 所有情况均产生稳定失败码且不影响其他 Backend。

## 17. 发布门禁

正式发布前必须通过：

1. `cargo fmt --all -- --check`
2. `cargo clippy --workspace --all-targets -- -D warnings`
3. `cargo test --workspace`
4. daemon API contract 测试
5. ACP transcript 测试
6. client-core 单测
7. VSCode compile/test
8. Desktop TypeScript test/build
9. Tauri sidecar smoke
10. Windows 子进程树清理测试
11. Desktop → SaCode E2E
12. Desktop → OpenCode ACP E2E（允许在无 OpenCode 环境时由协议 fixture 替代基础 CI，正式兼容声明必须使用真实版本 smoke）
13. 密钥/日志脱敏测试
14. 安装包内容和版本一致性检查

## 18. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| OpenCode ACP 命令或协议变化 | 集成失效 | capability probe、兼容矩阵、adapter 版本化 |
| 目录重构破坏发布脚本 | CLI/VSCode 发布失败 | 只新增目录，现有路径延后迁移 |
| daemon Backend 抽象过度设计 | 延迟交付 | 先只实现 native/acp 两个 Backend 和最小 trait |
| 外部 Agent 绕过 SaCode 工具沙箱 | 安全叙事不准确 | 权限来源标记、capability 展示、默认拒绝 |
| 多套事件模型漂移 | UI 分叉 | kernel/Task Protocol 作为唯一标准化结果 |
| Desktop 引入 JS/Rust 双构建复杂度 | CI 不稳定 | 独立 workflow、锁文件、确定性构建 |
| sidecar 端口被抢占 | 请求被劫持 | `port=0` 原子绑定 + 私有 ready-file + 高熵 token + loopback |
| 子进程残留 | 资源和安全问题 | 进程组/Job Object、退出清理、集成测试 |

## 19. 决策记录

### 已决定

1. 使用 Tauri，而非 Electron。
2. Desktop 通过 daemon 使用所有 Backend。
3. OpenCode 通过 ACP Client 接入，不作为 Provider。
4. 一工作区一 daemon，首版不做多工作区 daemon。
5. 新增 `integrations/acp`，不让 runtime 依赖 interfaces。
6. 新增 `interfaces/client-core` 和 `interfaces/desktop`。
7. 不立即移动 `interfaces/vscode`。
8. 现有 ACP Server 保留。

### 正式发布前仍必须验证

1. **已取得局部证据**：仓库记录 OpenCode `1.18.31` 通过 `bun x opencode-ai acp` 完成 initialize/session/prompt 并返回 `PONG`；该记录不替代固定版本、干净环境的发布 smoke。
2. initialize/session/prompt/cancel 的真实消息结构、协议版本和 capability 需固化为 fixture 与兼容矩阵。
3. OpenCode 权限请求是否覆盖其所有副作用，以及审批结果能否真实回传 ACP，仍未完成端到端验收。
4. daemon task cancel 是否先触发 ACP `session/cancel`、超时后再清理完整子进程树，仍需集成测试。
5. Windows/macOS/Linux 上 Desktop sidecar 与 OpenCode 子进程的退出行为必须实测。
6. `/agents/:id/probe`、`/agents/:id/restart` 和首版持久 session API 是否确属必要最小面，需在实现前按当前 UI/E2E 缺口确认，不为手机通信扩张协议。

## 20. 与现有产品文档的关系

本 PRD 是 `docs/product/PRD.md` 的专项扩展。自 2026-09-20 起，以下旧声明不再适用于本专项：

- “当前阶段不提供桌面端 GUI”；
- “ACP/Daemon 维持现状、不扩展”。

新的边界是：

- 当前结论是“本地 MVP 已落地、正式 Desktop 版本部分验收”，不是“待实施”，也不是“已发布”；
- 不做完整 IDE；
- 只扩展支撑 Desktop 和可插拔 Agent 所必需的 daemon/ACP 能力；
- 当前 daemon 保持 Desktop sidecar 的本机 loopback 边界，不以手机通信为由开放 LAN/公网；
- 手机端通信、远程 daemon、跨设备控制和签名中继待 Desktop 发布收口后另立专项；
- 不恢复 Scheduled Tasks、Agent Teams、Channels 等已延后平台功能。
