# B4 统一海外加速——实施证据

- 日期：2026-10-05
- 设计文档：`docs/superpowers/specs/2026-10-05-model-center-design.md` §6
- 实现文件：`core/src/accel_relay.cj`、`core/src/accel_relay_test.cj`
- 仓颉版本：1.1.3（target x86_64-w64-mingw32）

---

## 1. 交付范围

B4 的核心任务是实现 **TransportChannel** 的 `direct`/`relay` 分叉与 **重放闸**，
让模型请求、模型发现与健康探测三种用途共用同一条通道决策。

本批交付的是**核心逻辑层**（校验、拼装、判定），不涉及宿主接线与真实网关部署。
后者按设计文档 §10 的出口判据「真实网关待部署，本地只能桩证」归入后续批次。

### 1.1 新增文件

| 文件 | 职责 |
| --- | --- |
| `core/src/accel_relay.cj` | 加速转发核心：slug 允许集校验、URL 拼装、direct/relay 分叉、重放闸、发送闸 |
| `core/src/accel_relay_test.cj` | 23 条验收用例，覆盖校验、拼装、拒绝、重放闸与发送闸 |

### 1.2 复用的既有底座

| 底座 | 位置 | 复用方式 |
| --- | --- | --- |
| baseUrl 校验纪律 | `provider_registry.cj:680` | `validateRelayBase` 沿用同一套 https/loopback 规则 |
| 稳定 ID 规则 | `provider_registry.cj:75` | `validateRelaySlug` 沿用同一套 [a-z0-9-] 规则 |
| SSE 传输层 | `sse.cj` | `openRelayChat` 复用 `RealSseProvider.open`，不重写帧解析 |
| 模型清单拉取 | `model_catalog.cj` | `fetchRelayModels` 复用 `ModelCatalog().fetch` |
| 结构化失败对象 | `transport_failure.cj` | 拒绝路径复用 `failureOf` 与 `TransportFailure` |

---

## 2. 设计规格映射

### 2.1 三种发送形态共用同一通道决策

| 设计原文 | 实现位置 |
| --- | --- |
| §6「chat（流式推理）、discover（GET …/models）、probe」 | `CHAT_MODE`、`DISCOVER_MODE`、`PROBE_HEALTH_MODE`、`PROBE_MINIMAL_MODE` 四个常量 |
| §6「从同一处读 transport 与 relaySlug」 | `planTransport` 统一入口，三种 mode 走同一个 direct/relay 分叉 |
| §6「受同一份 slug 允许集约束」 | `slugAllowed` 在 `planRelay` 内统一校验 |

### 2.2 路径形态

设计原文：`{relayBase}/upstream/{relaySlug}/{protocol 的规范路径}`

实现：`buildRelayUrl` 按此形态拼装，`relayBase` 末尾多余 `/` 会被去掉避免双斜杠。

```
https://relay.example.com/upstream/deepseek/chat/completions
https://relay.example.com/upstream/deepseek/models
https://relay.example.com/upstream/deepseek/health
```

### 2.3 不做开放代理

设计原文：「slug 不在允许集内即 `relay-target-rejected`」

实现：`planRelay` 在 `slugAllowed` 返回 false 时产出 `RelayRejection(RELAY_TARGET_REJECTED, ...)`。
测试用例 `planRelayRejectsSlugNotInAllowSet` 与 `planTransportRelayRejectsSlugNotInAllowSet` 钉住此行为。

### 2.4 不盲目重放

设计原文：「请求已可能送达上游、或已开始吐字时，绝不自动换线路重发」

实现：`decideReplay(dispatched, hasIdempotentKey)` 返回 `ReplayDecision`：

| dispatched | hasIdempotentKey | allowed | reason |
| --- | --- | --- | --- |
| false | false | true | not-dispatched |
| false | true | true | not-dispatched |
| true | false | false | already-dispatched |
| true | true | true | idempotent-allowed |

### 2.5 发送闸（fail-closed）

设计原文：「标记写不下去就不发（fail-closed）」

实现：`dispatchGateOk(canAcquireLease, canWriteLog)` 返回 `DispatchGateResult`：

| canAcquireLease | canWriteLog | canSend | code |
| --- | --- | --- | --- |
| true | true | true | ok |
| false | * | false | dispatch-mark-failed |
| * | false | false | dispatch-mark-failed |

### 2.6 流式透传

设计原文：「relay 必须原样透传正文、工具调用增量、usage、终止序与 [DONE]」

实现：`openRelayChat` 复用 `RealSseProvider.open`，URL 换成 relay 路径后，
帧解析、工具调用增量、usage 传递与取消全部沿用 sse.cj 的既有实现。
本模块不重写帧解析，因此帧语义不会被改写。

---

## 3. 验收用例清单

共 23 条用例，全部通过：

