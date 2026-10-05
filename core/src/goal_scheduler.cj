package core

import std.time.MonoTime
import std.convert.*

// 持续目标调度器：把「一轮模型工具循环结束 → 是否已达目标 → 未达且允许就续下一轮」
// 的决策收进共享核心，桌面与 CLI 共用同一份判据，前端只展示与提交控制、不决定目标是否完成。
//
// 三条口径与上游 goal 契约、agent-loop 的 roundsStarted/maxGoalRounds 对齐：
//   1. 轮次与执行时长只从会话日志的 `goal/round`（log-only）事件重算——崩溃恢复与内存读数同源；
//   2. `decide` 是纯读，不落任何事件：暂停/删除只影响「下一轮要不要开」，不强杀当前轮次；
//   3. 完成必须有证据，且基于陈旧修订的完成被拒（复用 GoalService 的 CAS），旧目标的结论完成不了新目标。
//
// 执行时长按「每轮各自落一条自身时长」累加，而不是存原始时钟读数：单调钟跨进程不可比，
// 但差值（本轮跑了多久）可跨重启求和。暂停与审批等待天然不计——只有真正结束的轮次才落事件。

// 一轮的调度结论：要不要继续，以及停下时为什么。
public class GoalDecision {
    public let run: Bool
    public let reason: String // run=true 时为空串；否则是停止理由
    public init(run: Bool, reason: String) {
        this.run = run
        this.reason = reason
    }
}

// 默认时钟：真实单调秒（同 approval.cj 的接缝），没人推进就原地不动。
func goalMonotonicSeconds(): () -> Int64 {
    let base = MonoTime.now()
    return { => (MonoTime.now() - base).toSeconds() }
}

public class GoalScheduler {
    let log: SessionLog
    let clock: () -> Int64
    // 当前这轮的起始刻度；-1 表示没有进行中的轮次。
    var roundStart: Int64 = -1

    public init(log: SessionLog, clock: () -> Int64) {
        this.log = log
        this.clock = clock
    }

    // 轮次事件载荷：`<本轮时长秒>|<是否有进展 1/0>`
    private static func roundData(elapsed: Int64, progressed: Bool): String {
        let flag = if (progressed) { "1" } else { "0" }
        return "${elapsed}|${flag}"
    }

    public func beginRound(): Unit {
        roundStart = clock()
    }

    // 收束一轮：没有 beginRound 就拒（不谎记一轮），非正时长也拒。
    public func endRound(progressed: Bool): Unit {
        if (roundStart < 0) {
            throw Exception("goal-round-not-started")
        }
        let elapsed = clock() - roundStart
        if (elapsed < 0) {
            throw Exception("bad-goal-round")
        }
        log.append("goal/round", GoalScheduler.roundData(elapsed, progressed))
        roundStart = -1
    }

    // 已完成轮次 = goal/round 事件条数。普通循环直扫，不用会捕获可变局部变量的闭包。
    public func roundsDone(): Int64 {
        var n = Int64(0)
        for (ev in log.snapshotEvents()) {
            if (ev.eventType == "goal/round") {
                n += 1
            }
        }
        return n
    }

    // 累计执行时长 = 各轮自身时长之和。
    public func elapsedSeconds(): Int64 {
        var sum = Int64(0)
        for (ev in log.snapshotEvents()) {
            if (ev.eventType != "goal/round") {
                continue
            }
            let fields = ev.data.split("|")
            if (fields.size < 2) {
                continue
            }
            sum += Int64.parse(fields[0])
        }
        return sum
    }

    // 从最后一条往前顺序扫，连续「无进展」的轮数；一旦有进展即清零（防无限空转的判据）。
    public func noProgressStreak(): Int64 {
        var streak = Int64(0)
        for (ev in log.snapshotEvents()) {
            if (ev.eventType != "goal/round") {
                continue
            }
            let fields = ev.data.split("|")
            if (fields.size < 2) {
                continue
            }
            if (fields[1] == "1") {
                streak = Int64(0)
            } else {
                streak += 1
            }
        }
        return streak
    }

    // 纯读决策：不落事件。命中任一停止条件即停，理由互斥且有序。
    public func decide(
        phase: String,
        maxRounds: Int64,
        maxElapsed: Int64,
        noProgressLimit: Int64,
        budgetExceeded: Bool
    ): GoalDecision {
        if (phase != "active") {
            let why = if (phase == "paused") {
                "paused"
            } else if (phase == "blocked") {
                "blocked"
            } else if (phase == "complete") {
                "complete"
            } else {
                "no-goal"
            }
            return GoalDecision(false, why)
        }
        if (budgetExceeded) {
            return GoalDecision(false, "budget")
        }
        if (roundsDone() >= maxRounds) {
            return GoalDecision(false, "round-limit")
        }
        if (elapsedSeconds() >= maxElapsed) {
            return GoalDecision(false, "elapsed-limit")
        }
        if (noProgressLimit > 0 && noProgressStreak() >= noProgressLimit) {
            return GoalDecision(false, "no-progress")
        }
        return GoalDecision(true, "")
    }

