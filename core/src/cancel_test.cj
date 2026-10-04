package core

import std.unittest.*
import std.collection.ArrayList
import std.fs.*
import std.io.*

class OwnedFrameProvider <: Provider & Resource {
    let token: TurnToken
    let throws: Bool
    var closes: Int64 = 0
    init(token: TurnToken, throws: Bool) { this.token = token; this.throws = throws }
    public func next(): Option<Chunk> {
        if (throws) { throw IllegalStateException("failed") }
        token.cancel()
        return None
    }
    public func close() { closes += 1 }
    public func isClosed(): Bool { closes > 0 }
}

@Test
func turnClosesOwnedProviderOnCancelAndFailure() {
    for (throws in [false, true]) {
        let log = SessionLog("core-test-cancel-owned.log")
        let token = TurnToken()
        let p = OwnedFrameProvider(token, throws)
        try { TurnLoop().run(p, token, log, DeliveryQueue(1)) }
        catch (_: IllegalStateException) {}
        @Expect(p.closes, Int64(1))
        cleanCancel("owned")
    }
}

// C7 取消与背压：先写下期望语义，再让实现跟上。
// 关键不变量：取消是协作式的；已独立发布的后台任务不被连带杀死；
// 慢消费者只能造成「背压信号」，绝不能让已持久化的事件静默丢失。

func chunks5(): ArrayList<Chunk> {
    let c = ArrayList<Chunk>()
    c.add(Chunk("text", "a", ""))
    c.add(Chunk("text", "b", ""))
    c.add(Chunk("tool-call-delta", "read", ""))
    c.add(Chunk("usage", "17", ""))
    c.add(Chunk("finish", "", "stop"))
    return c
}

// 逐步产出的 provider：到第 at 个 chunk 时触发取消，模拟流式过程中用户按下 stop
class ScriptedProvider <: Provider {
    let chunks: ArrayList<Chunk>
    let token: TurnToken
    let at: Int64
    var i: Int64 = 0

    public init(chs: ArrayList<Chunk>, tk: TurnToken, at: Int64) {
        this.chunks = chs
        this.token = tk
        this.at = at
    }

    public func next(): Option<Chunk> {
        if (i == at) {
            // 取消发生在「这一帧还没发出来」的时刻：用户按下 stop 后不应再收到新帧
            token.cancel()
            return None
        }
        if (i >= chunks.size) {
            return None
        }
        let c = chunks[i]
        i += 1
        return Some(c)
    }
}

@Test
func cancelBeforeFirstChunkPersistsOnlyTurnStart() {
    let log = SessionLog("core-test-cancel-early.log")
    let tk = TurnToken()
    tk.cancel()
    let r = TurnLoop().run(ScriptedProvider(chunks5(), tk, -1), tk, log, DeliveryQueue(1))
    @Expect(r.cancelled, true)
    @Expect(r.delivered, Int64(0))
    @Expect(log.events.size, Int64(1))
    @Expect(log.events[0].eventType, "turn/start")
    cleanCancel("early")
}

@Test
func cancelMidStreamKeepsPartialTextAndMarksInterrupted() {
    let log = SessionLog("core-test-cancel-mid.log")
    let tk = TurnToken()
    let r = TurnLoop().run(ScriptedProvider(chunks5(), tk, 2), tk, log, DeliveryQueue(8))
    @Expect(r.cancelled, true)
    @Expect(r.delivered, Int64(2))
    @Expect(r.text, "ab")
    @Expect(r.interrupted, true)
    // finish 帧不得出现：被取消的 turn 没有终态原因
    @Expect(r.finishReason, "")
    var hasCancelled = false
    for (ev in log.events) {
        if (ev.eventType == "turn/cancelled") {
            hasCancelled = true
        }
    }
    @Expect(hasCancelled, true)
    cleanCancel("mid")
}

@Test
func cancelledTurnSettlesOutstandingToolCalls() {
    let log = SessionLog("core-test-cancel-tool.log")
    let tk = TurnToken()
    // 第 3 个 chunk 是 tool-call-delta，取消点在它之后：待结算工具调用不得留悬挂
    let r = TurnLoop().run(ScriptedProvider(chunks5(), tk, 3), tk, log, DeliveryQueue(8))
    @Expect(r.settledToolCalls, Int64(1))
    @Expect(r.pendingToolCalls, Int64(0))
    var settledInLog = false
    for (ev in log.events) {
        if (ev.eventType == "tool/result" && ev.data.contains("cancelled:read")) {
            settledInLog = true
        }
    }
    @Expect(settledInLog, true)
    cleanCancel("tool")
}

