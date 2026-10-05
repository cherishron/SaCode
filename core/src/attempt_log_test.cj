package core

import std.fs.*
import std.unittest.*

// 尝试事件：先发标记与失败事实都落 usage-ledger.log——与 B3 的账本同一个文件、
// 同一条租约写路径。B2 只写这两类事件，不写金额。
let alFile = "core-test-usage-ledger.log"

func alCleanup(): Unit {
    for (f in [alFile, "${alFile}.lease"]) {
        if (exists(f)) {
            try { removeIfExists(f, recursive: false) } catch (e: Exception) {}
        }
    }
}

// 重放闸读的是日志里先发落盘的标记，不是内存标志：发送完才写标记的话，
// 崩溃正好落在发送与补记之间时重启后毫无痕迹，于是把可能已送达上游的请求重发一遍。
@Test
func dispatchedMarkIsDurableBeforeAnySend() {
    alCleanup()
    let log = AttemptLog(alFile)
    @Expect(log.markDispatched("lr-1", "at-1", "step/m-a"), true)
    // 换实例读同一份日志：唯一的证据是盘上那条事件
    @Expect(AttemptLog(alFile).dispatched("at-1"), true)
    @Expect(AttemptLog(alFile).dispatched("at-2"), false)
    alCleanup()
}

@Test
func dispatchedSurvivesReplayAndKeepsRouteKey() {
    alCleanup()
    AttemptLog(alFile).markDispatched("lr-9", "at-9", "deepseek-b/m-1")
    let unsettled = AttemptLog(alFile).lastDispatchedUnsettled()
    @Expect(unsettled.size, Int64(1))
    @Expect(unsettled[0], "at-9")
    alCleanup()
}

// 失败事实要能带出「是否已上线」这一维，供 §6 的重发白名单判定
@Test
func failureEventCarriesReachedUpstream() {
    alCleanup()
    let log = AttemptLog(alFile)
    log.markDispatched("lr-2", "at-2", "step/m-a")
    @Expect(log.markFailed("at-2", failureOf("transport", true, summary: "read-timeout")), true)
    @Expect(AttemptLog(alFile).lastDispatchedUnsettled().size, Int64(0))
    // 失败事实本身留在日志里（供 RouteHealth 回放归因），不是被删掉
    @Expect(AttemptLog(alFile).failedCount(), Int64(1))
    alCleanup()
}

// 标记写不下去就不发：租约被别人持有时 markDispatched 必须回 false，
// 而不是「先发出去、回头补记」——恰好在最需要证据的场合没有证据。
@Test
func dispatchedFailsClosedWhenTheLeaseIsHeld() {
    alCleanup()
    let held = WriteLease(alFile)
    @Expect(held.acquire(), true)
    try {
        @Expect(AttemptLog(alFile).markDispatched("lr-3", "at-3", "step/m-a"), false)
        // 没写下去就不能留痕：否则「写失败但看起来写了」比不写更坏
        @Expect(AttemptLog(alFile).dispatched("at-3"), false)
    } finally {
        held.release()
    }
    alCleanup()
}
