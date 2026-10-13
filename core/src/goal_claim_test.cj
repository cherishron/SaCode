package core

import std.unittest.*

@Test
func goalClaimRejectsClosedRoundAndMismatchedRevisionAndCanBeWithdrawn() {
    let log = SessionLog("goal-claim-binding.log")
    let goal = GoalService(log).create("目标")
    let claim = GoalClaim(log)
    @Expect(claim.record(goal.id, goal.revision), false)
    let scheduler = GoalScheduler(log, { => Int64(0) })
    scheduler.beginRound()
    @Expect(claim.record("other", goal.revision), false)
    @Expect(claim.record(goal.id, goal.revision + 1), false)
    @Expect(claim.record(goal.id, goal.revision), true)
    let round = scheduler.roundsAdmitted()
    @Expect(claim.claimedFor(goal.revision, round), true)
    @Expect(claim.claimedFor(goal.revision, round + 1), false)
    @Expect(claim.recordStatus(goal.id, goal.revision, "in_progress"), true)
    @Expect(claim.claimedFor(goal.revision, round), false)
    scheduler.endRound(true)
    @Expect(claim.record(goal.id, goal.revision), false)
}

@Test
func goalRunnerConsumesLoggedClaimWithSameRoundEvidence() {
    let log = SessionLog("goal-claim-runner.log")
    let service = GoalService(log)
    service.create("完成待办")
    let scheduler = GoalScheduler(log, { => Int64(0) })
    let first = { => RunnerChunks([
        Chunk("tool-call-delta", "{\"todos\":[{\"content\":\"完成步骤\",\"status\":\"completed\"}]}", "",
            toolIndex: Some(0), toolId: Some("todo"), toolName: Some("todo_write")),
        Chunk("tool-call-delta", "{\"goal_id\":\"goal-1\",\"status\":\"completed\"}", "",
            toolIndex: Some(1), toolId: Some("claim"), toolName: Some("update_goal")),
        Chunk("finish", "", "tool_calls")]) }
    let result = GoalRunner().run(first, { _ => stopTurn() }, "fixture-model", TurnToken(), log,
        DeliveryQueue(32), false, scheduler, service, 2, 100000, 0, { => false }, { => false })
    @Expect(result.stopReason, "completed")
    @Expect(service.snapshot().phase, "complete")
    @Expect(result.rounds, Int64(1))
}

@Test
func goalRunnerClaimWithoutMechanicalEvidenceDoesNotComplete() {
    let log = SessionLog("goal-claim-only.log")
    let service = GoalService(log)
    service.create("没有副作用证据")
    let scheduler = GoalScheduler(log, { => Int64(0) })
    let first = { => RunnerChunks([
        Chunk("tool-call-delta", "{\"goal_id\":\"goal-1\",\"status\":\"completed\"}", "",
            toolIndex: Some(0), toolId: Some("claim-only"), toolName: Some("update_goal")),
        Chunk("finish", "", "tool_calls")]) }
    let result = GoalRunner().run(first, { _ => stopTurn() }, "fixture-model", TurnToken(), log,
        DeliveryQueue(32), false, scheduler, service, 1, 100000, 0, { => false }, { => false })
    @Expect(result.stopReason == "completed", false)
    @Expect(service.snapshot().phase == "complete", false)
}