    // 把一轮的停止决策落到目标状态：限额类停止（预算/轮数/时长/无进展）经 GoalService.block
    // 落阻塞原因，需用户放宽或恢复才继续——防「目标没完成却无限空转」。run=true 或非限额
    // 的停止理由（paused/complete/blocked/no-goal 这些不是限额触发）都不动目标：幂等、不空写事件。
    public func applyStop(svc: GoalService, revision: Int64, decision: GoalDecision): Unit {
        if (decision.run) {
            return
        }
        let reason = decision.reason
        if (reason == "budget" || reason == "round-limit" || reason == "elapsed-limit" || reason == "no-progress") {
            svc.block(revision, "goal-${reason}")
        }
    }

    // 证据完成闸：无证据不收口（返回 false，目标照旧 active）；有证据才经 CAS 收口，
    // 陈旧修订会由 GoalService.complete 抛 stale-goal-revision 向上传播——旧目标完成不了新目标。
    public func completeIfEvidenced(
        svc: GoalService,
        basedOnRevision: Int64,
        evidence: Bool
    ): Bool {
        if (!evidence) {
            return false
        }
        svc.complete(basedOnRevision)
        return true
    }
}

// 一轮模型工具循环的产物：本轮是否有实质进展（喂给 no-progress 判据）、
// 模型是否提出了带证据的完成候选（喂给完成闸）。
public class RoundOutcome {
    public let progressed: Bool
    public let evidence: Bool
    public init(progressed: Bool, evidence: Bool) {
        this.progressed = progressed
        this.evidence = evidence
    }
}

// 驱动结果：实际跑了多少轮，以及因何停下——completed / paused / blocked / no-goal /
// round-limit / elapsed-limit / no-progress / budget。
public class DriveResult {
    public let rounds: Int64
    public let stopReason: String
    public init(rounds: Int64, stopReason: String) {
        this.rounds = rounds
        this.stopReason = stopReason
    }
}

// 跨轮持续执行驱动：把「一轮结束 → 目标没达成且允许继续就启动下一轮」这件事收进核心。
//
// 关键口径——只在轮次边界重读目标状态，所以暂停/编辑/删除对「下一轮要不要开」生效，
// 绝不打断当前轮次（runRound 一旦启动就跑到收束）。完成必须有证据；限额停止经 applyStop
// 落成阻塞，防「目标没完成却无限空转」。真实执行里 runRound 就是跑一次模型工具循环
// （并在其中于步骤边界送达 inbox），驱动本身不认识 inbox，也不碰模型请求的构造。
public class GoalDriver {
    let scheduler: GoalScheduler
    let svc: GoalService

    public init(scheduler: GoalScheduler, svc: GoalService) {
        this.scheduler = scheduler
        this.svc = svc
    }

    public func run(maxRounds: Int64, maxElapsed: Int64, noProgressLimit: Int64,
        budgetExceeded: () -> Bool, runRound: () -> RoundOutcome): DriveResult {
        var rounds = Int64(0)
        var stopReason = ""
        var done = false
        // 用显式 done 标志收束循环而不是 while(true)+多处 return：仓颉不把 while(true)
        // 当作发散，函数体尾表达式若是循环就报 Unit 与 DriveResult 类型不符。
        while (!done) {
            // 边界重读：上一轮收束后用户可能已暂停/编辑/删除——下一轮据此决定。
            let snap = svc.snapshot()
            let decision = scheduler.decide(snap.phase, maxRounds, maxElapsed, noProgressLimit, budgetExceeded())
            if (!decision.run) {
                scheduler.applyStop(svc, snap.revision, decision)
                stopReason = decision.reason
                done = true
            } else {
                scheduler.beginRound()
                let outcome = runRound()
                scheduler.endRound(outcome.progressed)
                rounds += Int64(1)
                if (outcome.evidence) {
                    // 有证据才收口，基于边界重读后的当前修订做 CAS。
                    let current = svc.snapshot()
                    if (scheduler.completeIfEvidenced(svc, current.revision, true)) {
                        stopReason = "completed"
                        done = true
                    }
                }
            }
        }
        return DriveResult(rounds, stopReason)
    }
}
