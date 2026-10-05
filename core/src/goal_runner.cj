package core

// 把 GoalDriver 接进真实模型工具循环：一轮 = 一次 ModelAgentLoop.run（整个 turn 的工具
// 循环跑到终态），驱动决定「目标没完成且允许就再跑下一轮」。这正是基线点名的缺口——
// 「目标不完成就继续启动下一轮」的调度真正落到执行，而不只是纯函数决策。
//
// 口径：
//   - progressed：本轮干净地执行了工具调用（有真实副作用、未被打断/取消）才算推进，喂 no-progress 判据；
//   - evidence：完成证据由调用方判定（测试通过 / 产物生成 / 完成工具回执），核心绝不臆造完成；
//   - 暂停 / 删除 / 编辑由调用方经 GoalService 落进会话日志，驱动在「轮次边界」重读，
//     故不强杀当前轮——当前 turn 会跑完，下一轮才据新状态决定是否启动；
//   - budgetExceeded：外部用量 / 停止信号，命中即经 applyStop 落 goal-budget 阻塞。
// 即时补充的送达发生在 ModelAgentLoop 内部的步边界（claimStep），本层不重复实现。
public class GoalRunner {
    public func run(makeFirst: () -> Provider, nextProvider: (String) -> Provider,
        model: String, token: TurnToken, log: SessionLog, sink: FrameSink,
        allowParallel: Bool, scheduler: GoalScheduler, svc: GoalService,
        maxRounds: Int64, maxElapsed: Int64, noProgressLimit: Int64,
        budgetExceeded: () -> Bool, evidence: (TurnResult) -> Bool,
        maxSteps!: Int64 = 16, attach!: ?AttachmentStore = None, supportsImages!: Bool = false): DriveResult {
        let driver = GoalDriver(scheduler, svc)
        return driver.run(maxRounds, maxElapsed, noProgressLimit, budgetExceeded, { =>
            // 轮次边界送达：自驱动的持续目标每开一轮是一次新 turn，须在「本轮请求构造前」
            // 把排队的 next-turn 补充送达成真实 user/message（附件走 commitMessage）。
            // claimTurn 消费一次即从队列删除，宿主若另行 claim 也不会重复送达。
            for (note in AgentInbox(log).claimTurn()) {
                if (note.attachments.size > 0) {
                    if (let Some(store) <- attach) { store.commitMessage(note.text, note.attachments) }
                    else { throw Exception("attachment-store-absent") }
                } else {
                    log.append("user/message", note.text)
                }
            }
            let result = ModelAgentLoop().run(makeFirst(), nextProvider, model, token, log, sink, allowParallel, maxSteps: maxSteps, attach: attach, supportsImages: supportsImages)
            RoundOutcome(result.settledToolCalls > 0 && !result.interrupted && !result.cancelled, evidence(result))
        })
    }
}
