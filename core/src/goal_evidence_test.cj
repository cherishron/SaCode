package core
import std.fs.*
import std.unittest.*

// 完成证据的机械侧（`goal/evidence`）：绑定开轮修订**与**轮次号。四条反证：
// 正常记录可读回；修订被换后拒写；轮次号对不上不算证据；崩溃恢复后仍答得出。

// 记录与读回：同一修订同一轮可读回，换轮次或换修订都读不到。
@Test
func evidenceIsBoundToRevisionAndRound() {
    let path = "core-goal-evidence-bind.log"
    removeIfExists(path, recursive: false)
    let log = SessionLog(path)
    let svc = GoalService(log)
    let revision = svc.create("证据要绑定修订与轮次").revision
    let evidence = GoalEvidence(log)
    @Expect(evidence.satisfiedFor(revision, Int64(1)), false)
    @Expect(evidence.record(revision, Int64(1)), true)
    @Expect(evidence.satisfiedFor(revision, Int64(1)), true)
    // 同一修订的别的轮次不共享这条证据：上一轮的副作用替不了这一轮。
    @Expect(evidence.satisfiedFor(revision, Int64(2)), false)
    // 别的修订也读不到。
    @Expect(evidence.satisfiedFor(revision + Int64(1), Int64(1)), false)
    @Expect(evidence.count(), Int64(1))
    removeIfExists(path, recursive: false)
}

// 修订已变（轮内被编辑/暂停/清除）时拒写，且一条事件都不留——
// 不替新状态背书，也不靠一条「记下了但没生效」的事件糊弄过去。
@Test
func evidenceRefusesStaleRevisionWithoutAppending() {
    let path = "core-goal-evidence-stale.log"
    removeIfExists(path, recursive: false)
    let log = SessionLog(path)
    let svc = GoalService(log)
    let created = svc.create("轮内改目标")
    let evidence = GoalEvidence(log)
    svc.edit(created.revision, "改写后的目标")
    @Expect(evidence.record(created.revision, Int64(1)), false)
    @Expect(evidence.satisfiedFor(created.revision, Int64(1)), false)
    @Expect(evidence.count(), Int64(0))
    // 已暂停的目标同样收不到新证据。
    svc.pause(svc.snapshot().revision)
    @Expect(evidence.record(svc.snapshot().revision, Int64(1)), false)
    @Expect(evidence.count(), Int64(0))
    removeIfExists(path, recursive: false)
}

// 证据是 log-only：不进模型可见历史，也不进转录。
@Test
func evidenceStaysOutOfModelHistory() {
    let path = "core-goal-evidence-surface.log"
    removeIfExists(path, recursive: false)
    let log = SessionLog(path)
    log.append("user/message", "开工")
    let svc = GoalService(log)
    let revision = svc.create("证据不进模型历史").revision
    GoalEvidence(log).record(revision, Int64(1))
    @Expect(log.deriveMessages().size, Int64(1))
    @Expect(modelRequestJson("test-model", log.snapshotEvents().toArray()).contains("goal/evidence"), false)
    removeIfExists(path, recursive: false)
}

// 崩溃恢复同源：证据落盘后重放仍读得到，完成依据不会随进程一起消失。
@Test
func evidenceSurvivesCrashReplay() {
    let path = "core-goal-evidence-replay.log"
    removeIfExists(path, recursive: false)
    let log = SessionLog(path)
    let revision = GoalService(log).create("证据要扛住崩溃").revision
    GoalEvidence(log).record(revision, Int64(3))
    @Expect(log.flush(), true)
    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    @Expect(GoalEvidence(fresh).satisfiedFor(revision, Int64(3)), true)
    @Expect(GoalEvidence(fresh).satisfiedFor(revision, Int64(4)), false)
    removeIfExists(path, recursive: false)
}