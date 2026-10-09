# SaCode Hooks 生命周期事件系统设计（2026-10-09）

## 1. 概述

### 1.1 目标

实现 Qwen Code 式的 hooks 生命周期拦截器子系统，允许用户在 agent loop 关键节点（工具执行前后、会话生命周期、权限请求、压缩、子代理启停、todo 管理等）注入自定义逻辑，实现安全策略强制、工具输入修改、上下文注入、决策阻断等能力。

### 1.2 范围

- **包含**：20 种生命周期事件的注册表、matcher 匹配、command/http 执行器、决策返回路径、会话日志集成、settings.json 配置读取、安全模型
- **不包含**：cron 引擎（schedule.cj 保留）、工作流编排（workflow.cj 保留）、外部 webhook 投递（webhook.cj 保留）、UI 配置界面

### 1.3 非目标

- 不替代 approval.cj（Hook 优先、approval 回退）
- 不统一 webhook/schedule/workflow（共存，职责分离）
- 不提供 function/prompt 执行器类型（仅 command/http）

### 1.4 成功标准

- 至少 5 种事件（PreToolUse、UserPromptSubmit、PermissionRequest、SessionStart、Stop）可触发并返回决策
- Command/http 执行器可执行并返回 allow/deny/block/ask
- 决策正确影响控制流（PreToolUse allow 跳过审批、deny 拒绝执行）
- Hook 事件全量写入会话日志（可回放）
- settings.json 配置生效（项目级 > 用户级）

## 2. 架构

### 2.1 核心组件

新增 `core/src/hook_registry.cj`，包含：

- `HookEvent`：20 种事件的枚举
- `HookRule`：注册规则（id, event, matcher, executor, timeout, async, active）
- `HookRegistry`：集中注册表
  - `register(rule)`：注册规则，重复 id 抛 `duplicate-hook-rule-id`
  - `unregister(id)`：软删（active=false），未知 id 抛 `unknown-hook-rule-id`
  - `match(event, target)`：按 event + matcher 正则匹配，返回 active 规则列表
  - `dispatch(event, input, target)`：匹配并执行，返回聚合 HookResult
- `HookExecutor`：执行器
  - `executeCommand(rule, input)`：spawn 子进程，stdin JSON，读 stdout，退出码判定
  - `executeHttp(rule, input)`：POST JSON，SSRF 防护，读响应体
- `HookInput`：标准化输入（sessionId, cwd, hookEventName, timestamp + eventSpecific）
- `HookResult`：决策返回（decision, reason, additionalContext, updatedInput, continueFlag）

### 2.2 Dispatch 流程

1. `match(event, target)` 匹配 active 规则
2. 对每条命中规则，按 executorType 调用对应执行器
3. 聚合结果：deny 优先 → ask → allow
4. 写会话日志：`hook/dispatch` → `hook/result` → `hook/decision`
5. 返回最终 HookResult

### 2.3 执行位置

Core 内注册+执行：
- command 类型复用 extproc.cj 子进程模式
- http 类型复用 web.cj HTTP 客户端
- 决策直接回传 agent loop
- Hook 事件写进会话日志可回放

### 2.4 与现有子系统的关系

- **与 approval.cj**：Hook 优先、approval 回退
  - PreToolUse allow → 跳过审批
  - PreToolUse deny/block → 拒绝
  - PreToolUse ask / 无 hook → 进入 approval CAS
- **与 webhook/schedule/workflow**：共存，职责分离
  - webhook.cj：外部事件投递
  - schedule.cj：定时任务
  - workflow.cj：工作流状态机
  - hook_registry.cj：生命周期拦截
- **与会话日志**：全量写入（`hook/dispatch`、`hook/result`、`hook/decision`）

## 3. Hook 事件定义

### 3.1 20 种事件

