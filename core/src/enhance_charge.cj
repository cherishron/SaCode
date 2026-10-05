package core

// 请求起跑时绑定原会话账本；换会话、下一次请求与关闭窗口都不能丢掉旧回执。
// 只在宿主主线程结算，模型线程不抢写会话。失败/取消的已知用量也进入同一账本。
public class EnhanceCharge {
    public let handle: EnhanceHandle
    let log: SessionLog
    let meter: TokenMeter
    let lease: WriteLease
    public var billed = false
    public var verdict = "absent"
    var recorded = false
    var acquired = false
    public init(handle: EnhanceHandle, log: SessionLog, meter: TokenMeter, lease: WriteLease) {
        this.handle = handle; this.log = log; this.meter = meter; this.lease = lease
    }
    public func settle(): Bool {
        if (billed) { return true }
        let outcome = handle.tryOutcome()
        if (outcome.running) { return false }
        if (outcome.usage.size == 0 && outcome.finishReason.size == 0) { billed = true; return true }
        let owns = lease.ownerToken().size > 0 && lease.currentOwner() == lease.ownerToken()
        if (!owns) {
            if (!lease.takeoverIfStale()) { verdict = "lease-busy"; return false }
            acquired = true
            if (!log.load()) { lease.release(); acquired = false; verdict = "replay-rejected"; return false }
            meter.rebuild()
        }
        if (!recorded) { verdict = meter.record(outcome.usage); recorded = true }
        if (!log.flush()) { verdict = "flush-failed"; return false }
        billed = true
        if (acquired) { lease.release(); acquired = false }
        return true
    }
}
