package host
import core.*
import std.time.*

// 持续目标在 Host 上的执行入口：一次 Task 把 GoalRunner 接到真实模型循环。
// 空闲边（goal/create、goal/resume、turn/poll 结算）与显式 task/start 共用本入口。
// 授权走进程内 GoalActivation：重启/切会话后必须是 disarmed，不能只看 durable phase。
class HostGoalRun {
    let log: SessionLog
    let checkpoint: GoalCheckpoint
    let meter: GoalUsageMeter
    let activation: GoalActivation

    public init(log: SessionLog, lease: WriteLease, budget: Int64, activation: GoalActivation) {
        this.log = log
        this.checkpoint = GoalCheckpoint(log, lease)
        this.meter = GoalUsageMeter(log, budget)
        this.activation = activation
    }

    func start(first: () -> Provider, next: (String) -> Provider, model: String, token: TurnToken,
        sink: FrameSink, tools: ModelToolRuntime, attachments: AttachmentStore, images: Bool): TurnHandle {
        let clockBase = MonoTime.now()
        let auth = activation
        return GoalRunner().start(first, next, model, token, log, sink,
            GoalScheduler(log, { => (MonoTime.now() - clockBase).toSeconds() }), GoalService(log),
            GOAL_MAX_ROUNDS, GOAL_MAX_ELAPSED, GOAL_NO_PROGRESS_LIMIT, { => checkpoint.checkpoint() },
            { => meter.over() },
            toolRuntime: Some(tools), attach: Some(attachments), supportsImages: images,
            settleRound: { result => meter.settle(result) },
            armed: { => auth.isArmed() },
            onHold: { => auth.disarm() })
    }
}
