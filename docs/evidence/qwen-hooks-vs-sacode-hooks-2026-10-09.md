# Qwen Code Hooks vs SaCode Hooks 概念对比（2026-10-09）

本报告对比 Qwen Code 的 hooks 机制与 SaCode 当前的 webhook/schedule/workflow 实现，澄清两者虽同名但语义、职责、触发时机完全不同，并指出 SaCode 要实现 Qwen Code 式 hooks 所需的新增能力。

## 1. 概念定位差异

| 维度 | Qwen Code Hooks | SaCode 当前实现 |
|------|-----------------|-----------------|
| **核心定义** | 用户定义脚本/程序，在**应用生命周期预定义节点**自动执行（PreToolUse、SessionStart、Stop 等） | `webhook.cj` / `schedule.cj` / `workflow.cj` 三个 registry 切片，均为**仅登记**状态 |
| **设计意图** | 在 agent loop 关键点注入用户逻辑：监控工具调用、强制安全策略、阻断/批准工具执行、注入上下文 | PRD F13 定义为「自动化与 Hooks：开发者查看配置并安排任务」，但目前 core/src **无 hooks 注册表或触发点定义**（p0-status §8 F13 已标注「仅登记」） |
| **触发位置** | agent loop 内部（工具执行前后、会话开始/结束、压缩前后、权限请求等） | 外部事件投递（webhook.cj 的 dispatch 只按 kind 匹配并计数，不回传决策） |

**结论**：Qwen Code 的 "hooks" ≈ agent 生命周期拦截器；SaCode 的 "webhook" ≈ 外部事件投递 registry。一个向内（拦截 agent 行为），一个向外（通知外部系统）。

## 2. 事件覆盖面对比

Qwen Code 有 **20 种 hook 事件**，覆盖工具执行前后、会话生命周期、权限、压缩、子代理、todo 等。SaCode 目前对应的是：

| Qwen Code 事件 | SaCode 对应 | 状态 | 备注 |
|----------------|-------------|------|------|
| `PreToolUse` | 无 | **不存在** | 有 `approval.cj`（工具审批 CAS），但无 hook 触发点 |
| `PostToolUse` | 无 | **不存在** | 同上 |
| `PostToolUseFailure` | 无 | **不存在** | 同上 |
| `UserPromptSubmit` | 无 | **不存在** | 有提示词增强（`pipeline.cj`），但不是 hook 机制 |
| `SessionStart` | 无 | **不存在** | 有 `boot_actions.cj` 但不是 hook |
| `SessionEnd` | 无 | **不存在** | 同上 |
| `SessionDelete` | 无 | **不存在** | 同上 |
| `Stop` | 无 | **不存在** | 无 |
| `StopFailure` | 无 | **不存在** | 无 |
| `PreCompact` | 无 | **不存在** | 压缩仅登记（`compaction.cj`） |
| `PostCompact` | 无 | **不存在** | 同上 |
| `SubagentStart` | 无 | **不存在** | 有子代理但无 hook 触发点 |
| `SubagentStop` | 无 | **不存在** | 同上 |
| `PermissionRequest` | 无 | **不存在** | 有审批 CAS 但不是 hook |
| `PermissionDenied` | 无 | **不存在** | 同上 |
| `TodoCreated` | 无 | **不存在** | 有 todo 切片但无 hook |
| `TodoCompleted` | 无 | **不存在** | 同上 |
| `Notification` | 无 | **不存在** | 无 |
| `MessageDisplay` | 无 | **不存在** | 无 |
| — | `webhook.cj` | 有 register/unregister/dispatch，但**未接真回调** | 只统计数量，fire-and-forget |
| — | `schedule.cj` | 有 register/pause/fire，但**未接 cron 引擎** | 无时区/去重/重放策略 |
| — | `workflow.cj` | 有 start/done/fail 状态机，但**未接编排执行** | 无依赖图/重试策略 |

**关键证据**：
- `core/src/webhook.cj:47-55`：`dispatch(deliveryId, kind)` 只返回匹配的 active 规则数（Int64），不回传 allow/deny/block 语义。
- `core/src/schedule.cj:69-75`：`fire(deliveryId, taskId)` 只返回 0 或 1，不执行 cron。
- `core/src/workflow.cj:51-84`：`start/done/fail` 只做状态机标记，不接编排执行。
- `docs/evidence/p0-status-2026-10-02.md:308`：F13 标注「webhook/schedule/workflow 三切片均'未接真回调'」。

## 3. 执行器类型

| Qwen Code | SaCode |
|-----------|--------|
| `command`（shell + stdin JSON + stdout 返回） | **无** |
| `http`（POST JSON + SSRF 防护 + 环境变量白名单） | **无**（webhook.cj 只记 rule，不执行 HTTP） |
| `function`（进程内 JS 回调） | **无** |
| `prompt`（LLM 评估返回决策） | **无** |

Qwen Code 的 HTTP hook 有完整安全模型：URL 白名单、SSRF 防护（拦截私有 IP）、DNS 验证防重绑定、环境变量插值白名单（`allowedEnvVars`）、永不跟随重定向。

## 4. 阻断/决策能力

Qwen Code 的 hook 可以**阻断或修改 agent 行为**：

