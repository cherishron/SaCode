package core

import std.unittest.*
import std.sync.*
import std.fs.*

// C7 的第二半：取消必须真的跨线程生效，背压必须真的能并发。
// 桌面端的 stop 按钮、CLI 的中断、以及仓颉侧驱动 extjs 子进程，靠的都是这两条。

// 先吐 limit 帧，然后卡在「流中间」直到取消信号跨线程可见，再收束。
class StreamThenWaitForCancel <: Provider {
    let token: TurnToken
    let gate: SyncCounter
    let emitted: AtomicInt64
    var i: Int64 = 0
    let limit: Int64

    public init(token: TurnToken, gate: SyncCounter, emitted: AtomicInt64, limit: Int64) {
        this.token = token
        this.gate = gate
        this.emitted = emitted
        this.limit = limit
    }

    public func next(): Option<Chunk> {
        if (i < limit) {
            i += 1
            emitted.fetchAdd(1)
            return Some(Chunk("text", "x", ""))
        }
        if (i == limit) {
            // 通知外部：已经进到「只有取消才能出来」的位置
            i += 1
            gate.dec()
        }
        var spins: Int64 = 0
        while (!token.cancelled() && spins < 200) {
            sleep(1 * Duration.millisecond)
            spins += 1
        }
        return None
    }
}

@Test
func cancelFromAnotherThreadStopsTheRunningTurn() {
    let log = SessionLog("core-test-thread-cancel.log")
    let tk = TurnToken()
    let gate = SyncCounter(1)
    let emitted = AtomicInt64(0)
    let h = TurnRunner().start(StreamThenWaitForCancel(tk, gate, emitted, 2), tk, log, DeliveryQueue(8))
    gate.waitUntilZero()
    h.cancel()
    let r = h.result()
    @Expect(r.cancelled, true)
    @Expect(r.delivered, Int64(2))
    // 取消信号确实被生产线程读到：发的帧数与 loop 记的一致，没有事后多发的帧
    @Expect(emitted.load(), Int64(2))
    @Expect(h.isRunning(), false)
    cleanThread("cancel")
}

@Test
func futureCancelIsCooperativeNotForced() {
    // 只有 loop 在检查点配合，取消才会生效；这条把「协作式」钉成可执行事实，
    // 免得以后有人以为 Future.cancel() 能强行掐断线程。
    let seen = AtomicInt64(0)
    let f = spawn { =>
        for (_ in 0..4) {
            seen.fetchAdd(1)
        }
        Int64(7)
    }
    f.cancel()
    @Expect(f.get(), Int64(7))
    @Expect(seen.load(), Int64(4))
}

@Test
func detachedHandoffKeepsRunningAfterParentCancel() {
    let parent = TurnToken()
    // 已独立发布的后台任务（比如子进程清理）：父 turn 取消不得连带杀死它
    let handed = parent.detached()
    let gate = SyncCounter(1)
    let done = AtomicInt64(0)
    spawn { =>
        gate.waitUntilZero()
        if (!handed.cancelled()) {
            done.fetchAdd(1)
        }
    }
    parent.cancel()
    gate.dec()
    var spins: Int64 = 0
    while (done.load() == 0 && spins < 200) {
        sleep(1 * Duration.millisecond)
        spins += 1
    }
    @Expect(done.load(), Int64(1))
}

@Test
func mutexedQueueCarriesAllFramesAcrossThreads() {
    // 只有 2 个槽位：背压信号会亮，但一帧都不能丢，也不能卡死生产者
    let q = ThreadSafeDeliveryQueue(2)
    let accepted = AtomicInt64(0)
    let rejected = AtomicInt64(0)
    let gate = SyncCounter(1)
    let producer = spawn { =>
        gate.waitUntilZero()
        var k: Int64 = 0
        while (k < 5) {
            if (q.offer("f${k}")) {
                accepted.fetchAdd(1)
            } else {
                rejected.fetchAdd(1)
            }
            k += 1
        }
        Int64(5)
    }
    gate.dec()
    @Expect(producer.get(), Int64(5))
    @Expect(accepted.load() + rejected.load(), Int64(5))
    @Expect(rejected.load() > 0, true)
    @Expect(q.dropped(), Int64(0))
    let rest = q.take(64)
    @Expect(rest.size, accepted.load())
}

