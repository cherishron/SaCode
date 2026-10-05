package core
import std.fs.*
import std.unittest.*

// 持续目标调度器上游契约（goal 313 行 + agent-loop 的 roundsStarted/maxGoalRounds/
// activation-changed）：把「一轮模型工具循环结束 → 是否已达目标 → 未达且允许就续下一轮」
// 这件事从前端手里收到核心。三条硬约束：
//   1. 执行时长与轮次只从会话日志的 `goal/round`（log-only）事件重算——崩溃恢复同源；
//   2. 暂停/删除等只影响「下一轮要不要开」，不强杀当前轮次（decide 是纯读，不落事件）；
//   3. 完成必须有证据，且旧目标修订不能完成新目标（CAS）。
// 时钟可注入（同 approval.cj 的 monotonicSeconds 接缝），测试用假钟推进，没人 tick 就不走。

// 假时钟：一个可被测试显式推进的刻度。放在测试文件里，绝不进生产核心。
class FakeClock {
    var t: Int64 = 0
    func now(): Int64 { return t }
    func advance(n: Int64): Unit { t += n }
}

// 建一个带 goal/change 活动目标的会话日志，返回 (root, log, svc)。
func activeGoal(): (String, SessionLog, GoalService) {
    let root = "core-gsched-active"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let svc = GoalService(log)
    svc.create("持续推进直到验收")
    return (root, log, svc)
}

// 轮次记账：一轮跑了 3 秒，roundsDone/elapsedSeconds 各读到什么。
@Test
func schedulerRoundAccountsElapsedAndRounds() {
    let (root, log, svc) = activeGoal()
    let fc = FakeClock()
    let s = GoalScheduler(log, { => fc.now() })
    s.beginRound()
    fc.advance(3)
    s.endRound(true)
    @Expect(s.roundsDone(), Int64(1))
    @Expect(s.elapsedSeconds(), Int64(3))
    // goal/round 是 log-only：模型历史仍只看到那一条 user/message（这里 create 只落 goal/change）。
    @Expect(log.deriveMessages().size, Int64(0))
    removeIfExists(root, recursive: true)
}

// 多轮求和：+2 与 +5 两轮，累计 7、轮次 2。
@Test
func schedulerSumRoundsAcrossMultiple() {
    let (root, log, svc) = activeGoal()
    let fc = FakeClock()
    let s = GoalScheduler(log, { => fc.now() })
    s.beginRound(); fc.advance(2); s.endRound(true)
    s.beginRound(); fc.advance(5); s.endRound(true)
    @Expect(s.roundsDone(), Int64(2))
    @Expect(s.elapsedSeconds(), Int64(7))
    removeIfExists(root, recursive: true)
}

// 崩溃恢复：flush→新 SessionLog load→新调度器，轮次与时长从日志原样重算。
@Test
func schedulerReplayFromLogAfterFlush() {
    let root = "core-gsched-replay"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let svc = GoalService(log)
    svc.create("目标")
    let fc = FakeClock()
    let s = GoalScheduler(log, { => fc.now() })
    s.beginRound(); fc.advance(4); s.endRound(true)
    s.beginRound(); fc.advance(6); s.endRound(false)
    @Expect(log.flush(), true)
    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    let replay = GoalScheduler(fresh, { => fc.now() })
    @Expect(replay.roundsDone(), Int64(2))
    @Expect(replay.elapsedSeconds(), Int64(10))
    removeIfExists(root, recursive: true)
}

// endRound 之前没有 beginRound：拒，且不落事件。
@Test
func schedulerEndRoundWithoutBeginThrows() {
    let (root, log, svc) = activeGoal()
    let fc = FakeClock()
    let s = GoalScheduler(log, { => fc.now() })
    let before = log.eventCount()
    var threw = ""
    try {
        s.endRound(true)
    } catch (e: Exception) {
        threw = e.message
    }
    @Expect(threw, "goal-round-not-started")
    @Expect(log.eventCount(), before)
    @Expect(s.roundsDone(), Int64(0))
    removeIfExists(root, recursive: true)
}

// 决策：活动目标、在限内 → 继续跑。
@Test
func decideRunsWhenActiveWithinLimits() {
    let (root, log, svc) = activeGoal()
    let fc = FakeClock()
    let s = GoalScheduler(log, { => fc.now() })
    let d = s.decide("active", Int64(5), Int64(100), Int64(3), false)
    @Expect(d.run, true)
    @Expect(d.reason, "")
    removeIfExists(root, recursive: true)
}

// 决策：暂停 → 停，理由 paused。
@Test
func decideStopsWhenPaused() {
    let (root, log, svc) = activeGoal()
    let fc = FakeClock()
    let s = GoalScheduler(log, { => fc.now() })
    let d = s.decide("paused", Int64(5), Int64(100), Int64(3), false)
    @Expect(d.run, false)
    @Expect(d.reason, "paused")
    removeIfExists(root, recursive: true)
}

