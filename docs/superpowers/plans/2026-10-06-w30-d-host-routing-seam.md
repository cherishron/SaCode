# W30（D）→ W00/W90（A）接口变更单：模型中心接入真实请求路径

提交人：D（W30 模型与计费供应商、模型路由、熔断、费用）
日期：2026-10-06
状态：**待 A 接单**（D 本批 core 侧已完成，等 A 接 host 侧线）

判据（`docs/superpowers/specs/2026-10-05-model-center-design.md`）：断言 34、49、69、79、80、81、82。

---

## 1. 为什么需要接线

`apps/host/src/main.cj` 的 `turn/start` 与 `task/start` 目前仍按
`ProviderRegistry.view().defaultProviderId` + `defaultModel` 的**两层指针**解析模型，
把 `baseUrl` 与 `apiKey` 冻结进两个闭包后直接发请求。后果：

- 模型中心（自定义模型 / 供应商 / 绑定 / 费率 / 预算）**只在设置面板存在**，不参与任何一次请求；
- 熔断日志写完了但没人读，路由选择永远是第一条绑定；
- 派发标记、账本预留、结算全部没有调用点，`usage-ledger.log` 只在导出时出现；
- 凭据值以裸变量在闭包里流转，号池换绑要改宿主代码。

断言 49 要求「customModelId 是唯一入口，其余由路由结果派生」；断言 34 要求
「每步（含工具调用后的续跑）重新过一遍调度」。这两条目前都是红的。

## 2. D 本批交付（core 侧，已落库）

`core/src/model_router.cj` 追加 4 个纯决策单元（**不 I/O、不读时钟、不 resolve 凭据**）：

| 符号 | 形态 | 用途 |
|---|---|---|
| `AttemptPlan` | class，16 个 let 字段 | 一次上游尝试的**完整装配快照**：providerId / modelId / baseUrl / credentialRef / protocol / images / currency / priceVersion / 四档费率 / dailyAmountMicro / transport / bindingIndex / attemptId |
| `AttemptPlan.key()` | `String` | 熔断作用域键，`${providerId}/${modelId}`，必须与 `route` 查健康用的键逐字一致 |
| `AttemptPlan.rateCard()` | `RateCard` | 从四档费率快照构造账本费率卡 |
| `AttemptPlan.withAttemptId(next)` | `AttemptPlan` | 分配 attemptId（宿主每次尝试一个新值） |
| `RoutingAttempt` | class | `plan: Option<AttemptPlan>` + `reject: Option<RouteRejection>` |
| `planFor(customId, decision, customs, providers)` | `Option<AttemptPlan>` | 把 `RouteDecision` 展开成装配计划；缺供应商 / 缺上游模型 / 决策与绑定对不上，一律 `None` |
| `classifyFailure(failure, providerId, modelId, credentialRef, transport)` | `FailureRoute` | 按**实际受影响范围**选最窄作用域，返回 `scope` + `category` |
| `credentialViewOf(providers, store)` | `CredentialView` | 只暴露「哪些 credentialRef 已配置」，重复引用去重；store 本身不进调度函数 |

`classifyFailure` 的归因表（`FailureRoute.scope.kind` / `category`）：

| 条件 | scope.kind | scope.key | category |
|---|---|---|---|
| `kind == "cancelled"` | `upstream` | `${provider}/${model}` | `cancelled`（不计入任何计数） |
| `status == 401` 或 `403` | `route-set` | `credentialRef` | `credential`（**不消耗三次机会**，立即暂停） |
| `!reachedUpstream`（连接被拒 / DNS / TLS 握手失败） | `channel` | `transport` | `channel`（请求字节没进线路，不计入模型三次失败） |
| `kind == "protocol"` 或 `"read"` | `upstream` | `${provider}/${model}` | `unknown`（归因不明，不判为模型故障） |
| `status == 429` | `route-set` | `credentialRef` | `effective`（额度按凭证给，换模型躲不掉） |
| `status >= 500` | `upstream` | `${provider}/${model}` | `effective` |
| 其余 4xx | `upstream` | `${provider}/${model}` | `request` |

配套测试：`core/src/model_router_test.cj` 追加 4 个用例，全绿。

### 2.1 顺带修掉的单位错配（预算闸）

改接线时发现并修掉了一个会让预算闸永远判不出耗尽的错配：

- `UsageLedger` 从头到尾**只记金额，不记 token**（`LedgerSnapshot` 里只有
  `usedByCurrency` / `modelTotals` / `providerTotals`，全是微分）。
- `UsageLedger.routerView(currency)` 返回的 `LedgerView.usedByModel` 因此是
  **微分**（`ledger_test.cj` 的 `routerViewExposesLocalUsedPerCustomModelAndCurrency`
  断言 `usedFor("cm-a") == 300000`）。
