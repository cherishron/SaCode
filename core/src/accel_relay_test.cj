package core

import std.collection.*
import std.unittest.*

// 加速转发核心（B4）的验收用例。
//
// 测试范围：
//   * slug 与 relayBase 的校验（https-only、禁 @ ? #、稳定 ID 规则）
//   * 三种发送形态的 URL 拼装
//   * 拒绝路径（slug 不在允许集、relayBase 非 https、transport 未知）
//   * 重放闸（dispatched 阻断、未 dispatched 允许、幂等凭据例外）
//   * 发送闸（fail-closed：标记写不下去就不发）
//   * direct 与 relay 的传输计划分叉
//
// 期望值纪律：URL 形态按设计文档 §6 的原文 `{relayBase}/upstream/{relaySlug}/{protocolPath}`
// 推导，不做「跑一遍自己的实现再抄回来」。拒绝码按模块顶部的闭集常量钉住。

@Test
func validateRelayBaseAcceptsHttpsAndLoopbackOnly() {
    // https 域名
    @Expect(validateRelayBase("https://relay.example.com"), true)
    @Expect(validateRelayBase("https://relay.example.com/path"), true)
    // 本机回环 http（联调用本地 mock）
    @Expect(validateRelayBase("http://127.0.0.1:8080"), true)
    @Expect(validateRelayBase("http://localhost:8080"), true)
    // 非 https 域名
    @Expect(validateRelayBase("http://relay.example.com"), false)
    @Expect(validateRelayBase("ftp://relay.example.com"), false)
    // 带凭据
    @Expect(validateRelayBase("https://user:pass@relay.example.com"), false)
    // 带查询
    @Expect(validateRelayBase("https://relay.example.com?x=1"), false)
    // 带片段
    @Expect(validateRelayBase("https://relay.example.com#frag"), false)
    // 空串
    @Expect(validateRelayBase(""), false)
    // 超长
    var long = "https://"
    var i: Int64 = 0
    while (i < 2100) {
        long += "a"
        i += 1
    }
    @Expect(validateRelayBase(long), false)
}

@Test
func validateRelaySlugFollowsStableIdRule() {
    // 合法：小写字母开头 + [a-z0-9-]
    @Expect(validateRelaySlug("deepseek"), true)
    @Expect(validateRelaySlug("a"), true)
    @Expect(validateRelaySlug("a-b-c"), true)
    @Expect(validateRelaySlug("deepseek-2"), true)
    // 非法：大写字母开头
    @Expect(validateRelaySlug("DeepSeek"), false)
    @Expect(validateRelaySlug("A"), false)
    // 非法：数字开头
    @Expect(validateRelaySlug("1deepseek"), false)
    @Expect(validateRelaySlug("-deepseek"), false)
    // 非法：含非法字符
    @Expect(validateRelaySlug("deepseek_v2"), false)
    @Expect(validateRelaySlug("deepseek.v2"), false)
    @Expect(validateRelaySlug("deepseek/v2"), false)
    @Expect(validateRelaySlug("deepseek v2"), false)
    // 非法：空串
    @Expect(validateRelaySlug(""), false)
    // 非法：超长
    var long = "a"
    var i: Int64 = 0
    while (i < 64) {
        long += "a"
        i += 1
    }
    @Expect(validateRelaySlug(long), false)
}

@Test
func slugAllowedIsClosedSet() {
    let allowed = ["deepseek", "openai", "stepfun"]
    @Expect(slugAllowed("deepseek", allowed), true)
    @Expect(slugAllowed("openai", allowed), true)
    @Expect(slugAllowed("stepfun", allowed), true)
    @Expect(slugAllowed("unknown", allowed), false)
    @Expect(slugAllowed("", allowed), false)
    @Expect(slugAllowed("DeepSeek", allowed), false)
    // 空允许集
    @Expect(slugAllowed("deepseek", []), false)
}

