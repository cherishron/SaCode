package core
import std.fs.*
import std.unittest.*
import std.sync.*
import std.collection.*

@Test
func goalConcurrentCasAllowsExactlyOneWinner() {
    let path = "core-goal-atomic.log"
    removeIfExists(path, recursive: false)
    let log = SessionLog(path)
    GoalService(log).create("初版")
    let gate = SyncCounter(16)
    let results = ArrayList<Future<Int64>>()
    for (_ in 0..16) {
        results.add(spawn { =>
            gate.dec(); gate.waitUntilZero()
            try { GoalService(log).edit(1, "新版"); Int64(1) }
            catch (e: Exception) { if (e.message != "stale-goal-revision") { throw e }; Int64(0) }
        })
    }
    var wins = Int64(0)
    for (result in results) { wins += result.get() }
    @Expect(wins, Int64(1))
    @Expect(log.eventCount(), Int64(2))
    @Expect(GoalService(log).snapshot().revision, Int64(2))
    removeIfExists(path, recursive: false)
}

@Test
func goalControlRejectsCompletionAndEmptyObjectiveWithoutEvents() {
    let log = SessionLog("core-goal-control.log")
    var action = ""
    try { controlGoalJson(log, "goal/complete", 0, ""); action = "accepted" }
    catch (e: Exception) { action = e.message }
    @Expect(action, "unknown-goal-action")
    var blank = ""
    try { controlGoalJson(log, "goal/create", 0, " \n "); blank = "accepted" }
    catch (e: Exception) { blank = e.message }
    @Expect(blank, "bad-goal-objective")
    @Expect(log.eventCount(), Int64(0))
}

@Test
func goalNewObjectiveStartsFreshAccountingAndReplayKeepsIt() {
    let path = "core-goal-metrics.log"
    removeIfExists(path, recursive: false)
    let log = SessionLog(path)
    let svc = GoalService(log)
    let fc = FakeClock()
    let scheduler = GoalScheduler(log, { => fc.now() })
    svc.create("上一目标")
    scheduler.beginRound(); fc.advance(8); scheduler.endRound(false)
    svc.complete(svc.snapshot().revision)
    svc.create("新目标")
    @Expect(scheduler.roundsDone(), Int64(0))
    @Expect(scheduler.elapsedSeconds(), Int64(0))
    @Expect(scheduler.noProgressStreak(), Int64(0))
    scheduler.beginRound(); fc.advance(2); scheduler.endRound(true)
    svc.edit(svc.snapshot().revision, "新目标修订")
    svc.pause(svc.snapshot().revision); svc.resume(svc.snapshot().revision)
    @Expect(scheduler.roundsDone(), Int64(1))
    @Expect(scheduler.elapsedSeconds(), Int64(2))
    @Expect(log.flush(), true)
    let replay = SessionLog(path)
    @Expect(replay.load(), true)
    @Expect(GoalScheduler(replay, { => fc.now() }).elapsedSeconds(), Int64(2))
    removeIfExists(path, recursive: false)
}

@Test
func goalReplacedMidRoundDoesNotInheritOldRoundSettlement() {
    let log = SessionLog("core-goal-replacement.log")
    let svc = GoalService(log)
    let fc = FakeClock()
    let scheduler = GoalScheduler(log, { => fc.now() })
    svc.create("旧目标"); scheduler.beginRound(); fc.advance(3)
    svc.clear(svc.snapshot().revision); svc.create("替代目标")
    scheduler.endRound(true)
    @Expect(scheduler.roundsDone(), Int64(0))
    @Expect(scheduler.elapsedSeconds(), Int64(0))
}

@Test
func goalResumeAtRoundLimitStaysBlockedAndDisarmed() {
    let path = "core-goal-resume-cap.log"
    removeIfExists(path, recursive: false)
    let log = SessionLog(path)
    let activation = GoalActivation()
    _ = controlGoalJson(log, "goal/create", Int64(0), "满额不可绕过", activation: activation)
    let s = GoalScheduler(log, { => Int64(0) })
    var i = Int64(0)
    while (i < GOAL_MAX_ROUNDS) {
        s.beginRound()
        i += 1
    }
    let resumed = controlGoalJson(log, "goal/resume", GoalService(log).snapshot().revision, "", activation: activation)
    @Expect(resumed.contains("\"phase\":\"blocked\""), true)
    @Expect(resumed.contains("\"blockedReason\":\"goal-round-limit\""), true)
    @Expect(resumed.contains("\"activation\":\"disarmed\""), true)
    @Expect(activation.isArmed(), false)
    @Expect(GoalScheduler(log, { => Int64(0) }).roundsAdmitted(), GOAL_MAX_ROUNDS)
    removeIfExists(path, recursive: false)
}

@Test
func goalProjectionReportsPendingTurnCountWithoutClaiming() {
    let path = "core-goal-pending-turn.log"
    removeIfExists(path, recursive: false)
    let log = SessionLog(path)
    GoalService(log).create("补充仍待处理")
    AgentInbox(log).queue("p1", "还没轮到的补充", "rpc-p1")
    let json = goalProjectionJson(log)
    @Expect(json.contains("\"pendingTurnCount\":1"), true)
    @Expect(AgentInbox(log).sizeOf("next-turn"), Int64(1))
    var seen = Int64(0)
    for (m in log.deriveMessages()) {
        if (m == "user/message: 还没轮到的补充") { seen += Int64(1) }
    }
    @Expect(seen, Int64(0))
    removeIfExists(path, recursive: false)
}
