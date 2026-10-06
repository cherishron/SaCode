# 接口变更单：完成证据声明侧（update_goal 工具分支）

> 编号：W50-claim-001
> 日期：2026-10-07
> 作者：W50（目标子系统）
> 交付对象：E（工具运行时/agent.cj 维护者）
> 优先级：高——claim 闭包恒假导致 active 目标只能跑到限额落 blocked，无法自动完成
> 前置条件：批 1 已落库（3e16664），机械侧 `GoalEvidence` 已就绪

---

## 1. 背景与问题

完成证据 = 机械侧（`goal/evidence` 日志事件，由 `GoalEvidence.record()` 落盘）
　　∧ 声明侧（模型显式声明达成，走 `claim: () -> Bool` 闭包）。

当前 `claim` 闭包恒假（`goal_runner.cj:54`），因为声明侧需要在 `ToolRuntime.pipeline` 上加 `update_goal` 分支，而该分支尚未实现。

**后果**：active 目标无法自动完成，只能跑到限额落 `blocked`。用户必须手动改状态。

---

## 2. 接入点

### 2.1 执行器注册

**文件**：`core/src/agent.cj`
**方法**：`registerBuiltinExecutors()`（第 137-148 行）
**操作**：新增一行

```
executors.add("update_goal", { _, a => updateGoalStep(a) })
```

### 2.2 执行器实现

**文件**：`core/src/agent.cj`
**新增方法**：`private func updateGoalStep(args: String): ApprovalOutcome`

**入参 JSON Schema**（additionalProperties: false）：

```json
{
  "type": "object",
  "properties": {
    "goal_id": { "type": "string", "description": "目标标识" },
    "status": { "type": "string", "enum": ["completed", "in_progress"], "description": "目标状态" }
  },
  "required": ["goal_id", "status"]
}
```

**参数校验规则**（与 read/edit/bash 一致的逐键检查法）：
- 只允许 `goal_id` 和 `status` 两个键
- `goal_id` 非空字符串
- `status` 只接受 `"completed"` 或 `"in_progress"`；其他值一律拒因为 `bad-args`
- 多余字段一律拒因为 `bad-args`

### 2.3 授权检查

- `update_goal` 的 `needsApproval` 在 ToolSpec 声明中设为 `false`（不需要审批）
- 但 `allowedByGuard` 仍然走 pipeline 的统一 guard 检查（第 226-231 行）
- 如果 guard 拒了，归一成 `guard-denied`，不执行

### 2.4 错误码

| 场景 | 错误码 | recordResult |
|------|--------|-------------|
| 参数不是合法 JSON | `bad-args` | `bad-args` |
| 多余字段 | `bad-args` | `bad-args` |
| `goal_id` 为空 | `bad-args` | `bad-args` |
| `status` 不在枚举内 | `bad-args` | `bad-args` |
| 目标不存在 | `goal-not-found` | `goal-not-found:<goal_id>` |
| 目标非 active | `goal-not-active` | `goal-not-active:<goal_id>:<actual_phase>` |
| 成功（status=completed） | `ok` | `ok-goal-completed:<goal_id>` |
| 成功（status=in_progress） | `ok` | `ok-goal-update:<goal_id>` |

### 2.5 声明侧与机械侧的合流

`update_goal` 成功（`status=completed`）后，需要让 `GoalRunner` 的 `claim` 闭包返回 `true`。

**推荐方案**：在 `SessionLog` 落一条 `goal/claim` 事件（log-only，不进 `isSurfaceEvent`），`claim` 闭包读日志判断是否有匹配的声明。

```
// goal_runner.cj 的 claim 闭包改为：
claim: () -> Bool = { => GoalClaim(log).claimedFor(revision, round) }
```

**`GoalClaim` 需要新建**（`core/src/goal_claim.cj`）：
- `record(goalId: String, revision: Int64): Bool` — 落 `goal/claim` 事件
- `claimedFor(revision: Int64, round: Int64): Bool` — 纯读日志，判断是否有匹配声明
- 与 `GoalEvidence` 对称：证据绑修订+轮次，声明也绑修订+轮次

---

## 3. 不改的部分

- **`ToolRuntime.pipeline` 签名不变**：仍然是 `pipeline(name, args, allowedByGuard) -> ApprovalOutcome`
- **`executors` 表结构不变**：仍然是 `Map<String, (String, String) -> ApprovalOutcome>`
- **`ApprovalOutcome` 不变**：仍然是 `ApprovalOutcome(ok: Bool, detail: String)`
- **guard 链不变**：`update_goal` 走与 `read`/`edit` 同样的 guard 前置检查
- **`ToolSpec` 声明面由各入口自行注册**：与 `read`/`edit` 一致

---

## 4. 测试要求

- `updateGoalStep` 的参数校验测试：空 goal_id、非法 status、多余字段、合法调用
- `GoalClaim.record` + `claimedFor` 的日志回放测试
- 端到端：`update_goal(status=completed)` → `claim` 闭包返回 true → `evidence ∧ claim` → 目标完成

---

## 5. 与 W00 路径所有权的交集

`agent.cj` 属于 E 的所有权范围（W00 规则 3）。本变更单只描述接口，不直接改 `agent.cj`。E 确认后自行排期实现。

---

## 6. 追溯

- spec：`.codeartsdoer/specs/plugin_lifecycle/spec.md` §5.6（完成闸双证据）
- 设计：`.codeartsdoer/specs/plugin_lifecycle/design.md` §2.1.3(4)
- 代码：`core/src/goal_runner.cj:54`（claim 闭包接线位）
- 代码：`core/src/goal_evidence.cj`（机械侧实现）
- 代码：`core/src/agent.cj:137-148`（执行器注册点）