| 事件 | 触发时机 | Matcher 目标 | 决策返回 | Fire-and-forget |
|------|----------|-------------|----------|-----------------|
| `PreToolUse` | 工具执行前 | 工具 id | ✅ | ❌ |
| `PostToolUse` | 工具成功执行后 | 工具 id | ✅ | ❌ |
| `PostToolUseFailure` | 工具执行失败后 | 工具 id | ✅ | ❌ |
| `UserPromptSubmit` | 模型调用前 | 无 | ✅ | ❌ |
| `SessionStart` | 会话开始或恢复 | 来源 | ✅ | ❌ |
| `SessionEnd` | 会话结束 | 原因 | ✅ | ❌ |
| `SessionDelete` | 会话被删除 | 无 | ❌ | ✅ |
| `MessageDisplay` | 回复流式传输时 | 无 | ❌ | ✅ |
| `Stop` | 准备结束响应时 | 无 | ✅ | ❌ |
| `StopFailure` | 因 API 错误或循环检测结束 | error 字段 | ✅ | ❌ |
| `SubagentStart` | 子代理启动 | 代理类型 | ✅ | ❌ |
| `SubagentStop` | 子代理停止 | 代理类型 | ✅ | ❌ |
| `PreCompact` | 对话压缩前 | 触发器（精确） | ✅ | ❌ |
| `PostCompact` | 压缩完成后 | 触发器（精确） | ✅ | ❌ |
| `Notification` | 发送通知时 | 类型（精确） | ✅ | ❌ |
| `PermissionRequest` | 显示权限对话框 | 工具 id | ✅ | ❌ |
| `PermissionDenied` | AUTO 模式拒绝工具 | 工具 id | ✅ | ❌ |
| `TodoCreated` | 创建新 todo 项 | 无 | ✅ | ❌ |
| `TodoCompleted` | todo 项标记完成 | 无 | ✅ | ❌ |

### 3.2 HookInput 契约

```cangjie
public struct HookInput {
    public let sessionId: String
    public let transcriptPath: String
    public let cwd: String
    public let hookEventName: String
    public let timestamp: Int64
    public let agentId: Option<String>
    public let agentType: Option<String>
    public let eventSpecific: HookEventData
}

public enum HookEventData {
    Tool { toolId: String, toolInput: String }
    Prompt { submittedPrompt: Option<String>, prompt: String }
    Session { source: String }
    End { reason: String }
    Delete {}
    Message { role: String, contentPreview: String }
    Stop { contextUsage: Int64, contextLimit: Int64, inputTokens: Int64 }
    StopFailure { error: String }
    Subagent { agentId: String, agentType: String }
    Compact { trigger: String }
    Notification { type: String }
    Permission { toolId: String }
    Todo { todoId: String, content: String }
}
```

### 3.3 HookResult 契约

```cangjie
public struct HookResult {
    public let decision: HookDecision
    public let reason: Option<String>
    public let additionalContext: Option<String>
    public let updatedInput: Option<String>
    public let continueFlag: Bool
    public let suppressOutput: Bool
    public let systemMessage: Option<String>
}

public enum HookDecision {
    Allow, Deny, Block, Ask
}
```

### 3.4 Matcher 规则

- `""` 或 `"*"` 匹配该类型所有事件
- 支持标准正则（`^run_shell_command$`、`read_.*`）
- 匹配目标因事件而异（见 3.1 表）

## 4. 执行器与安全

### 4.1 Command 执行器

- spawn 子进程（复用 extproc.cj 模式）
- stdin 写入 JSON（紧凑格式）
- 等待退出（带超时）
- 退出码判定：
  - `0`：解析 stdout JSON → HookResult
  - `2`：阻塞错误，stderr 作为 reason，decision=Deny
  - 其他：非阻塞错误，忽略 stderr，继续 Allow

### 4.2 Http 执行器

- SSRF 防护：拦截私有 IP（允许环回）
- DNS 验证防重绑定
- 环境变量插值仅允许 `allowedEnvVars` 白名单
- 云元数据端点（169.254.169.254）永远阻止
- 永不跟随重定向
- 非 2xx 响应：非阻塞错误，Allow

### 4.3 安全模型

- URL 白名单：`security.allowedHookUrls`
- 环境变量白名单：`security.allowedHookEnvVars`
- 私有网络 hook：`security.allowPrivateNetworkHooks`（默认 false）
- 超时回收：异步 hook 10 个槽位，默认 60 秒
- 用户权限运行：项目级 hook 需要受信任文件夹