@Test
func buildRelayUrlUsesUpstreamPath() {
    // chat 模式
    @Expect(buildRelayUrl("https://relay.example.com", "deepseek", CHAT_MODE),
        "https://relay.example.com/upstream/deepseek/chat/completions")
    // discover 模式
    @Expect(buildRelayUrl("https://relay.example.com", "deepseek", DISCOVER_MODE),
        "https://relay.example.com/upstream/deepseek/models")
    // probe health 模式
    @Expect(buildRelayUrl("https://relay.example.com", "deepseek", PROBE_HEALTH_MODE),
        "https://relay.example.com/upstream/deepseek/health")
    // probe minimal 模式
    @Expect(buildRelayUrl("https://relay.example.com", "deepseek", PROBE_MINIMAL_MODE),
        "https://relay.example.com/upstream/deepseek/chat/completions")
    // relayBase 带尾部斜杠
    @Expect(buildRelayUrl("https://relay.example.com/", "deepseek", CHAT_MODE),
        "https://relay.example.com/upstream/deepseek/chat/completions")
    // relayBase 带多个尾部斜杠
    @Expect(buildRelayUrl("https://relay.example.com///", "deepseek", CHAT_MODE),
        "https://relay.example.com/upstream/deepseek/chat/completions")
}

@Test
func planRelayRejectsSlugNotInAllowSet() {
    let allowed = ["deepseek"]
    let plan = planRelay("https://relay.example.com", "unknown", allowed, CHAT_MODE)
    @Expect(plan.ok, false)
    @Expect(plan.url.size, Int64(0))
    if (let Some(rej) <- plan.rejection) {
        @Expect(rej.code, RELAY_TARGET_REJECTED)
    } else {
        @Expect("should-have-rejection", "no-rejection")
    }
}

@Test
func planRelayRejectsInvalidBase() {
    let plan = planRelay("http://insecure.example.com", "deepseek", ["deepseek"], CHAT_MODE)
    @Expect(plan.ok, false)
    if (let Some(rej) <- plan.rejection) {
        @Expect(rej.code, RELAY_BASE_INVALID)
    }
}

@Test
func planRelayRejectsInvalidSlug() {
    let plan = planRelay("https://relay.example.com", "BadSlug", ["BadSlug"], CHAT_MODE)
    @Expect(plan.ok, false)
    if (let Some(rej) <- plan.rejection) {
        @Expect(rej.code, RELAY_SLUG_INVALID)
    }
}

@Test
func planRelaySucceedsForValidInput() {
    let plan = planRelay("https://relay.example.com", "deepseek", ["deepseek"], CHAT_MODE)
    @Expect(plan.ok, true)
    @Expect(plan.url, "https://relay.example.com/upstream/deepseek/chat/completions")
    @Expect(plan.slug, "deepseek")
    @Expect(plan.mode.kind, "chat")
}

@Test
func planTransportDirectReturnsProviderBaseUrl() {
    let plan = planTransport("https://api.example.com/v1", "https://relay.example.com",
        "deepseek", ["deepseek"], "direct", CHAT_MODE)
    @Expect(plan.kind, "direct")
    @Expect(plan.url, "https://api.example.com/v1")
    @Expect(plan.slug.size, Int64(0))
    @Expect(plan.rejection.isNone(), true)
}

@Test
func planTransportRelayRewritesToRelayUrl() {
    let plan = planTransport("https://api.example.com/v1", "https://relay.example.com",
        "deepseek", ["deepseek"], "relay", CHAT_MODE)
    @Expect(plan.kind, "relay")
    @Expect(plan.url, "https://relay.example.com/upstream/deepseek/chat/completions")
    @Expect(plan.slug, "deepseek")
    @Expect(plan.rejection.isNone(), true)
}

@Test
func planTransportRelayRejectsSlugNotInAllowSet() {
    let plan = planTransport("https://api.example.com/v1", "https://relay.example.com",
        "unknown", ["deepseek"], "relay", CHAT_MODE)
    @Expect(plan.kind, "relay")
    @Expect(plan.url.size, Int64(0))
    if (let Some(rej) <- plan.rejection) {
        @Expect(rej.code, RELAY_TARGET_REJECTED)
    }
}