// 决策：none（删除/无目标）→ 停，理由 no-goal。
@Test
func decideStopsWhenNoGoal() {
    let (root, log, svc) = activeGoal()
    let fc = FakeClock()
    let s = GoalScheduler(log, { => fc.now() })
    @Expect(s.decide("none", Int64(5), Int64(100), Int64(3), false).reason, "no-goal")
    @Expect(s.decide("blocked", Int64(5), Int64(100), Int64(3), false).reason, "blocked")
    @Expect(s.decide("complete", Int64(5), Int64(100), Int64(3), false).reason, "complete")
    removeIfExists(root, recursive: true)
}

// 决策：轮数用尽 → round-limit。跑满 maxRounds 后触发。
@Test
func decideStopsOnRoundLimit() {
    let (root, log, svc) = activeGoal()
    let fc = FakeClock()
    let s = GoalScheduler(log, { => fc.now() })
    s.beginRound(); fc.advance(1); s.endRound(true)
    s.beginRound(); fc.advance(1); s.endRound(true)
    @Expect(s.decide("active", Int64(2), Int64(1000), Int64(3), false).reason, "round-limit")
    // 还差一轮没满 → 继续。
    @Expect(s.decide("active", Int64(3), Int64(1000), Int64(3), false).run, true)
    removeIfExists(root, recursive: true)
}

// 决策：执行时长越界 → elapsed-limit。
@Test
func decideStopsOnElapsedLimit() {
    let (root, log, svc) = activeGoal()
    let fc = FakeClock()
    let s = GoalScheduler(log, { => fc.now() })
    s.beginRound(); fc.advance(50); s.endRound(true)
    @Expect(s.decide("active", Int64(100), Int64(50), Int64(3), false).reason, "elapsed-limit")
    removeIfExists(root, recursive: true)
}

// 决策：外部预算超限信号优先于「还能不能跑」→ budget。
@Test
func decideStopsOnBudget() {
    let (root, log, svc) = activeGoal()
    let fc = FakeClock()
    let s = GoalScheduler(log, { => fc.now() })
    @Expect(s.decide("active", Int64(100), Int64(1000), Int64(3), true).reason, "budget")
    removeIfExists(root, recursive: true)
}

// 无进展空转：连续 N 轮没进展 → no-progress；中途有进展重置连击。
@Test
func decideDetectsNoProgressStreak() {
    let (root, log, svc) = activeGoal()
    let fc = FakeClock()
    let s = GoalScheduler(log, { => fc.now() })
    s.beginRound(); fc.advance(1); s.endRound(false)
    s.beginRound(); fc.advance(1); s.endRound(false)
    @Expect(s.noProgressStreak(), Int64(2))
    @Expect(s.decide("active", Int64(100), Int64(1000), Int64(2), false).reason, "no-progress")
    // 有进展的一轮把连击清零。
    s.beginRound(); fc.advance(1); s.endRound(true)
    @Expect(s.noProgressStreak(), Int64(0))
    @Expect(s.decide("active", Int64(100), Int64(1000), Int64(2), false).run, true)
    removeIfExists(root, recursive: true)
}

// 完成闸：没有证据 → 不收口，目标仍 active，返回 false。
@Test
func completeRequiresEvidence() {
    let (root, log, svc) = activeGoal()
    let fc = FakeClock()
    let s = GoalScheduler(log, { => fc.now() })
    let g = svc.snapshot()
    let done = s.completeIfEvidenced(svc, g.revision, false)
    @Expect(done, false)
    @Expect(svc.snapshot().phase, "active")
    removeIfExists(root, recursive: true)
}

// 完成闸：有证据 → 收口，phase complete。
@Test
func completeWithEvidenceTransitions() {
    let (root, log, svc) = activeGoal()
    let fc = FakeClock()
    let s = GoalScheduler(log, { => fc.now() })
    let g = svc.snapshot()
    @Expect(s.completeIfEvidenced(svc, g.revision, true), true)
    @Expect(svc.snapshot().phase, "complete")
    removeIfExists(root, recursive: true)
}

// 完成闸：旧轮次基于的修订已被编辑更新 → 陈旧完成被拒，不改新目标。
@Test
func completeStaleRevisionRejected() {
    let (root, log, svc) = activeGoal()
    let fc = FakeClock()
    let s = GoalScheduler(log, { => fc.now() })
    let old = svc.snapshot() // revision=1
    svc.edit(old.revision, "改写目标") // revision=2
    var threw = ""
    var done = false
    try {
        done = s.completeIfEvidenced(svc, old.revision, true)
    } catch (e: Exception) {
        threw = e.message
    }
    @Expect(threw, "stale-goal-revision")
    @Expect(done, false)
    @Expect(svc.snapshot().phase, "active")
    removeIfExists(root, recursive: true)
}
