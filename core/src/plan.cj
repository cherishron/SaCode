package core
import std.collection.*
import stdx.encoding.json.*

// 计划模式控制器（恢复为独立协作态）：`plan/mode` 事件 log-only（不进 isSurfaceEvent），
// 每次实际状态变化落一条 "true"/"false"；同值 set 返回 "noop" 且不落事件。
//
// 与审批模式的关系（权限契约）：
// - 进入计划模式（enter）：把进入前的有效权限档记入 log-only `plan/permission`，
//   并把有效权限压到只读档（plan/mode=true ⇒ ModeController.current()=="plan"）；
//   「计划阶段不写文件/不跑危险命令」由既有 PermissionPolicy 兜住，不另起策略。
// - 计划模式期间：有效权限恒为只读；切换权限（ModeController.set）会被拒（plan-mode-active），
//   不因切换而破坏只读覆盖。
// - 退出计划模式（exit）：落 plan/mode=false 并**恢复进入前的有效权限**，绝不隐式升级，
//   也不一律回落到 build（否则从 plan 进入再退出就变成给写权限）。
public class PlanModeController {
    let log: SessionLog

    public init(log: SessionLog) {
        this.log = log
    }

    public func active(): Bool {
        var value = false
        for (event in log.snapshotEvents()) {
            if (event.eventType == "plan/mode") {
                value = (event.data == "true")
            }
        }
        return value
    }

    public func set(value: Bool): String {
        let current = active()
        if (current == value) {
            return "noop"
        }
        log.append("plan/mode", if (value) { "true" } else { "false" })
        return "committed"
    }

    // 与 ModeController.setDurable 同口径：写许可 + 持久检查点，失败即冻结不谎报。
    public func setDurable(value: Bool, lease: WriteLease): String {
        if (log.isDurableFrozen()) { throw Exception("plan-mode-persistence-unsettled") }
        if (!lease.protects(log.path)) { throw Exception("plan-mode-write-lease-required") }
        let result = set(value)
        if (!log.durableCheckpoint(lease)) {
            log.freezeAfterDurableFailure()
            throw Exception("plan-mode-persistence-failed")
        }
        return result
    }

    // 进入前的有效权限（log-only `plan/permission`），供退出恢复；无记录返回空串。
    public func priorPermission(): String {
        var value = ""
        for (event in log.snapshotEvents()) {
            if (event.eventType == "plan/permission") { value = event.data }
        }
        return value
    }

    // 进入计划模式：先记录进入前有效权限，再把有效权限压到只读档。
    // 从任何原档（plan/build/auto/yolo）进入都压到只读，不隐式升级；已在计划模式则 noop。
    public func enter(): String {
        if (active()) { return "noop" }
        let prior = ModeController(log).current()
        log.append("plan/permission", prior)
        log.append("plan/mode", "true")
        return "committed"
    }

    public func enterDurable(lease: WriteLease): String {
        if (log.isDurableFrozen()) { throw Exception("plan-mode-persistence-unsettled") }
        if (!lease.protects(log.path)) { throw Exception("plan-mode-write-lease-required") }
        let result = enter()
        if (!log.durableCheckpoint(lease)) {
            log.freezeAfterDurableFailure()
            throw Exception("plan-mode-persistence-failed")
        }
        return result
    }

    // 退出计划模式：落 plan/mode=false，并恢复进入前的有效权限（不隐式升级、也不回落到 build）。
    // 仅当进入前记录非空且非 build 时才补 mode/mode：build 由 plan/mode=false 的既有权重映射得到。
    public func exit(): String {
        if (!active()) { return "noop" }
        log.append("plan/mode", "false")
        let prior = priorPermission()
        if (prior.size > 0 && prior != "build") { ModeController(log).set(prior) }
        return "committed"
    }

    public func exitDurable(lease: WriteLease): String {
        if (log.isDurableFrozen()) { throw Exception("plan-mode-persistence-unsettled") }
        if (!lease.protects(log.path)) { throw Exception("plan-mode-write-lease-required") }
        let result = exit()
        if (!log.durableCheckpoint(lease)) {
            log.freezeAfterDurableFailure()
            throw Exception("plan-mode-persistence-failed")
        }
        return result
    }

    // 计划呈交：把正文作为 log-only `plan/submitted` 落进会话日志（真源），
    // 使审阅卡片在刷新/重开后仍可从回放恢复。载荷用 JSON 承载换行与控制字符。
    public func submit(id: String, callId: String, title: String, plan: String): Unit {
        let payload = JsonObject()
        payload.put("callId", JsonString(callId))
        payload.put("title", JsonString(title))
        payload.put("plan", JsonString(plan))
        log.append("plan/submitted", "${id}::${payload.toString()}")
    }
}

// 计划投影：把 plan/* log-only 事件折成审阅卡片。
// - `plan/submitted` 建卡（正文 + 标题 + callId），当前待审 id 标 pending，其余标 unknown；
// - `plan/review` 更新决定（approve / keep-planning / dismiss）与反馈。
// 正文永远来自 plan/submitted，决定来自 plan/review，两者按 id 对齐。
public func projectPlans(events: Array<SessionEvent>, activeId!: String = ""): String {
    let cards = ArrayList<JsonObject>()
    let byId = HashMap<String, JsonObject>()
    for (event in events) {
        if (event.eventType != "plan/submitted" && event.eventType != "plan/review") { continue }
        let cut = event.data.indexOf("::") ?? Int64(-1)
        if (cut < 0) { continue }
        let id = event.data[0..cut]
        let payload = event.data[(cut + 2)..event.data.size]
        if (event.eventType == "plan/submitted") {
            try {
                let obj = JsonValue.fromStr(payload).asObject()
                obj.put("id", JsonString(id))
                obj.put("status", JsonString(if (id == activeId) { "pending" } else { "unknown" }))
                cards.add(obj)
                byId[id] = obj
            } catch (_: Exception) { /* 畸形快照不伪装成可审阅卡片。 */ }
        } else if (let Some(card) <- byId.get(id)) {
            try {
                let decision = JsonValue.fromStr(payload).asObject()
                let value = decision.get("decision").getOrThrow().asString().getValue()
                card.put("status", JsonString(if (value == "approve") { "approved" } else if (value == "dismiss") { "dismissed" } else { "kept-planning" }))
                card.put("decision", JsonString(value))
                if (let Some(feedback) <- decision.get("feedback")) { card.put("feedback", feedback) }
            } catch (_: Exception) { /* 畸形决定不改写卡片状态。 */ }
        }
    }
    let result = JsonArray()
    let start = if (cards.size > 32) { cards.size - 32 } else { Int64(0) }
    for (i in start..cards.size) { result.add(cards[i]) }
    return result.toString()
}