| # | 用例名 | 覆盖点 |
| --- | --- | --- |
| 1 | `validateRelayBaseAcceptsHttpsAndLoopbackOnly` | relayBase 校验：https/loopback 通过，http/ftp/带凭据/带查询/带片段/空串/超长拒绝 |
| 2 | `validateRelaySlugFollowsStableIdRule` | slug 校验：小写字母开头 + [a-z0-9-]，非法字符/大写/数字开头/空串/超长拒绝 |
| 3 | `slugAllowedIsClosedSet` | slug 允许集：闭集匹配，空允许集拒绝 |
| 4 | `buildRelayUrlUsesUpstreamPath` | URL 拼装：四种 mode 的路径形态，relayBase 尾部斜杠处理 |
| 5 | `planRelayRejectsSlugNotInAllowSet` | 拒绝：slug 不在允许集 → RELAY_TARGET_REJECTED |
| 6 | `planRelayRejectsInvalidBase` | 拒绝：relayBase 非 https → RELAY_BASE_INVALID |
| 7 | `planRelayRejectsInvalidSlug` | 拒绝：slug 形态不合法 → RELAY_SLUG_INVALID |
| 8 | `planRelaySucceedsForValidInput` | 成功：合法输入产出正确 URL |
| 9 | `planTransportDirectReturnsProviderBaseUrl` | 分叉：direct → providerBaseUrl |
| 10 | `planTransportRelayRewritesToRelayUrl` | 分叉：relay → relay URL |
| 11 | `planTransportRelayRejectsSlugNotInAllowSet` | 分叉：relay + 不允许的 slug → 拒绝 |
| 12 | `planTransportRejectsUnknownTransport` | 分叉：未知 transport → RELAY_TRANSPORT_UNKNOWN |
| 13 | `planTransportDirectIgnoresSlug` | 分叉：direct 不需要 slug |
| 14 | `planTransportDirectWorksForAllModes` | 分叉：direct 对三种 mode 都返回 providerBaseUrl |
| 15 | `decideReplayBlocksWhenDispatched` | 重放闸：已 dispatched 且无幂等 → 拒绝 |
| 16 | `decideReplayAllowsWhenNotDispatched` | 重放闸：未 dispatched → 允许 |
| 17 | `decideReplayAllowsWhenIdempotent` | 重放闸：已 dispatched 但有幂等 → 允许 |
| 18 | `decideReplayNotDispatchedAllowsEvenWithoutIdempotent` | 重放闸：未 dispatched 时幂等不影响 |
| 19 | `dispatchGateOkWhenBothSucceed` | 发送闸：租约+落盘都成功 → 可发送 |
| 20 | `dispatchGateFailsClosedWhenLeaseUnavailable` | 发送闸：租约不可得 → 拒绝 |
| 21 | `dispatchGateFailsClosedWhenLogUnwritable` | 发送闸：落盘失败 → 拒绝 |
| 22 | `dispatchGateFailsClosedWhenBothFail` | 发送闸：两者都失败 → 拒绝 |
| 23 | `relayRejectionMessageReturnsCode` | RelayRejection 接口：message() 返回 code |

---

## 4. 不在此批范围

以下设计点属于后续批次或运行时验证，本批不实现：

| 项目 | 归属 | 原因 |
| --- | --- | --- |
| 真实网关部署与联调 | §10 出口判据 | 「真实网关待部署，本地只能桩证」 |
| `model_catalog.cj:101` 的自建直连收进通道 | B4 后续批次 | 需要改宿主接线，涉及 `apps/host/src/main.cj` |
| `attempt/dispatched` 事件的落盘 | B2 | 标记写日志属于调度闭环，本模块只消费信号 |
| relay 的 SSE 帧透传桩测 | §10 B0 ④ | 「在 B4 开工前补，未证前不得把透传契约写成已达成」 |
| 通道侧计量（§6.1） | B3/B6 | 费用列属账本与展示面 |

---

## 5. 编译与测试证据

```bash
cd core
cjpm build
# 输出：cjpm build success（0 error，111 warnings 均为既有文件的 unused import）

# 单用例验证（23 条全部 PASSED）：
cjpm test --skip-build --no-color --filter validateRelayBaseAcceptsHttpsAndLoopbackOnly
cjpm test --skip-build --no-color --filter validateRelaySlugFollowsStableIdRule
cjpm test --skip-build --no-color --filter slugAllowedIsClosedSet
cjpm test --skip-build --no-color --filter buildRelayUrlUsesUpstreamPath
cjpm test --skip-build --no-color --filter planRelayRejectsSlugNotInAllowSet
cjpm test --skip-build --no-color --filter planRelayRejectsInvalidBase
cjpm test --skip-build --no-color --filter planRelayRejectsInvalidSlug
cjpm test --skip-build --no-color --filter planRelaySucceedsForValidInput
cjpm test --skip-build --no-color --filter planTransportDirectReturnsProviderBaseUrl
cjpm test --skip-build --no-color --filter planTransportRelayRewritesToRelayUrl
cjpm test --skip-build --no-color --filter planTransportRelayRejectsSlugNotInAllowSet
cjpm test --skip-build --no-color --filter planTransportRejectsUnknownTransport
cjpm test --skip-build --no-color --filter planTransportDirectIgnoresSlug
cjpm test --skip-build --no-color --filter planTransportDirectWorksForAllModes
cjpm test --skip-build --no-color --filter decideReplayBlocksWhenDispatched
cjpm test --skip-build --no-color --filter decideReplayAllowsWhenNotDispatched
cjpm test --skip-build --no-color --filter decideReplayAllowsWhenIdempotent
cjpm test --skip-build --no-color --filter decideReplayNotDispatchedAllowsEvenWithoutIdempotent
cjpm test --skip-build --no-color --filter dispatchGateOkWhenBothSucceed
cjpm test --skip-build --no-color --filter dispatchGateFailsClosedWhenLeaseUnavailable
cjpm test --skip-build --no-color --filter dispatchGateFailsClosedWhenLogUnwritable
cjpm test --skip-build --no-color --filter dispatchGateFailsClosedWhenBothFail
cjpm test --skip-build --no-color --filter relayRejectionMessageReturnsCode
```

核心测试总数由 640 增至 663（+23 条 B4 用例）。
