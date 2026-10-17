package core
import std.unittest.*
import std.sync.*

func pageChannelWait(channel: PageToolChannel): PageToolRequest {
    for (_ in 0..200) {
        let queue = channel.queued()
        if (queue.size > 0) { return queue[0] }
        sleep(5 * Duration.millisecond)
    }
    throw Exception("fixture-page-not-queued")
}

@Test
func pageToolsChannelClaimsOnceAndRejectsForeignLateReplies() {
    let channel = PageToolChannel("s1")
    let executor = PageToolExecutor(channel, "s1")
    let token = TurnToken()
    let pending = spawn { => executor.execute("page.readState", "{}", token) }
    let request = pageChannelWait(channel)
    @Expect(channel.deliver("s1", request.requestId, "{}"), false)
    @Expect(channel.claim(request.requestId), true)
    @Expect(channel.claim(request.requestId), false)
    @Expect(channel.deliver("other", request.requestId, "{}"), false)
    @Expect(channel.deliver("s1", "not-owned", "{}"), false)
    @Expect(channel.deliver("s1", request.requestId, ##"{"text":"received"}"##), true)
    @Expect(pending.get(2 * Duration.second).allowed, true)
    @Expect(channel.deliver("s1", request.requestId, "{}"), false)
    @Expect(channel.queued().size, 0)
}

@Test
func pageToolsChannelCancellationBeforeClaimPreventsDispatch() {
    let channel = PageToolChannel("s1")
    let executor = PageToolExecutor(channel, "s1")
    let token = TurnToken()
    let pending = spawn { => executor.execute("page.readState", "{}", token) }
    let request = pageChannelWait(channel)
    channel.cancel()
    @Expect(channel.claim(request.requestId), false)
    @Expect(pending.get(2 * Duration.second).allowed, false)
    @Expect(channel.queued().size, 0)
}
