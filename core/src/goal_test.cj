package core
import std.fs.*
import std.unittest.*

// Goal 上游契约（313 行）：`GoalRef { id, revision }` CAS；`GoalPhase` 四态
// active/paused/blocked/complete；每次变更都是 `goal/change` log-only 事件，
// 载荷为完整快照或 clear 墓碑。本切片实现 create/get/edit/pause/resume/
// complete/block/clear 与 CAS 拒绝。

@Test
func goalCreateAssignsIdRevisionAndActivePhase() {
    let root = "core-goal-create"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    log.append("user/message", "开工")
    let svc = GoalService(log)
    let snap = svc.create("把 49 模块复刻到底")
    @Expect(snap.id, "goal-1")
    @Expect(snap.revision, Int64(1))
    @Expect(snap.phase, "active")
    @Expect(snap.objective, "把 49 模块复刻到底")
    // log-only：模型历史只看到那一条 user/message。
    @Expect(log.deriveMessages().size, Int64(1))
    removeIfExists(root, recursive: true)
}

@Test
func goalCasRejectsStaleRevisionWithoutAppending() {
    let root = "core-goal-cas"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let svc = GoalService(log)
    svc.create("初版")
    let eventsBefore = log.snapshotEvents().size
    var threw = false
    try {
        // 用 revision=0 试图覆盖真实值 1——陈旧 CAS。
        svc.edit(0, "改写")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    // 拒绝的编辑不许留下事件，否则日志会谎称改过。
    @Expect(log.snapshotEvents().size, eventsBefore)
    @Expect(svc.snapshot().objective, "初版")
    removeIfExists(root, recursive: true)
}

@Test
func goalPhaseTransitionsReplayAfterFlush() {
    let root = "core-goal-phase"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let svc = GoalService(log)
    let first = svc.create("目标")
    svc.pause(first.revision)
    let resumed = svc.resume(2)
    @Expect(resumed.phase, "active")
    @Expect(resumed.revision, Int64(3))
    svc.block(3, "缺真模型凭证")
    svc.complete(4)
    @Expect(log.flush(), true)
    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    let replayed = GoalService(fresh).snapshot()
    @Expect(replayed.phase, "complete")
    @Expect(replayed.revision, Int64(5))
    removeIfExists(root, recursive: true)
}

@Test
func goalClearWritesTombstoneAndSnapshotReturnsEmpty() {
    let root = "core-goal-clear"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let svc = GoalService(log)
    svc.create("短期目标")
    svc.clear(1)
    // 墓碑后 snapshot 返回空 objective 与 phase='none'。
    @Expect(svc.snapshot().phase, "none")
    @Expect(svc.snapshot().objective, "")
    // 事件数：create 1 + clear 1 = 2。
    @Expect(log.snapshotEvents().size, Int64(2))
    removeIfExists(root, recursive: true)
}

// `|` 是 goal/change 的字段分隔符：目标文本里带它，写进去的和读出来的就不是同一件事。
// 建立/编辑/阻塞三条写路径都要拒，且不落事件（CAS 与「日志不谎称改过」同一口径）。
@Test
func goalObjectiveContainingDelimiterIsRejectedWithoutWriting() {
    let root = "core-goal-delimi"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let svc = GoalService(log)
    var created = ""
    try {
        svc.create("甲|乙")
        created = "accepted"
    } catch (e: Exception) {
        created = e.message
    }
    @Expect(created, "bad-goal-content")
    @Expect(log.eventCount(), Int64(0))
    @Expect(svc.snapshot().phase, "none")

    let ok = svc.create("正常的目标")
    @Expect(ok.phase, "active")
    var edited = ""
    try {
        svc.edit(ok.revision, "丙|丁")
        edited = "accepted"
    } catch (e: Exception) {
        edited = e.message
    }
    @Expect(edited, "bad-goal-content")
    var blocked = ""
    try {
        svc.block(ok.revision, "缺|凭据")
        blocked = "accepted"
    } catch (e: Exception) {
        blocked = e.message
    }
    @Expect(blocked, "bad-goal-content")
    // 两次拒绝都不许在日志里留下痕迹：revision 仍停在 1
    @Expect(svc.snapshot().revision, Int64(1))
    @Expect(svc.snapshot().objective, "正常的目标")
    removeIfExists(root, recursive: true)
}