@Test
func planTransportRejectsUnknownTransport() {
    let plan = planTransport("https://api.example.com/v1", "https://relay.example.com",
        "deepseek", ["deepseek"], "unknown-transport", CHAT_MODE)
    @Expect(plan.kind, "unknown")
    @Expect(plan.url.size, Int64(0))
    if (let Some(rej) <- plan.rejection) {
        @Expect(rej.code, RELAY_TRANSPORT_UNKNOWN)
    }
}

@Test
func planTransportDirectIgnoresSlug() {
    // direct 模式不需要 slug，空 slug 也可
    let plan = planTransport("https://api.example.com/v1", "https://relay.example.com",
        "", [], "direct", CHAT_MODE)
    @Expect(plan.kind, "direct")
    @Expect(plan.url, "https://api.example.com/v1")
    @Expect(plan.rejection.isNone(), true)
}

@Test
func planTransportDirectWorksForAllModes() {
    // direct 模式对三种用途都返回 providerBaseUrl
    let chatPlan = planTransport("https://api.example.com/v1", "", "", [], "direct", CHAT_MODE)
    @Expect(chatPlan.url, "https://api.example.com/v1")

    let discoverPlan = planTransport("https://api.example.com/v1", "", "", [], "direct", DISCOVER_MODE)
    @Expect(discoverPlan.url, "https://api.example.com/v1")

    let probePlan = planTransport("https://api.example.com/v1", "", "", [], "direct", PROBE_HEALTH_MODE)
    @Expect(probePlan.url, "https://api.example.com/v1")
}

@Test
func decideReplayBlocksWhenDispatched() {
    // 已 dispatched 且无幂等凭据 → 不允许重发
    let decision = decideReplay(true, false)
    @Expect(decision.allowed, false)
    @Expect(decision.reason, "already-dispatched")
}

@Test
func decideReplayAllowsWhenNotDispatched() {
    // 未 dispatched → 允许重发（请求可能未发送）
    let decision = decideReplay(false, false)
    @Expect(decision.allowed, true)
    @Expect(decision.reason, "not-dispatched")
}

@Test
func decideReplayAllowsWhenIdempotent() {
    // 已 dispatched 但有幂等凭据 → 允许重发
    let decision = decideReplay(true, true)
    @Expect(decision.allowed, true)
    @Expect(decision.reason, "idempotent-allowed")
}

@Test
func decideReplayNotDispatchedAllowsEvenWithoutIdempotent() {
    // 未 dispatched 时幂等凭据不影响判定
    let decision = decideReplay(false, true)
    @Expect(decision.allowed, true)
    @Expect(decision.reason, "not-dispatched")
}

@Test
func dispatchGateOkWhenBothSucceed() {
    let result = dispatchGateOk(true, true)
    @Expect(result.canSend, true)
    @Expect(result.code, "ok")
}

@Test
func dispatchGateFailsClosedWhenLeaseUnavailable() {
    let result = dispatchGateOk(false, true)
    @Expect(result.canSend, false)
    @Expect(result.code, DISPATCH_MARK_FAILED)
}

@Test
func dispatchGateFailsClosedWhenLogUnwritable() {
    let result = dispatchGateOk(true, false)
    @Expect(result.canSend, false)
    @Expect(result.code, DISPATCH_MARK_FAILED)
}

@Test
func dispatchGateFailsClosedWhenBothFail() {
    let result = dispatchGateOk(false, false)
    @Expect(result.canSend, false)
    @Expect(result.code, DISPATCH_MARK_FAILED)
}

@Test
func relayRejectionMessageReturnsCode() {
    let rej = RelayRejection(RELAY_TARGET_REJECTED, "slug 不在允许集内")
    @Expect(rej.message(), RELAY_TARGET_REJECTED)
    @Expect(rej.code, RELAY_TARGET_REJECTED)
    @Expect(rej.detail, "slug 不在允许集内")
}