### 4.4 配置格式

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "^run_shell_command$",
        "sequential": false,
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/check.sh",
            "timeout": 30000,
            "env": { "LEVEL": "strict" },
            "async": false
          }
        ]
      }
    ]
  },
  "security": {
    "allowPrivateNetworkHooks": false,
    "allowedHookUrls": ["http://localhost:8080/hook"],
    "allowedHookEnvVars": ["AUDIT_TOKEN"]
  }
}
```

配置读取位置：
- 用户级：`~/.sacode/settings.json`
- 项目级：`<workspace>/.sacode/settings.json`
- 优先级：项目级 > 用户级
- 读取逻辑复用 `worktree_setup.cj`

## 5. 触发点与集成

### 5.1 触发点清单

| 文件 | 事件 | 决策影响 |
|------|------|---------|
| `pipeline.cj` | PreToolUse | allow 跳过审批，deny 拒绝 |
| `pipeline.cj` | PostToolUse | 注入 additionalContext |
| `pipeline.cj` | UserPromptSubmit | deny 拒绝 prompt |
| `pipeline.cj` | Stop | continueFlag=false 阻止结束 |
| `session.cj` | SessionStart/End/Delete | fire-and-forget |
| `approval.cj` | PermissionRequest | allow 跳过审批 |
| `agent.cj` | SubagentStart/Stop | fire-and-forget |
| `compaction.cj` | Pre/PostCompact | fire-and-forget |
| `todo.cj` | TodoCreated/Completed | deny 阻止创建 |
| 投影层 | MessageDisplay/Notification | fire-and-forget |

### 5.2 集成约束

- 所有 dispatch 调用在会话日志写入之后
- 决策型事件结果必须影响控制流
- Fire-and-forget 事件结果被忽略
- Hook 事件全量写入会话日志

## 6. 测试策略

### 6.1 单元测试（core/src/hook_registry_test.cj）

- 注册/注销/重复 id 拒
- Matcher 正则匹配（空/"*"、精确、正则）
- Command 执行器：exit 0/2/其他
- Http 执行器：200/非 2xx/SSRF 拦截
- 聚合结果：deny 优先
- 会话日志写入验证

### 6.2 集成测试

- PreToolUse allow 跳过审批
- PreToolUse deny 拒绝执行
- UserPromptSubmit block 阻止 prompt
- PermissionRequest allow 跳过审批
- Hook 事件回放验证

### 6.3 变异反证

- 注入 deny hook，验证工具执行被拒绝
- 注入 allow hook，验证审批被跳过
- 注入 updatedInput，验证工具输入被修改

## 7. 验收标准

### 7.1 功能验收

- [ ] 5 种事件（PreToolUse、UserPromptSubmit、PermissionRequest、SessionStart、Stop）可触发
- [ ] Command/http 执行器返回 allow/deny/block/ask
- [ ] PreToolUse allow 跳过审批，deny 拒绝执行
- [ ] Hook 事件全量写入会话日志
- [ ] settings.json 配置生效（项目级优先）

### 7.2 安全验收

- [ ] SSRF 拦截私有 IP
- [ ] DNS 防重绑定
- [ ] 环境变量白名单生效
- [ ] 云元数据端点阻止
- [ ] 超时回收异步 hook

### 7.3 文档验收

- [ ] AGENTS.md 更新：Hooks 子系统说明
- [ ] PRD F13 验收标准覆盖
- [ ] 设计文档（本 spec）已提交

## 8. 后续方向

- 实现 `core/src/hook_registry.cj` + `hook_registry_test.cj`
- 在 `pipeline.cj`/`session.cj`/`approval.cj` 等插入 dispatch 调用
- 实现 settings.json 读取（复用 worktree_setup.cj）
- 实现 SSRF 防护与 URL 白名单
- 编写集成测试与变异反证
- 更新 AGENTS.md 与 PRD 引用

---

**设计决策记录**：
- 2026-10-09：Core 内注册+执行（用户裁决）
- 2026-10-09：Hook 优先、approval 回退（用户裁决）
- 2026-10-09：全量写入会话日志（用户裁决）
- 2026-10-09：集中注册表 + 事件分派（用户裁决）
- 2026-10-09：与 webhook/schedule/workflow 共存（设计假设，待用户确认）

**来源**：
- Qwen Code Hooks 文档：https://qwenlm.github.io/qwen-code-docs/zh/users/features/hooks/
- SaCode PRD F13：`docs/product/PRD.md:106-107, 238, 276`
- 现状证据：`docs/evidence/p0-status-2026-10-02.md:308`
- 对比分析：`docs/evidence/qwen-hooks-vs-sacode-hooks-2026-10-09.md`
