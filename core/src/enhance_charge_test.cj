package core
import std.unittest.*
import std.fs.*

@Test
func enhanceRejectedResultRetainsKnownUsage() {
    let token = TurnToken()
    let lines = [
        "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"半截\"}}]}\n\n",
        "data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"length\"}],\"usage\":{\"total_tokens\":9}}\n\n",
        "data: [DONE]\n\n"
    ]
    let h = EnhanceRunner().start({ => sseProvider(lines, token) }, token)
    let outcome = h.result()
    @Expect(outcome.ok, false)
    @Expect(outcome.error, "enhance-max-tokens")
    @Expect(outcome.usage, "9")
}

@Test
func enhanceChargePersistsWithoutFrontendPollAndOnlyOnce() {
    let path = "enhance-charge-no-poll.log"
    removeIfExists(path, recursive: false)
    removeIfExists("${path}.lease", recursive: false)
    let log = SessionLog(path)
    let meter = TokenMeter(log)
    let token = TurnToken()
    let lines = [
        "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"增强\"}}]}\n\n",
        "data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"total_tokens\":17}}\n\n",
        "data: [DONE]\n\n"
    ]
    let h = EnhanceRunner().start({ => sseProvider(lines, token) }, token)
    let charge = EnhanceCharge(h, log, meter, WriteLease(path))
    h.result()
    @Expect(charge.settle(), true)
    @Expect(charge.settle(), true)
    @Expect(meter.used(), Int64(17))
    let replay = SessionLog(path)
    @Expect(replay.load(), true)
    let restored = TokenMeter(replay)
    @Expect(restored.rebuild(), Int64(17))
    removeIfExists(path, recursive: false)
}
