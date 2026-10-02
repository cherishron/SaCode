# 把 SaCode 作为 ACP agent_server 接入编辑器

SaCode 实现了 **Agent Client Protocol (ACP) v1**，可作为 `agent_server` 被 Zed、Qoder、CodeBuddy 等支持 ACP 的编辑器拉起，从而在编辑器内复用 SaCode 的 agent loop、内置工具与 provider 配置。

> 本文档对应代码：`interfaces/acp/`（协议 `protocol.rs` + 服务端 `server.rs`），CLI 入口 `interfaces/cli/src/cmd/acp.rs` + `arg_parser.rs`。
> 相关提交：`ebaf321`（ACP v1 规范兼容重构）、`16bc12d`（顶层 `--acp` 标志）。

## 两种启动约定（都已支持）

| 约定来源 | 启动方式 | 说明 |
| --- | --- | --- |
| opencode / Zed | `sacode acp` | 子命令形式，对齐 opencode 的 `opencode acp` |
| CodeBuddy / Qoder | `sacode --acp` | 顶层全局标志，对齐其 `args: ["--acp"]` 约定 |

两种写法都默认启动 **stdio** ACP 服务端（newline-delimited JSON-RPC 2.0 over stdin/stdout）。
额外变体：`sacode acp serve` 启动 **TCP** 服务端（调试用）；`sacode acp status` 打印提示。

## 构建二进制

```bash
# 调试构建（快）
cargo build -p sacode-cli --bin sacode
# 产物：target/debug/sacode   (Windows: target/debug/sacode.exe)

# 发布构建（小、快）
cargo build --release -p sacode-cli --bin sacode
# 产物：target/release/sacode
```

编辑器以子进程方式拉起二进制，因此需要满足其一：
- 把 `sacode` 所在目录加入 `PATH`；或
- 在编辑器配置里写**绝对路径**（推荐，最稳）。

## 协议握手流程

```
编辑器                              sacode acp (stdio)
  │                                       │
  │── initialize ────────────────────────>│  → agentCapabilities / agentInfo / protocolVersion:1
  │<──────────────────────────────────────│
  │── session/new ───────────────────────>│  → session { sessionId, cwd, status, tools[] }
  │<──────────────────────────────────────│
  │── session/prompt ────────────────────>│  → PromptResponse（首帧内联）
  │<══ session/update (流式通知) ══════════│     session_info / agent_message_chunk /
  │<══ session/update ...      ════════════│     tool_call / tool_call_update / session_end
  │── session/close ─────────────────────>│  → ok
  │<──────────────────────────────────────│
```

首帧 `PromptResponse` 内联返回 `prompt_response`，后续增量通过 `session/update` 通知流式推送（透明透传 `_meta`，如 `conversationRequestId`）。

### `initialize` 返回的能力声明

```json
{
  "agentCapabilities": {
    "loadSession": true,
    "promptCapabilities": { "image": false, "audio": false, "embeddedContext": false },
    "mcpCapabilities": { "http": false, "sse": false }
  },
  "agentInfo": { "name": "SaCode", "version": "1.1.1" },
  "authMethods": [],
  "protocolVersion": 1
}
```

## 编辑器配置示例

### Zed

在 Zed 设置（`~/.config/zed/settings.json` 或项目 `.zed/settings.json`）中加入 `agent_servers`：

```json
{
  "agent_servers": [
    {
      "name": "SaCode",
      "command": "sacode",
      "args": ["acp"]
    }
  ]
}
```

> 若 `sacode` 不在编辑器进程可见的 `PATH` 中，把 `command` 换成绝对路径，例如
> `"command": "/absolute/path/to/target/release/sacode"`。
> 不同 Zed 版本字段名可能微调（如 `launch`），以所用版本官方 ACP 文档为准。

### CodeBuddy / Qoder（顶层 `--acp` 约定）

```json
{
  "command": "sacode",
  "args": ["--acp"]
}
```

同样，找不到二进制时改用绝对路径。

## 运行前置条件

1. **Provider 已配置**：ACP 会话会跑真实的 agent loop，复用 `~/.sacode/providers.json` 中 `current` 指定的 provider。
   - 本地网关（如 `sa-ai` → `http://127.0.0.1:8090/v1`）需处于在线状态。
   - 云端 provider（如 `longcat`）需有效的 `api_key`。
   - 未配置或不可达时，`session/prompt` 返回 JSON-RPC 错误 `-32603`（属预期降级，非崩溃）。
2. **工作目录**：`session/new` 的 `cwd` 取 SaCode 进程启动时的当前目录（即编辑器打开的项目根）。

## 内置工具（随 provider 暴露给模型）

`tools/list` 返回约 29 个内置工具，覆盖：

- 文件系统：`fs.read` `fs.read_multi` `fs.write` `fs.edit` `fs.apply_patch` `fs.patch` `fs.search` `fs.list`
- Shell：`shell.exec`
- 代码理解：`code.deps` `code.search` `code.symbols`
- 网络：`web.fetch` `web.search`
- 浏览器：`browser.open` `browser.navigate` `browser.snapshot` `browser.extract`
- 媒体：`media.read` `media.vision` `media.video`
- Git：`git.commit` `git.push` `git.pr` `git.diff`
- 测试：`test.run` `test.fix`
- 任务/交互：`task.spawn` `interaction.ask`

## 执行模式与审批策略

`session/prompt` 的 `mode` 参数映射到 SaCode 的执行模式与审批策略：

| `mode` | ExecutionMode | ApprovalPolicy |
| --- | --- | --- |
| `plan` | Plan | AutoDeny |
| `auto` / `yolo` | Yolo | AutoApprove |
| （缺省）/ `build` | Build | AutoDeny |

默认值偏保守（Build + 需人工确认），适合把 SaCode 当作需要确认的工具执行体接入编辑器。

## 已知边界

- **会话存储为进程内内存**：每个 `sacode acp` 子进程有独立的会话表，进程 A 创建的会话在进程 B 不可见（编辑器通常会为一次连接维持单个长驻进程，故日常使用不受影响）。
- **stdout 必须纯净**：ACP 服务端独占 stdout 传输 JSON-RPC；启动前不得向 stdout 打印任何 banner（代码已移除此类输出），否则会破坏协议流。
- **`getConfigOptions` / `authenticate`**：`getConfigOptions` 已返回真实生效的配置项 `mode`（执行模式，当前值 `build`，可选 `plan`/`auto`/`yolo`）；`authenticate` 返回 `authenticated: true`——SaCode 复用本地 provider 配置、无需交互认证（与 `initialize` 的 `authMethods: []` 一致）。

## 本地自测（stdio 冒烟）

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1}}' \
  '{"jsonrpc":"2.0","id":2,"method":"session/new","params":{}}' \
  '{"jsonrpc":"2.0","id":3,"method":"session/list","params":{}}' \
  '{"jsonrpc":"2.0","id":4,"method":"tools/list","params":{}}' \
  | target/debug/sacode --acp
```

预期：依次收到 4 行 JSON-RPC 响应，字段均为 camelCase，stdout 无额外噪音，进程在 stdin EOF 后正常退出。

## 路线图

- **A2**：配置好 provider 后，做真实 `session/prompt` 端到端流式验证（需编辑器侧或本地网关在线）。
- **A4（已完成）**：`getConfigOptions` 返回真实 `mode` 配置项；`authenticate` 返回 `authenticated: true`（本地 provider 无需交互认证）。提交见 ACP 改造后续 commit。
- **B（桌面端里程碑）**：与桌面端 WIP 合流后再推进 D5/D6/E3 等发布与安全项。
