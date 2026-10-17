package host
import core.*
import std.time.*

// 仅由显式 task/start 创建；恢复日志或展示目标都不构造此运行态。
// 计量器仅由工作线程调用，主线程从日志重建自己的读面，不共享可变计数。
class HostGoalRun {
    let log: SessionLog
    let checkpoint: GoalCheckpoint
    let meter: GoalUsageMeter
    public init(log: SessionLog, lease: WriteLease, budget: Int64) {
        this.log = log
        this.checkpoint = GoalCheckpoint(log, lease)
        this.meter = GoalUsageMeter(log, budget)
    }
    func start(first: () -> Provider, next: (String) -> Provider, model: String,
        token: TurnToken, sink: FrameSink, tools: ModelToolRuntime,
        attachments: AttachmentStore, images: Bool): TurnHandle {
        let clockBase = MonoTime.now()
        return GoalRunner().start(first, next, model, token, log, sink,
            GoalScheduler(log, { => (MonoTime.now() - clockBase).toSeconds() }), GoalService(log),
            Int64(8), Int64(3600), Int64(3), { => checkpoint.checkpoint() },
            { => meter.over() },
            toolRuntime: Some(tools), attach: Some(attachments), supportsImages: images,
            settleRound: { result => meter.settle(result) })
    }
}
