# ACP 帧格式探针报告 · 三产品全量（OpenCode / CodeBuddy / Qoder）

> 探针时间：2026-10-08 10:08（UTC+8）
> 探针脚本：`apps/desktop/test-support/acp-frame-probe-multi.mjs`
> 功能标识：`acp_collaboration` · 任务 1.1（三产品全量完成）

## 1. 总结论

| 产品 | 版本 | 帧格式 | 协议版本 | 启动命令 | 认证方式 |
|------|------|--------|---------|---------|---------|
| OpenCode | v2.0.24 | **NDJSON** | 1 | `opencode acp` | `opencode-login` |
| CodeBuddy | v2.162.0 | **NDJSON** | 1 | `codebuddy --acp` | `iOA` / `external` / `internal` / `selfhosted` |
| Qoder | v1.1.65 | **NDJSON** | 1 | `qoder --acp` | `qodercli-login` |

**关键发现**：三产品帧格式**完全统一为 NDJSON**（单行 JSON + `\n`），与本仓 `ExtProcess` 现有帧格式一致。`AcpProductAdapter.frameCodec` 对三产品均选 **NDJSON**，可直接复用 `ExtProcess` 的帧编解码，**无需实现 Content-Length 策略**。

## 2. 三产品能力对比

| 维度 | OpenCode | CodeBuddy | Qoder |
|------|:---:|:---:|:---:|
| protocolVersion | 1 | 1 | 1 |
| loadSession | ✅ | ✅ | ✅ |
| promptCapabilities.image | ✅ | ✅ | ✅ |
| promptCapabilities.embeddedContext | ✅ | ✅ | ✅ |
| mcpCapabilities.http | ✅ | ✅ | ✅ |
| mcpCapabilities.sse | ❌ | ✅ | ✅ |
| sessionCapabilities.close | ✅ | ❌（未声明） | ✅ |
| sessionCapabilities.delete | ✅ | ❌ | ✅ |
| sessionCapabilities.fork | ✅ | ❌ | ✅ |
| sessionCapabilities.list | ✅ | ❌ | ✅ |
| sessionCapabilities.resume | ✅ | ❌ | ✅ |
| sessionCapabilities.additionalDirectories | ✅ | ❌ | ✅ |
| delegateToolsSupport | ❌ | ✅ | ❌ |
| multitaskSupport | ❌ | ✅ | ❌ |
| metaPromptSupport | ❌ | ✅ | ❌ |
| mainAgentSupport | ❌ | ❌（false） | ❌ |

### 产品专属 `_meta` 扩展

| 产品 | `_meta` 字段 | 语义 |
|------|-------------|------|
| OpenCode | `opencode/child-session-updates: true` | 子会话更新通知 |
| CodeBuddy | `codebuddy.ai/conversationRequestId` | 客户端轮次 ID（UUIDv7） |
| CodeBuddy | `codebuddy.ai/teamUpdate` | Agent Teams 状态事件 |
| CodeBuddy | `codebuddy.ai/memberEvent` | 成员流式消息标记 |
| CodeBuddy | `codebuddy.ai/unsolicitedTurn` | 非用户发起的 drain 轮 |
| CodeBuddy | `codebuddy.ai/userinfo` | 认证后用户信息 |
| Qoder | `qoder.promptQueueing: true` | 提示排队 |

### 认证差异

| 产品 | 认证方法 | 凭据来源 |
|------|---------|---------|
| OpenCode | `opencode-login` | `opencode auth login`（浏览器登录） |
| CodeBuddy | `iOA` / `external` / `internal` / `selfhosted` | `CODEBUDDY_API_KEY` 环境变量 + `CODEBUDDY_INTERNET_ENVIRONMENT`（internal/ioa/不设） |
| Qoder | `qodercli-login` | `qoder login`（浏览器）或 `QODER_PERSONAL_ACCESS_TOKEN` 环境变量 |

## 3. CodeBuddy 方言方法（已核）

| 方法 | 参数 | 用途 |
|------|------|------|
| `session/set_config_option` | `{sessionId, configId:"multitask", type:"boolean", value:true}` | 标准写入：开启 multitask |
| `session/set_multitask` | `{sessionId, enabled?:boolean}` | 方言兼容：toggle multitask |
| `getConfigOptions` / `setSessionConfigOption` | `context_window` | 上下文窗口档位（200K/1M） |

CodeBuddy `multitaskSupport: true` + `delegateToolsSupport: true` 是独有能力，其他两产品未声明。

## 4. Qoder 特性（已核）

- **工具代理**：文件操作（fs.readTextFile/fs.writeTextFile）+ 终端操作（terminal）代理给客户端
- **命令列表推送**：`available_commands_update`
- **运行模式**：默认 + bypass permissions（`--yolo`）
- **提示排队**：`_meta.qoder.promptQueueing`

## 5. Windows 启动路径

| 产品 | PATH 可用 | 真实路径（GUI 用） |
|------|:---:|------|
| OpenCode | `.cmd` 包装 | `C:\Users\jingg\.codearts\runtimes\node\node_modules\@opencode\cli\bin\opencode.exe` |
| CodeBuddy | ✅ | `/c/Users/jingg/AppData/Local/codebuddy/bin/codebuddy` |
| Qoder | `.cmd` 包装 | `C:\Users\jingg\.qoder\entry\qoder.cmd`（PowerShell dispatcher） |

**注意**：Windows 上 OpenCode 的 PATH 条目是 `.ps1` 包装脚本，GUI 编辑器（如 Zed）跑不起来，要填真实 exe 路径。Qoder 的 `.cmd` 是 PowerShell dispatcher，`shell:true` 可正常 spawn。

## 6. 对后续任务的影响

| 待核项 | 状态 | 影响 |
|--------|:---:|------|
| 1.1 帧编解码逐产品实测 | ✅ 全核 | 三产品 NDJSON，AcpProcess 直接复用 ExtProcess |
| 1.2 Qoder CLI ACP 入口 | ✅ 全核 | `qoder --acp`，认证 `qodercli-login`/`QODER_PERSONAL_ACCESS_TOKEN` |
| 1.3 CodeBuddy `_meta` 字段 | ✅ 全核 | conversationRequestId/teamUpdate/memberEvent/unsolicitedTurn 语义已核 |
| 1.5 OpenCode 认证 | ✅ 已核 | `opencode-login`（非 API Key） |
| design §2.11.3 帧格式 | ✅ 全核 | 三产品统一 NDJSON |
| design §2.4.3 产品适配 | ✅ 已核 | 三产品能力清单 + `_meta` + 方言方法已登记 |

## 7. 可复现性

```bash
cd D:\Project\sa\saai\sa-code
# OpenCode
node apps/desktop/test-support/acp-frame-probe.mjs
# CodeBuddy
node apps/desktop/test-support/acp-frame-probe-multi.mjs --cmd codebuddy --args --acp
# Qoder
node apps/desktop/test-support/acp-frame-probe-multi.mjs --cmd "C:\Users\jingg\.qoder\entry\qoder.cmd" --args --acp
```

- 探针仅发 `initialize`（协议探测），未发 `session/new` 或 `session/prompt`
- 三产品均在 NDJSON initialize 后 5 秒内返回响应
- 探针脚本版本：0.2.0（multi）/ 0.1.0（原版）