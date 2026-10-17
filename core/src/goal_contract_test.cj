package core
import std.fs.*
import std.unittest.*

// 冻结 DSH 的输入校验和合法迁移；拒绝时不能追加事件。
@Test
func goalContractRejectsBlankObjectiveWithoutMutation() {
    let root = "core-goal-contract-blank"
    removeIfExists(root, recursive: true); Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let svc = GoalService(log)
    var error = ""
    try { svc.create(" \n\t ") } catch (e: Exception) { error = e.message }
    @Expect(error, "bad-goal-objective")
    @Expect(log.eventCount(), Int64(0))
    let g = svc.create("目标")
    error = ""
    try { svc.edit(g.revision, " \t ") } catch (e: Exception) { error = e.message }
    @Expect(error, "bad-goal-objective")
    @Expect(log.eventCount(), Int64(1))
    @Expect(svc.snapshot().objective, "目标")
    removeIfExists(root, recursive: true)
}

@Test
func goalContractNormalizesObjectiveAtCoreBoundary() {
    let root = "core-goal-contract-trim"
    removeIfExists(root, recursive: true); Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let svc = GoalService(log)
    let g = svc.create(" \n初始目标\t ")
    @Expect(g.objective, "初始目标")
    let edited = svc.edit(g.revision, "  新目标\n ")
    @Expect(edited.objective, "新目标")
    @Expect(svc.snapshot().objective, "新目标")
    removeIfExists(root, recursive: true)
}

@Test
func goalContractCompletedGoalCannotResumePauseOrCompleteAgain() {
    let root = "core-goal-contract-terminal"
    removeIfExists(root, recursive: true); Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let svc = GoalService(log)
    let done = svc.complete(svc.create("目标").revision)
    var rejected = Int64(0)
    try { svc.resume(done.revision) } catch (e: Exception) { if (e.message == "invalid-goal-transition") { rejected += 1 } }
    try { svc.pause(done.revision) } catch (e: Exception) { if (e.message == "invalid-goal-transition") { rejected += 1 } }
    try { svc.complete(done.revision) } catch (e: Exception) { if (e.message == "invalid-goal-transition") { rejected += 1 } }
    @Expect(rejected, Int64(3))
    @Expect(log.eventCount(), Int64(2))
    @Expect(svc.snapshot().phase, "complete")
    removeIfExists(root, recursive: true)
}

@Test
func goalContractOnlyActiveMayPauseOrBlockAndReasonCannotBeBlank() {
    let root = "core-goal-contract-stopped"
    removeIfExists(root, recursive: true); Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let svc = GoalService(log)
    let g = svc.create("目标")
    var error = ""
    try { svc.block(g.revision, " \n ") } catch (e: Exception) { error = e.message }
    @Expect(error, "bad-goal-block-reason")
    @Expect(log.eventCount(), Int64(1))
    let paused = svc.pause(g.revision)
    var rejected = Int64(0)
    try { svc.pause(paused.revision) } catch (e: Exception) { if (e.message == "invalid-goal-transition") { rejected += 1 } }
    try { svc.block(paused.revision, "缺依赖") } catch (e: Exception) { if (e.message == "invalid-goal-transition") { rejected += 1 } }
    @Expect(rejected, Int64(2))
    @Expect(log.eventCount(), Int64(2))
    @Expect(svc.snapshot().phase, "paused")
    removeIfExists(root, recursive: true)
}