@Test
func consumerWaitWakesOnOffer() {
    let q = ThreadSafeDeliveryQueue(4)
    let gate = SyncCounter(1)
    let pushed = AtomicInt64(0)
    spawn { =>
        gate.waitUntilZero()
        q.offer("late-frame")
        pushed.fetchAdd(1)
    }
    gate.dec()
    let got = q.await(2000)
    @Expect(got.size, Int64(1))
    @Expect(got[0], "late-frame")
    @Expect(pushed.load(), Int64(1))
}

@Test
func consumerWaitTimesOutWhenNoFrameArrives() {
    // 超时必须回报「没有」，不能抛，也不能挂住读循环
    let q = ThreadSafeDeliveryQueue(4)
    let got = q.await(20)
    @Expect(got.size, Int64(0))
}

@Test
func resultIsAvailableOnlyAfterTheThreadFinishes() {
    let log = SessionLog("core-test-thread-ready.log")
    let tk = TurnToken()
    let gate = SyncCounter(1)
    let emitted = AtomicInt64(0)
    let h = TurnRunner().start(StreamThenWaitForCancel(tk, gate, emitted, 3), tk, log, DeliveryQueue(8))
    gate.waitUntilZero()
    @Expect(h.isRunning(), true)
    @Expect(h.tryResult().cancelled, false)
    h.cancel()
    let r = h.result()
    @Expect(r.cancelled, true)
    @Expect(r.delivered, Int64(3))
    @Expect(h.isRunning(), false)
    cleanThread("ready")
}

@Test
func cancellableProviderEndsNormallyWhenStreamIsExhausted() {
    // 正常跑完的 turn 不该被当成「等人来取消」：发完全部帧就收束，且保留终态原因
    let log = SessionLog("core-test-thread-normal.log")
    let tk = TurnToken()
    let q = ThreadSafeDeliveryQueue(8)
    let h = TurnRunner().start(CancellableStreamProvider(tk, 5), tk, log, q)
    let r = h.result()
    @Expect(r.cancelled, false)
    @Expect(r.delivered, Int64(5))
    @Expect(r.finishReason, "stop")
    @Expect(r.text, "你好，world")
    @Expect(r.interrupted, false)
    // 跨线程投递：投出去 5 帧，容量 8 不该有背压
    @Expect(q.overflow(), Int64(0))
    @Expect(q.take(64).size, Int64(5))
    cleanThread("normal")
}

@Test
func cancellableProviderIsCancelledMidStreamFromAnotherThread() {
    // 与 CLI/Host 入口同一条路径：limit 帧后停在帧间，只有别的线程取消才收束
    let log = SessionLog("core-test-thread-mid.log")
    let tk = TurnToken()
    let q = ThreadSafeDeliveryQueue(8)
    let h = TurnRunner().start(CancellableStreamProvider(tk, 2), tk, log, q)
    var spins: Int64 = 0
    while (q.size() == 0 && spins < 3000) {
        sleep(1 * Duration.millisecond)
        spins += 1
    }
    @Expect(q.size() > 0, true)
    h.cancel()
    let r = h.result()
    @Expect(r.cancelled, true)
    @Expect(r.delivered, Int64(2))
    @Expect(r.text, "你好，world")
    @Expect(r.finishReason, "")
    @Expect(h.isRunning(), false)
    cleanThread("mid")
}

func cleanThread(tag: String) {
    removeIfExists("core-test-thread-${tag}.log", recursive: false)
    removeIfExists("core-test-thread-${tag}.log.lease", recursive: false)
}
