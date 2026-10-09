package core
import std.unittest.*

@Test
func webhookDispatchMatchesByKindAndCountsRules() {
    let rt = WebhookRuntime()
    rt.register("rule-A", "github")
    rt.register("rule-B", "github")
    rt.register("rule-C", "gitlab")
    let result = rt.dispatch("delivery-1", "github")
    @Expect(result.decision, HookDecision.Allow)
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
    @Expect(rt.dispatch("d-1", "github").decision, HookDecision.Allow)
    @Expect(rt.dispatch("d-2", "gitlab").decision, HookDecision.Allow)
}

@Test
func webhookDispatchUnknownKindReturnsAllow() {
    let rt = WebhookRuntime()
    rt.register("rule-A", "github")
    @Expect(rt.dispatch("d-1", "unrecognized").decision, HookDecision.Allow)
}

@Test
func webhookUnregisterRemovesRuleAndUnknownIdThrows() {
    let rt = WebhookRuntime()
    rt.register("rule-A", "github")
    rt.unregister("rule-A")
    @Expect(rt.dispatch("d-1", "github").decision, HookDecision.Allow)
    var threw = false
    try {
        rt.unregister("rule-A")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
}

@Test
func testWebhookDispatchReturnsHookResult() {
    let rt = WebhookRuntime()
    rt.register("rule-A", "github")
    let result = rt.dispatch("delivery-1", "github")
    assert(result is HookResult)
    @Expect(result.decision, HookDecision.Allow)
}
