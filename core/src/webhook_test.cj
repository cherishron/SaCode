package core
import std.fs.*
import std.unittest.*

// Webhook 上游契约（70 行）：`WebhookRuleId/WebhookSourceId/WebhookDeliveryId`
// 是 opaque strings；`dispatch()` 快照当前匹配 rules、独立调度每条、在任何
// callback settle 前返回；throw 与 rejection 逐 rule contained；**没有**队列、
// 重试、去重、执行状态、崩溃回放、完成回执。本切片按 ruleId→kind 索引实现。

@Test
func webhookDispatchMatchesByKindAndCountsRules() {
    let rt = WebhookRuntime()
    rt.register("rule-A", "github")
    rt.register("rule-B", "github")
    rt.register("rule-C", "gitlab")
    let matched = rt.dispatch("delivery-1", "github")
    @Expect(matched, Int64(2))
}

@Test
func webhookDuplicateRuleIdRejectedWithoutReplacing() {
    let rt = WebhookRuntime()
    rt.register("rule-A", "github")
    var threw = false
    try {
        rt.register("rule-A", "gitlab")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    // 首次的 kind 保留——第二次注册不许顶替；github 仍然命中。
    @Expect(rt.dispatch("d-1", "github"), Int64(1))
    @Expect(rt.dispatch("d-2", "gitlab"), Int64(0))
}

@Test
func webhookDispatchUnknownKindReturnsZero() {
    let rt = WebhookRuntime()
    rt.register("rule-A", "github")
    // 无匹配也不抛——fire-and-forget 语义；0 条规则即返回。
    @Expect(rt.dispatch("d-1", "unrecognized"), Int64(0))
}

@Test
func webhookUnregisterRemovesRuleAndUnknownIdThrows() {
    let rt = WebhookRuntime()
    rt.register("rule-A", "github")
    rt.unregister("rule-A")
    @Expect(rt.dispatch("d-1", "github"), Int64(0))
    var threw = false
    try {
        rt.unregister("rule-A")
    } catch (e: Exception) {
        threw = true
    }
    // 重复注销与未知 id 同族：都抛。
    @Expect(threw, true)
}
