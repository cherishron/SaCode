package core
import std.collection.*
import std.sync.*
import stdx.encoding.json.*

// 计划审阅通道（方案 B：独立通道）。
//
// 模型在计划模式下探索后调用 `exit_plan_mode(plan=markdown)` 呈交计划：
//   1. 核心校验计划（非空、以 # 标题开头），把正文落成 log-only `plan/submitted`（真源）；
//   2. 在本通道等待用户审阅（Approve /Keep planning/ 关闭），决定落 log-only `plan/review`；
//   3. 批准 → **先过持久检查点**（批准记录 plan/review 与权限恢复 plan/mode=false + mode/mode=prior
//      一起落盘，需既有写租约）→ 退出计划模式并返回 {approved:true}；持久化失败即冻结并抛错，
//      绝不报批准成功、也不放模型继续；选继续规划 → 工具失败带反馈。
//
// 与 user_question_cards.cj 同构（mutex + 25ms 轮询等待 + 单 activeId + 投影），
// 但事件类型（plan/*）与投影（projectPlans）独立，互不冒充：既有 ask_user_question
// 通道的 kind 标记为 sacode-question-card，本通道不写该 kind，故 projectQuestionCards
// 不会把计划误当提问卡片。冲突点：若在途实现把 UserQuestionStore 扩成多 activeId
// 或改写 ask/answer 语义，需重新核对（本文件不依赖 UserQuestionStore，只依赖 SessionLog）。

// 从计划 Markdown 的一级（或任意级）标题提取展示标题；无标题返回 "计划"。
func planTitle(plan: String): String {
    for (raw in plan.split("\n")) {
        let line = raw.trimAscii()
        if (!line.startsWith("#")) { continue }
        var title = line
        while (title.startsWith("#")) { title = title[1..title.size] }
        title = title.trimAscii()
        if (title.size > 0) { return title }
    }
    return "计划"
}

// 模型工具 `exit_plan_mode` 的声明面。needsApproval=false：
// 工具本身即"待审阅"，由本通道完成用户批准，不再叠一层工具工单。
public func planReviewToolSpec(): ToolSpec {
    return ToolSpec("exit_plan_mode",
        "仅在计划模式激活时可用：把完整计划（Markdown，以 # 标题开头）呈交用户审阅。用户批准后退出计划模式，并从下一步开始按计划执行；用户选择继续规划时，反馈随工具失败结果返回，据此修订后再呈交。",
        "{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"plan\"],\"properties\":{\"plan\":{\"type\":\"string\"}}}", false)
}

// 校验 exit_plan_mode 参数：仅一个 plan 字段，且正文非空、以 # 标题开头。
func validatePlanArgs(raw: String): String {
    if (raw.size > 262144) { throw Exception("plan-too-large") }
    let obj = JsonValue.fromStr(raw).asObject()
    if (obj.size() != 1) { throw Exception("plan-invalid-args") }
    let plan = obj.get("plan").getOrThrow().asString().getValue()
    if (!plan.trimAscii().startsWith("#")) { throw Exception("plan-requires-heading") }
    return plan
}

func normalizePlanDecision(decision: String): String {
    if (decision == "approve" || decision == "keep-planning" || decision == "dismiss") { return decision }
    throw Exception("plan-invalid-decision")
}

// 计划审阅运行态：与 StructuredUserQuestions 一样，等待只在模型线程，协议线程可答复/取消。
public class PlanReviews {
    let log: SessionLog
    // 批准与权限恢复必须先过持久检查点，模型才可继续；检查点需要当前写租约。
    let lease: WriteLease
    let mutex = Mutex()
    var status = HashMap<String, String>()
    var feedback = HashMap<String, String>()
    var activeId = ""
    public let sessionId: String
    public init(log: SessionLog, sessionId: String, lease: WriteLease) {
        this.log = log
        this.sessionId = sessionId
        this.lease = lease
    }
    public func activeReviewId(): String { return synchronized(mutex) { activeId } }

    // 协议线程答复：校验会话与待审身份，落 plan/review，更新内存态。
    public func answer(session: String, id: String, decision: String, feedbackText: String, cancelled: Bool): Unit {
        synchronized(mutex) {
            if (session != sessionId) { throw Exception("plan-session-changed") }
            if (id != activeId || (status.get(id) ?? "missing") != "pending") { throw Exception("plan-already-settled") }
            if (feedbackText.size > 8000) { throw Exception("plan-feedback-too-large") }
            let value = if (cancelled) { "dismiss" } else { normalizePlanDecision(decision) }
            recordDecision(id, value, feedbackText)
        }
    }

    // 仅供持锁路径调用。
    private func recordDecision(id: String, decision: String, feedbackText: String): Unit {
        let payload = JsonObject()
        payload.put("decision", JsonString(decision))
        payload.put("feedback", JsonString(feedbackText))
        log.append("plan/review", "${id}::${payload.toString()}")
        status[id] = if (decision == "approve") { "approved" } else if (decision == "dismiss") { "dismissed" } else { "kept-planning" }
        feedback[id] = feedbackText
    }

    // 模型线程发起审阅并等待。返回：批准 allowed=true；继续规划/关闭/取消/超时 allowed=false。
    public func ask(call: ModelToolCall, token: TurnToken, changed: () -> Unit, maxWaitMs!: Int64 = 300000): ApprovalOutcome {
        if (maxWaitMs < 25 || maxWaitMs > 300000) { throw Exception("plan-invalid-timeout") }
        if (!PlanModeController(log).active()) { throw Exception("exit-plan-mode-inactive") }
        let plan = validatePlanArgs(call.args)
        let id = "plan-${log.eventCount()}"
        synchronized(mutex) {
            if (activeId.size > 0) { throw Exception("plan-already-pending") }
            PlanModeController(log).submit(id, call.id, planTitle(plan), plan)
            activeId = id
            status[id] = "pending"
            feedback[id] = ""
        }
        try {
            changed()
            var waited = Int64(0)
            while (waited < maxWaitMs) {
                if (token.cancelled()) {
                    synchronized(mutex) { recordDecision(id, "dismiss", "") }
                    return ApprovalOutcome(false, "cancelled")
                }
                let current = synchronized(mutex) { status.get(id) ?? "missing" }
                if (current == "approved") {
                    // 批准记录（plan/review）与权限恢复（plan/mode=false + mode/mode=prior）必须先持久化
                    // 成功，模型才可继续下一步；exitDurable 失败会冻结并抛 `plan-mode-persistence-*`。
                    // 这里再包一层 `plan-approve-*`，让调用方明确这是「批准未落盘」，而非普通工具错误。
                    try {
                        PlanModeController(log).exitDurable(lease)
                    } catch (e: Exception) {
                        throw Exception("plan-approve-persistence-failed:${e.message}")
                    }
                    return ApprovalOutcome(true, "{\"approved\":true}")
                }
                if (current == "kept-planning") {
                    let note = synchronized(mutex) { feedback.get(id) ?? "" }
                    return ApprovalOutcome(false, if (note.size == 0) { "plan-keep-planning" } else { "plan-keep-planning: ${note}" })
                }
                if (current == "dismissed") {
                    token.cancel()
                    return ApprovalOutcome(false, "plan-review-dismissed")
                }
                sleep(25 * Duration.millisecond)
                waited += 25
            }
            synchronized(mutex) { recordDecision(id, "dismiss", "timeout") }
            token.cancel()
            return ApprovalOutcome(false, "plan-review-timeout")
        } finally {
            synchronized(mutex) { activeId = "" }
            changed()
        }
    }
}
