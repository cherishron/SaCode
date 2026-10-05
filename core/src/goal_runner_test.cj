package core
import std.fs.*
import std.unittest.*

// 把 GoalDriver 接进真实模型工具循环（GoalRunner）：一轮 = 一次 ModelAgentLoop.run。
// 钉的是基线点名的缺口——「目标不完成就连续启动下一轮」真正落到执行，而不只是纯函数决策。
// 三条反证：连续跑多轮直到有证据才收口；从无证据则撞轮数上限落阻塞；目标非 active 时
// 一轮都不开（runRound/makeFirst 一次都不被调用）。

// 一次性 provider：喂固定的 chunk 序列（同 model_agent_test 的 AgentChunks 形态，本文件自带一份
// 以免跨测试文件耦合）。
class RunnerChunks <: Provider & Resource {
    let chunks: Array<Chunk>
    var index = Int64(0)
    public var closes = Int64(0)
    public init(chunks: Array<Chunk>) {
        this.chunks = chunks
    }
    public func next(): Option<Chunk> {
        if (index >= chunks.size) {
            return None
        }
        let value = chunks[index]
        index += 1
        return Some(value)
    }
    public func close(): Unit {
        closes += 1
    }
    public func isClosed(): Bool {
        return closes > 0
    }
}

// 每轮计数：闭包只捕获这个 let 绑定的可变对象（避开捕获 var 的编译器限制）。
class RoundTick {
    var n: Int64 = 0
    func bump(): Unit {
        n += 1
    }
}

// 一个「跑一次工具再收尾」的 turn：first 发 tool_calls，next 发 stop——干净结算一个 todo，
// settledToolCalls=1 才算本轮有真实进展。
func toolTurnFirst(id: String): RunnerChunks {
    return RunnerChunks([
        Chunk("tool-call-delta", "{\"todos\":[{\"content\":\"干活\",\"status\":\"in_progress\"}]}", "", toolIndex: Some(0), toolId: Some(id), toolName: Some("todo_write")),
        Chunk("finish", "", "tool_calls")])
}

func stopTurn(): RunnerChunks {
    return RunnerChunks([Chunk("text", "完成", ""), Chunk("finish", "", "stop")])
}

// 连续多轮：第 2 轮起给出证据 → 经 CAS 收口，跑了 2 轮、落 2 条 goal/round。
@Test
func goalRunnerRunsModelTurnsAcrossRoundsUntilEvidence() {
    let root = "core-grunner-run"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    log.append("user/message", "开工")
    let svc = GoalService(log)
    svc.create("持续跑到有证据")
    let sched = GoalScheduler(log, { => Int64(0) })
    let tick = RoundTick()
    let r = GoalRunner().run(
        { => tick.bump(); toolTurnFirst("c-${tick.n}") },
        { _ => stopTurn() },
        "test-model", TurnToken(), log, DeliveryQueue(32), false,
        sched, svc,
        Int64(10), Int64(100000), Int64(0),
        { => false },
        { _ => tick.n >= Int64(2) })
    @Expect(r.stopReason, "completed")
    @Expect(r.rounds, Int64(2))
    @Expect(tick.n, Int64(2))
    @Expect(svc.snapshot().phase, "complete")
    @Expect(sched.roundsDone(), Int64(2))
    removeIfExists(root, recursive: true)
}

// 从无证据：跑满 maxRounds 后撞轮数上限，经 applyStop 落 goal-round-limit 阻塞，不无限空转。
@Test
func goalRunnerBlocksOnRoundLimitWithoutEvidence() {
    let root = "core-grunner-limit"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    log.append("user/message", "开工")
    let svc = GoalService(log)
    svc.create("永远拿不到证据")
    let sched = GoalScheduler(log, { => Int64(0) })
    let tick = RoundTick()
    let r = GoalRunner().run(
        { => tick.bump(); toolTurnFirst("d-${tick.n}") },
        { _ => stopTurn() },
        "test-model", TurnToken(), log, DeliveryQueue(32), false,
        sched, svc,
        Int64(2), Int64(100000), Int64(0),
        { => false },
        { _ => false })
    @Expect(r.stopReason, "round-limit")
    @Expect(r.rounds, Int64(2))
    @Expect(tick.n, Int64(2))
    @Expect(svc.snapshot().phase, "blocked")
    @Expect(svc.snapshot().blockedReason, "goal-round-limit")
    removeIfExists(root, recursive: true)
}

// 目标非 active（已暂停）：驱动一轮都不开——runRound 与 makeFirst 均不被调用。
@Test
func goalRunnerDoesNotRunWhenGoalNotActive() {
    let root = "core-grunner-paused"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    log.append("user/message", "开工")
    let svc = GoalService(log)
    let g = svc.create("开了就暂停")
    svc.pause(g.revision)
    let sched = GoalScheduler(log, { => Int64(0) })
    let tick = RoundTick()
    let r = GoalRunner().run(
        { => tick.bump(); toolTurnFirst("e-${tick.n}") },
        { _ => stopTurn() },
        "test-model", TurnToken(), log, DeliveryQueue(32), false,
        sched, svc,
        Int64(10), Int64(100000), Int64(0),
        { => false },
        { _ => true })
    @Expect(r.rounds, Int64(0))
    @Expect(r.stopReason, "paused")
    @Expect(tick.n, Int64(0))
    @Expect(svc.snapshot().phase, "paused")
    removeIfExists(root, recursive: true)
}

// 自驱动多轮的送达：runner 每开一轮是一次新 turn，必须在「本轮请求构造前」把排队的
// next-turn 补充送达成真实 user/message（消费一次即清队列，宿主另 claim 也不重复）。
@Test
func goalRunnerDeliversQueuedTurnMessageAtRoundBoundary() {
    let root = "core-grunner-deliver"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    log.append("user/message", "开工")
    let svc = GoalService(log)
    svc.create("途中补充要在边界送达")
    // 跑起来之前排一条 next-turn 补充
    let inbox = AgentInbox(log)
    inbox.queue("t1", "queued-turn-note", "rpc-1")
    @Expect(inbox.sizeOf("next-turn"), Int64(1))
    let sched = GoalScheduler(log, { => Int64(0) })
    let tick = RoundTick()
    let r = GoalRunner().run(
        { => tick.bump(); toolTurnFirst("g-${tick.n}") },
        { _ => stopTurn() },
        "test-model", TurnToken(), log, DeliveryQueue(32), false,
        sched, svc,
        Int64(10), Int64(100000), Int64(0),
        { => false },
        { _ => tick.n >= Int64(2) })
    @Expect(r.stopReason, "completed")
    @Expect(r.rounds, Int64(2))
    // 边界送达后队列清空，且那条补充落成恰好一条真实 user/message（第 2 轮 claimTurn 已空）
    let after = AgentInbox(log)
    @Expect(after.sizeOf("next-turn"), Int64(0))
    var seen = Int64(0)
    for (m in log.deriveMessages()) {
        if (m == "user/message: queued-turn-note") {
            seen += Int64(1)
        }
    }
    @Expect(seen, Int64(1))
    removeIfExists(root, recursive: true)
}