| 事件 | 决策返回 | 附加能力 |
|------|----------|----------|
| `PreToolUse` | `hookSpecificOutput.permissionDecision`：allow/deny/ask | `updatedInput` 修改工具输入参数；`additionalContext` 注入上下文 |
| `PostToolUse` | `decision`：allow/deny/block | `additionalContext` 注入额外信息 |
| `UserPromptSubmit` | `decision`：allow/deny/block/ask | `additionalContext` 包裹在 `<qwen:user-prompt-submit-context>` 标签中追加 |
| `Stop` | `decision`：allow/deny/block/ask | `continue: false` 阻止结束；`stopReason` 反馈 |
| `TodoCreated/Completed` | `decision`：allow/block/deny | 阻止时必填 `reason` |
| `MessageDisplay/StopFailure/SessionDelete` | fire-and-forget | 输出和退出码被忽略 |

Command hook 退出码行为：
- `0`：成功，解析 stdout 中的 JSON 控制行为
- `2`：**阻塞错误**，忽略 stdout，将 stderr 作为错误反馈传递给模型
- 其他：非阻塞错误，stderr 仅在调试模式下显示，继续执行

SaCode 的三个 registry **完全没有决策返回路径**——dispatch/fire 只返回匹配条数（Int64），不回传 allow/deny/block 语义，也没有把结果注入回 agent loop 的通路。

## 5. 配置方式

| Qwen Code | SaCode |
|-----------|--------|
| `.qwen/settings.json` 里 `hooks` 块 | PRD F13 计划「Hooks 读取用户级 settings.json」，但接口设计文档（sacode-product-interfaces）只列了 `hooks/describe` 一个动词，**未实现** |
| 格式：事件→matcher→hooks 数组分层 | 无 |
| matcher 支持正则匹配工具 id（`^run_shell_command$`、`read_.*`） | 无 |
| `sequential`（强制顺序）/`async`（后台运行）/`timeout`/`env`/`shell` | 无 |

Qwen Code 的配置示例：
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
            "command": "/path/to/security-check.sh",
            "name": "security-check",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

## 6. 产品口径与验收要求

PRD F13 明确：
- **功能**：左侧自动化；项目/用户范围、触发条件、运行历史、暂停、取消；Hooks 读取用户级 settings.json，标注所属本地 Agent。
- **验收**：仅反映磁盘声明，不代表 CLI 已加载/执行；重复触发去重，重启错过触发策略明确；无人值守不能绕过授权。

PRD §6 验收标准（F13 行）：
- 有效自动化→触发→单次执行与历史
- 只有 Hooks 声明→查看→不显示已加载/执行
- 重启/重复触发→按明确策略补偿或跳过并记录

**当前状态**：以上均未实现。webhook/schedule/workflow 三个切片只做 log-only 事件与 registry 状态机，不接真回调、不读 settings.json、不提供决策返回路径。

## 7. 关键差距总结

1. **SaCode 没有"生命周期 hook"这个概念**。现有的 webhook/schedule/workflow 是上游 DSH 矩阵里的独立子系统（外部 webhook 投递、定时任务、工作流编排），不是 Qwen Code 意义上的"在 agent loop 关键点插入用户逻辑"。

2. **两者同名但语义不同**：Qwen Code 的 "hooks" 向内拦截 agent 行为；SaCode 的 "webhook" 向外通知外部系统。

3. **如果 SaCode 要做 Qwen Code 式的 hooks**，需要新增：
   - hook 事件注册表（PreToolUse/PostToolUse/SessionStart/Stop/PreCompact/PermissionRequest/SubagentStart/TodoCreated 等 20 种）
   - 触发点：在 agent loop 的工具执行前后、会话开始/结束、压缩前后、权限请求、子代理启停、todo 创建/完成等位置插入 dispatch 调用
   - 执行器：至少 command（stdin JSON + stdout JSON）和 http（带 SSRF 防护）
   - 决策返回路径：allow/deny/block + reason + additionalContext 注入
   - 配置文件：settings.json 的 hooks 块 + matcher 正则 + sequential/async/timeout/env
   - 这在 PRD F13 里已有产品口径，但 core/src **零实现**

## 8. 后续方向

- 若需实现 Qwen Code 式 hooks，需先在 `docs/plans/` 下新增 `hooks-lifecycle-design.md`，定义 20 种事件的触发点、输入契约、决策返回路径。
- `core/src/` 需新增 `hook_registry.cj`（事件注册 + matcher 正则匹配 + 执行器调用），并在 `session.cj`/`pipeline.cj`/`approval.cj` 等关键位置插入 dispatch 调用。
- settings.json 读取需复用或扩展 `worktree_setup.cj` 的 settings 逻辑。
- 安全模型（SSRF 防护、环境变量白名单、超时回收）需在 host 层实现。

---

**来源**：
- Qwen Code Hooks 文档：https://qwenlm.github.io/qwen-code-docs/zh/users/features/hooks/
- SaCode PRD F13：`docs/product/PRD.md:106-107, 238, 276`
- webhook/schedule/workflow 实现：`core/src/{webhook,schedule,workflow}.cj`
- 当前状态登记：`docs/evidence/p0-status-2026-10-02.md:308`
- 能力矩阵校正：`docs/plans/dsh-capability-matrix.md:144, 174`
