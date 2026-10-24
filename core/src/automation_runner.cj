package core

// F13-E 执行接缝（对齐 design §4.6）：调度侧在“已持久准入”之后，把触发交给该接缝，
// 由执行方创建独立会话/运行上下文并返回稳定 runId。本接口是**编译期有限接缝**，
// 不是用户可提交的回调；实现方负责真实执行、审批、取消与结算，并复用共享核心链
// （模型工具、执行监督、用量结算），不复制第二套执行器。缺实现时一律 fail-closed。
public interface AutomationRunDispatcher {
    // 接收一条已持久准入的触发（triggerKey 已落盘），启动独立运行并返回 runId。
    // 无法启动时返回 None——绝不允许伪造成功。definitionDigest 供执行方核对定义快照。
    func dispatch(triggerKey: String, taskId: String, definitionDigest: String): ?String
}

// 触发编排：把 design §4.3 的顺序固化在一处，避免调用方各写一遍而漏掉屏障：
//   ① 执行器不可用 → 直接报告 unavailable，**不写准入事实**（无主 unknown 不累积）；
//   ② 持久准入（幂等/overlap-skip 由 AutomationTriggerLog 负责）；
//   ③ 派发；派发失败 → settle unknown（不重发）；
//   ④ 成功 → markDispatched 登记 runRef。
public class AutomationRunCoordinator {
    let log: AutomationTriggerLog
    let dispatcher: ?AutomationRunDispatcher
    public init(log: AutomationTriggerLog, dispatcher!: ?AutomationRunDispatcher = None) {
        this.log = log; this.dispatcher = dispatcher
    }
    public func available(): Bool { return dispatcher.isSome() }
    // 返回状态串：automation-executor-unavailable | duplicate-trigger | overlap-skip |
    //             dispatched | unknown | <其它已准入/已结算态>。
    public func trigger(intent: AutomationTriggerIntent, definitionDigest: String): String {
        if (dispatcher.isNone()) { return "automation-executor-unavailable" }
        let admission = log.admit(intent)
        if (!admission.admitted) { return admission.state }
        let runRef = dispatcher.getOrThrow().dispatch(intent.triggerKey, intent.taskId, definitionDigest)
        if (runRef.isNone()) {
            // 已准入但执行器拒绝/未能启动：留 unknown 屏障，禁止自动重发。
            log.settle(intent.triggerKey, "unknown", "automation-run-unavailable")
            return "unknown"
        }
        log.markDispatched(intent.triggerKey, runRef.getOrThrow())
        return "dispatched"
    }
    public func statusOf(triggerKey: String): String { return log.statusOf(triggerKey) }
}