@Test
func uncancelledTurnCompletesCleanly() {
    let log = SessionLog("core-test-cancel-none.log")
    let tk = TurnToken()
    let q = DeliveryQueue(8)
    let r = TurnLoop().run(ScriptedProvider(chunks5(), tk, -1), tk, log, q)
    @Expect(r.cancelled, false)
    @Expect(r.interrupted, false)
    @Expect(r.finishReason, "stop")
    @Expect(r.usage, "17")
    @Expect(q.overflow(), Int64(0))
    // 干净收束的助手正文必须落进日志：日志是唯一真源，UI 与模型历史都由它投影，
    // 只活在 turn/poll 帧里的回复重启即丢。
    var assistantN: Int64 = 0
    var assistantText = ""
    for (ev in log.events) {
        if (ev.eventType == "assistant/message") {
            assistantN += 1
            assistantText = ev.data
        }
    }
    @Expect(assistantN, Int64(1))
    @Expect(assistantText, "ab")
    // 落进日志就得进模型可见历史，否则两个入口看到的「助手说过什么」不一致
    var inProj = false
    for (m in log.deriveMessages()) {
        if (m == "assistant/message: ab") {
            inProj = true
        }
    }
    @Expect(inProj, true)
    cleanCancel("none")
}

@Test
func cancelledTurnPersistsNoAssistantMessage() {
    let log = SessionLog("core-test-cancel-nosettle.log")
    let tk = TurnToken()
    let r = TurnLoop().run(ScriptedProvider(chunks5(), tk, 2), tk, log, DeliveryQueue(8))
    @Expect(r.cancelled, true)
    // 半截正文不进模型历史：没有终态原因的回复不能冒充助手说过完整的话
    var n: Int64 = 0
    for (ev in log.events) {
        if (ev.eventType == "assistant/message") {
            n += 1
        }
    }
    @Expect(n, Int64(0))
    // 部分文本仍在结果里，由界面按 interrupted 呈现，不是由日志冒充
    @Expect(r.text, "ab")
    cleanCancel("nosettle")
}

@Test
func acceptedFinishIsNotOverriddenByLaterCancellation() {
    let log = SessionLog("core-test-cancel-finish-boundary.log")
    let tk = TurnToken()
    let r = TurnLoop().run(ScriptedProvider(chunks5(), tk, 5), tk, log, DeliveryQueue(8))
    @Expect(r.cancelled, false)
    @Expect(r.interrupted, false)
    @Expect(r.finishReason, "stop")
    @Expect(tk.cancelled(), false)
    @Expect(log.deriveMessages().size, Int64(1))
    cleanCancel("finish-boundary")
}

class FailingFrameProvider <: Provider {
    public func next(): Option<Chunk> { throw IllegalStateException("provider-failed") }
}

@Test
func providerFailureDoesNotPublishAssistantHistory() {
    let log = SessionLog("core-test-cancel-provider-error.log")
    let tk = TurnToken()
    var threw = false
    try {
        TurnLoop().run(FailingFrameProvider(), tk, log, DeliveryQueue(8))
    } catch (e: IllegalStateException) {
        threw = true
    }
    @Expect(threw, true)
    @Expect(tk.cancelled(), false)
    @Expect(log.deriveMessages().size, Int64(0))
    cleanCancel("provider-error")
}

class CancellingFrameProvider <: Provider {
    let token: TurnToken
    init(token: TurnToken) { this.token = token }
    public func next(): Option<Chunk> {
        token.cancel()
        return Some(Chunk("text", "late", ""))
    }
}

@Test
func cancellationDuringProviderReadDoesNotPublishReturnedFrame() {
    let log = SessionLog("core-test-cancel-read-boundary.log")
    let tk = TurnToken()
    let sink = DeliveryQueue(8)
    let r = TurnLoop().run(CancellingFrameProvider(tk), tk, log, sink)
    @Expect(r.cancelled, true)
    @Expect(r.delivered, Int64(0))
    @Expect(sink.size(), Int64(0))
    @Expect(r.text, "")
    @Expect(log.eventCount(), Int64(1))
    cleanCancel("read-boundary")
}

