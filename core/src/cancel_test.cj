package core

import std.unittest.*
import std.collection.ArrayList
import std.fs.*

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
    cleanCancel("none")
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
    @Expect(log.events.size, Int64(6))
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

func cleanCancel(tag: String) {
    removeIfExists("core-test-cancel-${tag}.log", recursive: false)
    removeIfExists("core-test-cancel-${tag}.log.lease", recursive: false)
}
