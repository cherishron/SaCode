package core
import std.collection.*
import std.fs.*
import std.unittest.*

// 子代理上游契约（M7）：`ctx.subagent.spawn(name, task)` 生成一个远端 sub-agent
// 会话；`join(id)` 收集结果；`cancel(id)` 中止。本切片以 log-only `subagent/spawn`
// 与 `subagent/settle` 事件承载；状态 pending/settled/cancelled。

@Test
func subagentSpawnThenSettle() {
    let root = "core-sub-happy"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let sa = SubagentLedger(log)
    sa.launch("a1", "research")
    @Expect(sa.status("a1"), "pending")
    sa.settle("a1", "结论摘要")
    @Expect(sa.status("a1"), "settled")
    @Expect(sa.resultOf("a1"), "结论摘要")
    removeIfExists(root, recursive: true)
}

@Test
func subagentCancelPendingOnly() {
    let root = "core-sub-cancel"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let sa = SubagentLedger(log)
    sa.launch("a1", "research")
    sa.cancel("a1")
    @Expect(sa.status("a1"), "cancelled")
    var threwSettle = false
    try {
        sa.settle("a1", "x")
    } catch (e: Exception) {
        threwSettle = true
    }
    @Expect(threwSettle, true)
    removeIfExists(root, recursive: true)
}

@Test
func subagentRejectsEmptyIdOrTask() {
    let root = "core-sub-empty"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let sa = SubagentLedger(log)
    var threwId = false
    try {
        sa.launch("", "research")
    } catch (e: Exception) {
        threwId = true
    }
    @Expect(threwId, true)
    var threwTask = false
    try {
        sa.launch("a1", "")
    } catch (e: Exception) {
        threwTask = true
    }
    @Expect(threwTask, true)
    @Expect(sa.count(), Int64(0))
    removeIfExists(root, recursive: true)
}

@Test
func subagentEventsAreLogOnlyAcrossReplay() {
    let root = "core-sub-replay"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let sa = SubagentLedger(log)
    log.append("user/message", "开工")
    sa.launch("a1", "research")
    sa.settle("a1", "结论")
    @Expect(log.flush(), true)
    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    @Expect(fresh.deriveMessages().size, Int64(1))
    let replayed = SubagentLedger(fresh)
    @Expect(replayed.status("a1"), "settled")
    @Expect(replayed.resultOf("a1"), "结论")
    removeIfExists(root, recursive: true)
}