- 但 `route()` 的预算闸拿这个值比的是 `model.dailyTokens`——**微分对 token 数**。
  要么永远不触发（预算配得再小也判不出），要么偶然撞上误判。

修法（`core/src/model_router.cj`，D 自有）：预算闸改比 `dailyAmountMicro`，
并在 `LedgerView` 的注释里把单位写死。`dailyTokens` / `monthlyTokens` 现在只进
配置面，**没有任何执行点**——账本不喂它们数据，拿它们判闸就是假的。

给 A 的两条提醒：

1. **§3.3 第 ⑤ 步的 `reserve` 才是金额限额的执行点**，路由器那道闸只是预过滤
   （提前给类型码，省一次派发）。两处都会拒，码不同：路由器给 `budget-exhausted`，
   `reserve` 给 `budget-<code>`。
2. **token 预算目前无处落地**。要在桌面端做 token 预算，A 需要把 SSE 回传的
   token 数写进一个新的事件（账本不记 token，见 §3.5 的分档用量说明）。
   这是 §6 之后的第三个可选动词，不阻塞本单。

`routerOnlySeesViewsNotStores` 已改成金额口径并新增一条断言：只设 `dailyTokens`
不设 `dailyAmountMicro` 时，任何已用额都不拦——证明 token 闸确实是配置-only。

## 3. 请 A 接的线（`apps/host/src/main.cj`）

### 3.1 入参

请求体已有 `customModelId`（可选字符串）。存在即走模型中心路径，缺失则保留现有
两层指针兜底（向后兼容）。

### 3.2 装配句柄（在 turn 开始时一次性建立）

```cangjie
let customReg = CustomModelRegistry.forUser()
let provReg = ProviderRegistry.forUser()
let creds = CredentialStore.forUser()
let health = RouteHealth.forUser()
let attempts = AttemptLog.forUser()
let ledger = UsageLedger.forUser()
let logicalRequestId = "turn-${turnEpoch}"   // 一次 turn 一个；崩溃后据此认出遗留尝试
```

`AttemptLog.forUser()` 与 `UsageLedger.forUser()` 落在**同一个文件**
（`usage-ledger.log`），只是事件名不同（`attempt/*` 与 `ledger/*`）——这不是笔误，
是断言 79 要求的「同一份证据」。

### 3.3 每步的调用序列（工具调用后的续跑也要再走一遍）

```cangjie
// ① 视图刷新 + 凭据视图（每步都要重新读：绑定/费率/预算可能在这一步之间被改）
let customs = customReg.view()
let providers = provReg.view()
let credView = credentialViewOf(providers, creds)

// ② 调度（now 由宿主注入，路由器自己绝不读时钟）
let now = DateTime.nowUTC().toUnixTimeStamp().toSeconds()
let out = route(RouteRequest(customModelId, ["text-output"]), customs, providers,
    health.view(), credView, LedgerView([]), cursor, now)

// ③ 展开成装配计划；拿不到必须 fail-loud，不许猜 baseUrl
if (let Some(reject) <- out.rejection) {
    return JsonRpcError(-32010, "route-rejected:${reject.code}")
}
if (let Some(d) <- out.decision) {
    if (let Some(plan0) <- planFor(customModelId, d, customs, providers)) {
        let plan = plan0.withAttemptId("${logicalRequestId}-a${seq}")   // seq 从 1 开始递增

        // ④ 派发前闸门：标记写不下去就**不发**（断言 80）
        if (!attempts.markDispatched(logicalRequestId, plan.attemptId, plan.key())) {
            return JsonRpcError(-32011, "attempt-mark-failed")
        }

        // ⑤ 预算闸：-1 = 未设额度，跳过；否则按「已用 + 在途」判
        if (plan.dailyAmountMicro >= 0) {
            let d2 = ledger.reserve(ReserveIntent(plan.attemptId, 0, plan.currency,
                logicalRequestId: logicalRequestId, usageKind: "chat",
                customModelId: plan.customModelId, providerId: plan.providerId,
                modelId: plan.modelId, epoch: now), plan.dailyAmountMicro)
            if (!d2.accepted) {
                return JsonRpcError(-32012, "budget-${d2.code}")
            }
        }

        // ⑥ 现在才 resolve 凭据值、拼 baseUrl、组装请求体、发请求
        let apiKey = creds.resolve(plan.credentialRef).getOrThrow().value
        let url = plan.baseUrl + "/chat/completions"
        // ... 组装 body（model 用 plan.modelId，不是 defaultModel）
        // ... provider = RealSseProvider(...)

        // ⑦ 成功：恢复正常调度（不清零累计失败数）
        health.recordSuccess(RouteScope(plan.key(), "upstream"), now)
        if (plan.credentialRef.size > 0) {
            health.recordSuccess(RouteScope(plan.credentialRef, "route-set"), now)
        }
        // ... 结算（见 3.4）
    } else {
        return JsonRpcError(-32013, "route-expand-failed")
    }
}
```

