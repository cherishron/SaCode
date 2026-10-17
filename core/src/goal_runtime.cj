package core

// 目标所有发布点共用真正的写权与持久屏障；失败冻结，绝不回退普通 flush。
public class GoalCheckpoint {
    let log: SessionLog
    let lease: WriteLease
    public init(log: SessionLog, lease: WriteLease) { this.log = log; this.lease = lease }
    public func checkpoint(): Bool {
        let saved = log.durableCheckpointBatched(lease)
        if (!saved) { log.freezeAfterDurableFailure() }
        return saved
    }
}

// 每次边界重放唯一日志账本，保留主线程收紧预算及历史拒绝事实。
public class GoalUsageMeter {
    let log: SessionLog
    let budget: Int64
    public init(log: SessionLog, budget: Int64) { this.log = log; this.budget = budget }
    public func over(): Bool {
        return synchronized(log.mtx) {
            let meter = TokenMeter(log, budget: budget)
            meter.rebuild()
            meter.over()
        }
    }
    public func settle(result: TurnResult): String {
        return synchronized(log.mtx) {
            let meter = TokenMeter(log, budget: budget)
            meter.rebuild()
            meter.settleTurn(result)
        }
    }
}
