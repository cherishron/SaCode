package core
import std.unittest.*

@Test
func deferredProviderDoesNotConstructBeforeConsumptionAndClosesResource() {
    let calls = RoundCounter()
    let inner = AgentChunks([Chunk("text", "真实字节", ""), Chunk("finish", "", "stop")])
    let token = TurnToken()
    let provider = DeferredProvider({ => calls.bump(); inner }, token)
    @Expect(calls.n, Int64(0))
    @Expect(provider.next().getOrThrow().text, "真实字节")
    @Expect(provider.next().getOrThrow().kind, "finish")
    @Expect(calls.n, Int64(1))
    provider.close(); provider.close()
    @Expect(inner.closes, Int64(1))
}

@Test
func deferredProviderCancelledBeforeConsumptionDoesNotConnect() {
    let calls = RoundCounter()
    let token = TurnToken()
    let provider = DeferredProvider({ => calls.bump(); AgentChunks([]) }, token)
    token.cancel()
    @Expect(provider.next().isNone(), true)
    @Expect(calls.n, Int64(0))
    @Expect(provider.isClosed(), true)
}

@Test
func deferredProviderInitFailureSettlesThroughModelLoop() {
    let token = TurnToken()
    let provider = DeferredProvider({ => throw Exception("fixture-init-failed") }, token)
    let log = SessionLog("deferred-provider-unused.log")
    let result = ModelAgentLoop().run(provider, { _ => AgentChunks([]) }, "fixture", token, log, DeliveryQueue(8), false)
    @Expect(result.interrupted, true)
    @Expect(result.finishReason, "error:fixture-init-failed")
    @Expect(provider.isClosed(), true)
    @Expect(log.snapshotEvents()[0].eventType, "turn/start")
    @Expect(log.snapshotEvents()[1].eventType, "turn/end")
}
