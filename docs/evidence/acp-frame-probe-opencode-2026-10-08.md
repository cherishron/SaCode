# ACP 帧格式探针报告 · OpenCode v2.0.24

> 探针对象：OpenCode v2.0.24（`opencode acp` 子命令）
> 探针时间：2026-10-08 08:56（UTC+8）
> 探针脚本：`apps/desktop/test-support/acp-frame-probe.mjs`
> 功能标识：`acp_collaboration` · 任务 1.1

## 1. 结论

| 维度 | 值 | 置信度 |
|------|-----|--------|
| **帧格式** | **NDJSON**（单行 JSON + `\n`） | 高 |
| 协议版本 | `protocolVersion: 1` | 高 |
| JSON-RPC 版本 | `2.0` | 高 |
| 服务端主动发帧 | 否（无 greeting/banner，仅响应请求） | 高 |
| Content-Length 头 | **不存在** | 高 |

**关键发现**：OpenCode ACP 使用 NDJSON 帧，与本仓 `core/src/extproc.cj` 的 `ExtProcess` 现有帧格式**完全一致**。`AcpProductAdapter.frameCodec` 对 OpenCode 选 **NDJSON**，可直接复用 `ExtProcess` 的帧编解码，无需另做 Content-Length 策略。

## 2. 探针方法

1. `spawn('opencode', ['acp'], {shell:true, stdio:['pipe','pipe','pipe']})` 启动 ACP 服务端子进程。
2. 等待 2 秒观察服务端是否主动发帧（结果：无）。
3. 发送 NDJSON 帧：`JSON.stringify(initializeRequest) + '\n'`，请求体：
   ```json
   {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"client":{"name":"sacode-acp-frame-probe","version":"0.1.0"}}}
   ```
4. 5 秒内收到 532 字节响应（单行 JSON），**未触发 Content-Length 补发探测**。
5. 原始 stdout 字节经 `JSON.parse` 成功解析为合法 JSON-RPC 2.0 响应。

## 3. 原始响应（已解析）

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": 1,
    "agentCapabilities": {
      "loadSession": true,
      "mcpCapabilities": { "http": true, "sse": false },
      "promptCapabilities": { "embeddedContext": true, "image": true },
      "sessionCapabilities": {
        "additionalDirectories": {},
        "close": {},
        "delete": {},
        "fork": {},
        "list": {},
        "resume": {}
      },
      "_meta": { "opencode/child-session-updates": true }
    },
    "authMethods": [
      {
        "description": "Run `opencode auth login` in the terminal",
        "name": "Login with opencode",
        "id": "opencode-login"
      }
    ],
    "agentInfo": { "name": "OpenCode", "version": "2.0.24" }
  }
}
```

## 4. 能力清单（对 design.md 的输入）

| ACP verb | OpenCode 支持 | 备注 |
|----------|:---:|------|
| `initialize` | ✅ | 已实测，protocolVersion=1 |
| `loadSession` | ✅ | `agentCapabilities.loadSession: true` |
| `session/new` | ✅ | `sessionCapabilities` 无 `new` 键，但 `prompt` 隐含创建 |
| `session/prompt` | ✅ | `promptCapabilities` 有 `embeddedContext` + `image` |
| `session/resume` | ✅ | `sessionCapabilities.resume: {}` |
| `session/list` | ✅ | `sessionCapabilities.list: {}` |
| `session/close` | ✅ | `sessionCapabilities.close: {}` |
| `session/delete` | ✅ | `sessionCapabilities.delete: {}` |
| `session/fork` | ✅ | `sessionCapabilities.fork: {}` |
| `session/additionalDirectories` | ✅ | `sessionCapabilities.additionalDirectories: {}` |
| `cancel` | 待核 | initialize 未声明（可能走 `$/cancelRequest`） |

### `_meta` 扩展

OpenCode 声明了 `_meta: {"opencode/child-session-updates": true}`，这是产品专属扩展字段，`AcpProductAdapter.parseMeta` 须处理。

### 认证

`authMethods` 返回单条 `opencode-login`，描述为"Run `opencode auth login` in the terminal"。无 API Key 字段，认证走 opencode 自有登录流程（PRD §4.4 "无或环境变量"待核项 #5 部分解锁——认证方式为 opencode-login，非 API Key）。

## 5. 对后续任务的影响

| 任务 | 影响 |
|------|------|
| **design §2.11.3 帧格式待核** | OpenCode 已核：NDJSON；CodeBuddy/Qoder 仍待核 |
| **design §2.4.2 AcpProcess 帧编解码** | OpenCode 路径可直接复用 `ExtProcess` NDJSON 逻辑 |
| **tasks 2.2 AcpProcess** | OpenCode `frameCodec = NDJSON`；通用层仍需保留 Content-Length 编解码能力（其他产品可能不同） |
| **tasks 7.x OpenCode 接入** | 认证走 `opencode-login` 流程，不是 API Key；`_meta` 须处理 `child-session-updates` |
| **spec §9.4 帧格式兼容性** | OpenCode = NDJSON（已核）；兼容性结论 1 部分解锁 |

## 6. 可复现性

```bash
# 前置：opencode v2.0.24 已安装（/c/Users/jingg/.codearts/runtimes/node/opencode.cmd）
cd D:\Project\sa\saai\sa-code
node apps/desktop/test-support/acp-frame-probe.mjs
# 期望输出：verdict.format = "ndjson"，protocolVersion = 1
```

- 探针脚本路径：`apps/desktop/test-support/acp-frame-probe.mjs`
- 探针版本：0.1.0
- opencode 版本：v2.0.24
- Windows 11 / Node v22 / Git Bash
- 探针仅发 `initialize`（协议探测），未发 `session/new` 或 `session/prompt`（无委派副作用）