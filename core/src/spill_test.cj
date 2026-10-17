package core
import std.collection.*
import std.fs.*
import std.unittest.*

// 溢出记录上游契约（M1）：长会话超预算时把某轮正文/工具输出 spill 到仓外，
// 会话日志只留 `spill/marker` 事件承载轮次与原因；投影读侧仍可见 marker
// 但不含正文。本切片以 log-only `spill/marker` 事件承载「轮::原因」两字段。

@Test
func spillRecordsMarkerAndListsBack() {
    let root = "core-spill-list"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let spill = SpillStore(log)
    spill.record("turn-1", "over-budget")
    spill.record("turn-2", "tool-output")
    let list = spill.markers()
    @Expect(list.size, Int64(2))
    @Expect(list[0], "turn-1::over-budget")
    @Expect(list[1], "turn-2::tool-output")
    removeIfExists(root, recursive: true)
}

@Test
func spillRejectsEmptyTurnOrReason() {
    let root = "core-spill-reject"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let spill = SpillStore(log)
    var threwTurn = false
    try {
        spill.record("", "over-budget")
    } catch (e: Exception) {
        threwTurn = true
    }
    @Expect(threwTurn, true)
    var threwReason = false
    try {
        spill.record("turn-1", "")
    } catch (e: Exception) {
        threwReason = true
    }
    @Expect(threwReason, true)
    @Expect(spill.markers().size, Int64(0))
    removeIfExists(root, recursive: true)
}

@Test
func spillMarkerEventIsLogOnlyAcrossReplay() {
    let root = "core-spill-replay"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let spill = SpillStore(log)
    log.append("user/message", "开工")
    spill.record("turn-1", "over-budget")
    @Expect(log.flush(), true)
    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    @Expect(fresh.deriveMessages().size, Int64(1))
    @Expect(SpillStore(fresh).markers().size, Int64(1))
    removeIfExists(root, recursive: true)
}
