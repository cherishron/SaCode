package core
import stdx.encoding.json.*

// 把 GoalDriver 接进真实模型工具循环：一轮 = 一次 ModelAgentLoop.run（整个 turn 的工具
// 循环跑到终态），驱动决定「目标没完成且允许就再跑下一轮」。这正是基线点名的缺口——
// 「目标不完成就继续启动下一轮」的调度真正落到执行，而不只是纯函数决策。
//
// 口径：
//   - progressed：本轮干净地执行了工具调用（有真实副作用、未被打断/取消）才算推进，喂 no-progress 判据；
//   - 完成证据是**两个条件的合取**：机械侧（本轮确有成功结算的副作用，落成绑定开轮修订的
//     `goal/evidence`）∧ 声明侧（模型显式声明达成，走 claim 闭包注入）。任一单独都不收口；
//     claim 缺席时恒假，完成闸默认关闭——宁可跑到限额落阻塞，也不让工具调用次数充当完成证明；
//   - 暂停 / 删除 / 编辑由调用方经 GoalService 落进会话日志，驱动在「轮次边界」重读，
//     故不强杀当前轮——当前 turn 会跑完，下一轮才据新状态决定是否启动；
//   - 取消则不同：取消的那一轮结算完时长就不再开新轮（cancelled 是停止理由，不是限额）；
//   - budgetExceeded：外部用量 / 停止信号，命中即经 applyStop 落 goal-budget 阻塞。
// 即时补充的送达发生在 ModelAgentLoop 内部的步边界（claimStep），本层不重复实现。
public class GoalRunner {
    public func run(makeFirst: () -> Provider, nextProvider: (String) -> Provider,
        model: String, token: TurnToken, log: SessionLog, sink: FrameSink,
        allowParallel: Bool, scheduler: GoalScheduler, svc: GoalService,
        maxRounds: Int64, maxElapsed: Int64, noProgressLimit: Int64,
        budgetExceeded: () -> Bool, claim: () -> Bool,
        maxSteps!: Int64 = 16, attach!: ?AttachmentStore = None, supportsImages!: Bool = false,
        toolRuntime!: ?ModelToolRuntime = None, armed!: () -> Bool = { => true },
        maxGoalRounds!: Int64 = 0): DriveResult {
        let driver = GoalDriver(scheduler, svc)
        let evidence = GoalEvidence(log)
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
            // 准入提示：`goal/change` 是 log-only，目标正文模型看不见，所以每轮都要重送一次
            // 「本轮该追求什么 + 现在第几轮」。落成 log-only 事件而不是直接写 user/message，
            // 是为了不进桌面转录；请求装配时折成 developer 角色（model_request.cj）。
            admitGoalRound(log, scheduler, maxGoalRounds)
            let result = ModelAgentLoop().run(makeFirst(), nextProvider, model, token, log, sink, allowParallel, maxSteps: maxSteps, attach: attach, supportsImages: supportsImages, toolRuntime: toolRuntime)
            let progressed = result.successfulToolCalls > Int64(0) && !result.interrupted && !result.cancelled
            let revision = scheduler.openRoundRevision()
            let round = scheduler.openRoundNumber()
            if (progressed) {
                // 机械证据落盘，绑定开轮修订与轮次号；目标在轮内被改过则 record 拒写，
                // evidence 随之为假。轮次号也在匹配条件里：上一轮的副作用替不了这一轮。
                evidence.record(revision, round)
            }
            RoundOutcome(progressed, evidence.satisfiedFor(revision, round) && claim(), cancelled: result.cancelled)
        }, armed: armed)
    }
}

// 轮次准入提示事件（log-only）：`{"revision":N,"round":N,"cap":N,"text":"…"}`。
let GOAL_ROUND_PROMPT_EVENT = "goal/round-prompt"

// 上游的保留续跑提示：命名目标、轮次与上限，并要求以工作区与工具结果为准。
// 形状是自有文案（不逐字复刻上游 prompt.ts），但三条职责一致——说清追求什么、
// 说到第几轮、说清上限在哪。
func goalRoundText(objective: String, round: Int64, cap: Int64): String {
    var text = "<goal_round>\n目标：${objective}\n轮次：${round}"
    if (cap > Int64(0)) {
        text += "/${cap}"
    }
    text += "\n以当前工作区、工具结果与持久状态为准继续推进；只有确有证据（测试通过、产物生成、"
    text += "真实副作用）表明目标达成时才可声明完成，无充分证据不得声称完成。\n</goal_round>"
    return text
}

// 每轮开跑前落一条准入提示。开轮修订取自调度器，因此轮内被改过的目标不会被
// 「重新宣读」成新状态——正文与修订同源，读者能自己核对。
func admitGoalRound(log: SessionLog, scheduler: GoalScheduler, cap: Int64): Unit {
    let revision = scheduler.openRoundRevision()
    let round = scheduler.openRoundNumber()
    let objective = GoalService(log).snapshot().objective
    let obj = JsonObject()
    obj.put("revision", JsonInt(revision))
    obj.put("round", JsonInt(round))
    obj.put("cap", JsonInt(cap))
    obj.put("text", JsonString(goalRoundText(objective, round, cap)))
    log.append(GOAL_ROUND_PROMPT_EVENT, obj.toString())
}

// 请求装配侧的读口：从准入提示事件取回正文。事件损坏时抛出而不是静默送空串——
// 送一条空的续跑提示等于让模型在无目标的情况下跑完一整轮。
func goalRoundPromptText(data: String): String {
    try {
        let obj = JsonValue.fromStr(data).asObject()
        let text = obj.get("text").getOrThrow().asString().getValue()
        if (text.size == 0) {
            throw Exception("bad-goal-round-prompt")
        }
        return text
    } catch (_: Exception) {
        throw Exception("bad-goal-round-prompt")
    }
}