### 3.4 失败路径

```cangjie
let fr = classifyFailure(failure, plan.providerId, plan.modelId,
    plan.credentialRef, plan.transport)
attempts.markFailed(plan.attemptId, failure)
health.recordFailure(fr.scope, failure, fr.category, now)
if (plan.dailyAmountMicro >= 0) {
    ledger.voidAttempt(plan.attemptId, "attempt-failed")
}
// 返回给调用方时带上 fr.category 与 fr.scope.kind，
// 界面才能分得出「该换绑定」还是「该换号」还是「线路有问题」
```

### 3.5 结算

```cangjie
let usage = LedgerUsage.absent()              // 缺 usage 时落「待核算」，不冒充零消费
let accounting = AttemptAccounting(plan.attemptId, usage, plan.rateCard(),
    logicalRequestId: logicalRequestId, usageKind: "chat",
    customModelId: plan.customModelId, providerId: plan.providerId,
    modelId: plan.modelId, session: sessionId, turn: turnId,
    resultClass: "done", meterUnit: "token",
    startedEpoch: startNow, endedEpoch: now)
let result = ledger.settle(accounting)        // 幂等：按 attemptId 重复结算交回首次结论
```

**分档用量目前拿不到**：`sse.cj` 在解析点把 `prompt_tokens + completion_tokens`
塌成单个合计数字，往下每一层（`Assembly.usage`、`TurnResult.usage`、`parseCount`、
`turn/usage` 事件）都只容得下一个数。所以结算前只能传 `LedgerUsage.absent()`，
账本会落「待核算」（断言 14、74、75 要求的正是这个行为，不是冒充零消费）。
真正分档需要改 `sse.cj` 的 Chunk 形态，那是另一条变更单，不阻塞本条。

### 3.6 崩溃恢复（启动时一次性）

```cangjie
for (id in attempts.lastDispatchedUnsettled()) {
    // dispatched 未结算 → 进「待核算」，但**绝不重发**（断言 82）
    // 需要 logicalRequestId 才能定位 plan；建议把 logicalRequestId 也写进
    // attempt/dispatched 事件（已经在 event data 里了，读侧解析即可）
    _ = id
}
```

### 3.7 新增错误码（`-320xx` 段，宿主自有）

| code | 触发 | 语义 |
|---|---|---|
| `-32010` | 调度返回带类型拒绝 | `detail` 为 `route-rejected:<code>`；拒绝码取 `route` 现有的：`custom-model-not-found` / `custom-model-disabled` / `budget-exhausted` / `provider-missing` / `provider-disabled` / `upstream-model-missing` / `capability-unsatisfied` / `credential-unconfigured` / `route-cooling` / `no-enabled-binding` |
| `-32011` | `markDispatched` 返回 false | 派发标记写不下去，**请求未发出**；可重试 |
| `-32012` | `reserve` 返回 `accepted == false` | 预算已耗尽；`detail` 为 `budget-<code>` |
| `-32013` | `planFor` 返回 None | 决策与注册表对不上（配置在两次读之间被改了）；必须重路由 |

这些码**必须与现有错误码不撞**——请 A 先 grep 一遍 `-32` 段确认空档。

<<<<<<< HEAD
### 3.8 请求体新增字段

`turn/start` / `task/start` 的请求体里，除了已有的 `customModelId`（可选），
请 A 再暴露一个 `usage` 透传：宿主算完结算后，把 `LedgerUsage` 的四维值与
`SettleOutcome.amountMicros` 写进 turn 结果，桌面端才能把「已使用」列填出来。
现状是 `sse.cj` 只回一个合计 token 数，桌面端拿不到分档值——这是 §3.5 提到的
另一个变更单。

### 3.9 事件订阅（可选，不做也能跑）

`budget-stats.ts` 的 `install()` 会调 `adapter.subscribe?.(invalidate)` 请求失效通知。
如果 A 能顺手把 `usage-ledger.log` 的追加事件转发成一个 `ledger/changed` 通知，
面板就能实时刷新；不做的话面板只会在打开时拉一次。优先级低于 §3.3。

=======
>>>>>>> c4837fd48421377f83b68c04f8515a0853ad031a
## 4. 约束（A 接线时必须守的）

1. **`AttemptLog.markDispatched` 返回 false 时不许发请求**（断言 80 是 fail-closed，
   不是「先发再补记」）。这是本变更单里唯一不可协商的一条。
2. **`route` 与 `classifyFailure` 的 `now` 必须由宿主注入**，core 侧不读时钟
   （断言 48 是 grep 检的：`ledger.cj` 里出现 `MonoTime`/`DateTime`/`now()`/`systemTime`
   会直接红）。`model_router.cj` 同样守这条。