@Test
func interruptedProviderDoesNotPublishAssistantHistory() {
    let log = SessionLog("core-test-cancel-interrupted.log")
    let tk = TurnToken()
    let chs = ArrayList<Chunk>()
    chs.add(Chunk("text", "partial", ""))
    let r = TurnLoop().run(ScriptedProvider(chs, tk, -1), tk, log, DeliveryQueue(8))
    @Expect(r.interrupted, true)
    @Expect(r.cancelled, false)
    @Expect(r.text, "partial")
    @Expect(log.deriveMessages().size, Int64(0))
    log.flush()
    let replay = SessionLog("core-test-cancel-interrupted.log")
    @Expect(replay.load(), true)
    @Expect(replay.deriveMessages().size, Int64(0))
    cleanCancel("interrupted")
}

@Test
func deliveryQueueOverflowSignalsWithoutLoss() {
    let q = DeliveryQueue(1)
    @Expect(q.offer("1"), true)
    @Expect(q.offer("2"), false)
    @Expect(q.offer("3"), false)
    @Expect(q.overflow(), Int64(2))
    // 溢出只算「未投递」，队列本身从不丢帧：dropped 恒为 0
    @Expect(q.dropped(), Int64(0))
    @Expect(q.size(), Int64(1))
}

@Test
func slowConsumerDrainsAndDeliveryResumes() {
    let log = SessionLog("core-test-cancel-slow.log")
    let tk = TurnToken()
    let q = DeliveryQueue(1)
    let r = TurnLoop().run(ScriptedProvider(chunks5(), tk, -1), tk, log, q)
    @Expect(r.delivered, Int64(5))
    @Expect(q.overflow(), Int64(4))
    // 慢消费者追上来：事件始终可以从持久日志按游标完整恢复
    let got = q.drain(64)
    @Expect(got.size, Int64(1))
    // 干净收束的一轮写 7 条：turn/start + 5 帧 stream/chunk + 1 条 assistant/message
    @Expect(log.events.size, Int64(7))
    cleanCancel("slow")
}

@Test
func childTokenFollowsParentCancel() {
    let parent = TurnToken()
    let child = parent.child()
    @Expect(child.cancelled(), false)
    parent.cancel()
    @Expect(child.cancelled(), true)
}

@Test
func detachedHandoffSurvivesParentCancel() {
    let parent = TurnToken()
    // 「已独立发布」的后台任务：父 turn 取消不得连带杀死它
    let handed = parent.detached()
    parent.cancel()
    @Expect(parent.cancelled(), true)
    @Expect(handed.cancelled(), false)
    handed.cancel()
    @Expect(handed.cancelled(), true)
}

@Test
func deliveryQueueReclaimsConsumedStorageAcrossLongCycles() {
    let q = DeliveryQueue(3)
    var peak: Int64 = 0
    for (i in 0..20000) {
        @Assert(q.offer("${i}"), true)
        if (q.frames.size > peak) { peak = q.frames.size }
        @Assert(q.drain(1)[0], "${i}")
    }
    @Expect(q.frames.size, Int64(0))
    @Expect(peak <= 3, true)
    @Expect(q.drain(0).size, Int64(0))
    @Expect(q.drain(-1).size, Int64(0))
    @Expect(q.size(), Int64(0))
    for (i in 0..10000) {
        @Assert(q.offer("${i}:a"), true)
        @Assert(q.offer("${i}:b"), true)
        @Assert(q.offer("${i}:c"), true)
        @Expect(q.offer("overflow"), false)
        let first = q.drain(2)
        @Assert(first[0], "${i}:a")
        @Assert(first[1], "${i}:b")
        @Expect(q.frames.size, Int64(1))
        @Assert(q.offer("${i}:d"), true)
        let rest = q.drain(8)
        @Assert(rest[0], "${i}:c")
        @Assert(rest[1], "${i}:d")
        @Expect(q.frames.size, Int64(0))
    }
    @Expect(q.overflow(), Int64(10000))
    println("LONG QUEUE cycles=20000 peak=${peak} retained=${q.frames.size} partialCycles=10000 overflow=${q.overflow()}")
}

func cleanCancel(tag: String) {
    removeIfExists("core-test-cancel-${tag}.log", recursive: false)
    removeIfExists("core-test-cancel-${tag}.log.lease", recursive: false)
}
