package core

import std.fs.*
import std.unittest.*

// 尝试事件：先发标记与失败事实都落 usage-ledger.log——与 B3 的账本同一个文件、
// 同一条租约写路径。B2 只写这两类事件，不写金额。
//
// 每个用例用自己独立的账本文件。仓颉单测默认并行执行，四个用例若共用一个固定
// 文件名，某个用例开头的 alCleanup 会在另一个用例「写标记」与「换实例回读」之间
// 把文件删掉，读侧只能拿到 false。实测：另一批用例加入后这条用例由绿转红，
// 而同一二进制 --parallel 1 立刻回绿——所以隔离必须落在用例自己身上，
// 不能依赖执行顺序，也不能靠串行执行掩盖。

func alCleanup(name: String): Unit {
    for (f in [name, "${name}.lease"]) {
        if (exists(f)) {
            try { removeIfExists(f, recursive: false) } catch (e: Exception) {}
        }
    }
}

// 重放闸读的是日志里先发落盘的标记，不是内存标志：发送完才写标记的话，
// 崩溃正好落在发送与补记之间时重启后毫无痕迹，于是把可能已送达上游的请求重发一遍。
@Test
func dispatchedMarkIsDurableBeforeAnySend() {
    let ledger = "core-test-usage-ledger-durable.log"
    alCleanup(ledger)
    let log = AttemptLog(ledger)
    @Expect(log.markDispatched("lr-1", "at-1", "step/m-a"), true)
    // 换实例读同一份日志：唯一的证据是盘上那条事件
    @Expect(AttemptLog(ledger).dispatched("at-1"), true)
    @Expect(AttemptLog(ledger).dispatched("at-2"), false)
    alCleanup(ledger)
}

@Test
func dispatchedSurvivesReplayAndKeepsRouteKey() {
    let ledger = "core-test-usage-ledger-replay.log"
    alCleanup(ledger)
    AttemptLog(ledger).markDispatched("lr-9", "at-9", "deepseek-b/m-1")
    let unsettled = AttemptLog(ledger).lastDispatchedUnsettled()
    @Expect(unsettled.size, Int64(1))
    @Expect(unsettled[0], "at-9")
    alCleanup(ledger)
}

// 失败事实要能带出「是否已上线」这一维，供 §6 的重发白名单判定
@Test
func failureEventCarriesReachedUpstream() {
    let ledger = "core-test-usage-ledger-failure.log"
    alCleanup(ledger)
    let log = AttemptLog(ledger)
    log.markDispatched("lr-2", "at-2", "step/m-a")
    @Expect(log.markFailed("at-2", failureOf("transport", true, summary: "read-timeout")), true)
    @Expect(AttemptLog(ledger).lastDispatchedUnsettled().size, Int64(0))
    // 失败事实本身留在日志里（供 RouteHealth 回放归因），不是被删掉
    @Expect(AttemptLog(ledger).failedCount(), Int64(1))
    alCleanup(ledger)
}

// 标记写不下去就不发：租约被别人持有时 markDispatched 必须回 false，
// 而不是「先发出去、回头补记」——恰好在最需要证据的场合没有证据。
@Test
func dispatchedFailsClosedWhenTheLeaseIsHeld() {
    let ledger = "core-test-usage-ledger-lease.log"
    alCleanup(ledger)
    let held = WriteLease(ledger)
    @Expect(held.acquire(), true)
    try {
        @Expect(AttemptLog(ledger).markDispatched("lr-3", "at-3", "step/m-a"), false)
        // 没写下去就不能留痕：否则「写失败但看起来写了」比不写更坏
        @Expect(AttemptLog(ledger).dispatched("at-3"), false)
    } finally {
        held.release()
    }
    alCleanup(ledger)
}