3. **作用域键里不含品牌 / baseUrl**（断言 81）。`AttemptPlan.key()` 已经是
   `${providerId}/${modelId}` 形态，直接用，不要自己拼。
4. **账本纪律**：`amountMicros == -1` 表示未核算，永远不是零；改价不重算历史
   （费率卡是按 attempt 快照的，`plan.rateCard()` 已保证）。
5. **`reserve` 的 `reservedMicros` 传 0 是如实的**：请求前不知道用量，不猜上界；
   账本仍按已结算金额判限额，事后由 `settle` 补账。
6. **公共文件只有 A 能改**：D 不碰 `apps/host/src/main.cj`。本单由 D 提，A 接单实现。

## 5. 验收方式

A 接线后，D 侧用以下三条断言验：

1. **断言 69（拆码）**：同一 turn 连续触发 5xx、401、429、连接被拒、protocol 五类失败，
   `route-health.log` 里出现的 `scope.kind` 必须是 `upstream`、`route-set`、`route-set`、
   `channel`、`upstream`（unknown 归类），且三次 5xx 后同模型键 `cooling == true`。
2. **断言 80（fail-closed）**：把 `usage-ledger.log` 做成不可写（或换实例），
   `markDispatched` 返回 false 时**请求字节一个都不许进线路**——用 sse spike 的
   readCount 判据验证。
3. **断言 82（崩溃不重发）**：写完 `attempt/dispatched` 后杀宿主，重启读
   `lastDispatchedUnsettled()` 必须能看到那笔；同时上游调用计数不得 +1。

<<<<<<< HEAD
## 6. 附：请求 A 接的第二个动词（费用统计面板已经等它）

`apps/desktop/renderer/pages/model-center-adapter.ts` 的 `budget-stats.describe()`
已经写好，但 `costs.model` / `costs.probe` / `costs.relay` 三列全部是硬编码的
`amountMicro: null` + `note: '后端尚未提供…流水'`。请 A 在宿主 capabilities 里
加一个只读动词，把 `UsageLedger` 已有的统计投影出去：

```cangjie
// 宿主 capabilities 追加：ledger/stats
// 入参：无
// 出参（JSON）：
{
  "providerTotals": [{"key":"step","customModelId":"code","currency":"CNY","usedMicros":12345}],
  "usageKindTotals": [{"key":"chat","customModelId":"","currency":"CNY","usedMicros":12345}],
  "unsettledAttempts": ["turn-1-a1"],
  "pendingReservations": ["turn-1-a2"],
  "revision": 1
}
```

core 侧取数已经齐了，A 只需要转发：

| 字段 | core 方法 |
|---|---|
| `providerTotals` | `UsageLedger.providerTotals()` → `Array<UsageTotal>`（`key`/`customModelId`/`currency`/`usedMicros`） |
| `usageKindTotals` | `UsageLedger.usageKindTotals()` → 同上类型 |
| `unsettledAttempts` | `UsageLedger.unsettledAttempts()` → `Array<String>` |
| `pendingReservations` | `UsageLedger.pendingReservations()` → `Array<String>` |
| `revision` | `UsageLedger.state().revision` |

三个成本列的填法（D 侧接住后自己填）：

- `costs.model.amountMicro` = `providerTotals` 里 `usageKind == "chat"` 的合计
  （按 currency 分组，别跨币种相加）
- `costs.probe.amountMicro` = 需要 `usageKind == "probe"`；目前 probe 还没实现
  （B2 只做了调度核心，probe 执行器未建），这一列继续留 `null`
- `costs.relay.amountMicro` = 需要中转通道（B4），目前留 `null`

D 侧已经备好的落点：`model-center-adapter.ts` 的 `budget-stats.describe()`
会把 `usage` 结果拼进 `StatsView`，`budget-stats.ts` 的 `formatAmount()`
与 `costCard()` 已经把 `null` 渲染成 `—` 而不是 `0`——**不许把缺数据渲染成零**
（断言 14）。

## 7. 不在本单范围

- `sse.cj` 分档用量透传（独立变更单）
- 探测执行器（`probeEnabled` / `probeMaxPerDay` 已进配置面，执行器未建）
- 中转通道（B4：`TransportChannel` direct/relay）
- 迁移包（B5）
=======
## 6. 不在本单范围

- `sse.cj` 分档用量透传（独立变更单）
- 中转通道（B4：`TransportChannel` direct/relay）
- 迁移包（B5）
- 前端 `model-center-adapter.ts` / `budget-stats.ts` 的费用统计面板（D 自有，不等 A）
>>>>>>> c4837fd48421377f83b68c04f8515a0853ad031a
