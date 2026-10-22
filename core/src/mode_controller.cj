package core

// 通用 session/append、session/submit 不得写入这些内部事实。
// 知识上下文与权限/计划事件都只能由专用接口落盘。
public func isReservedSessionEventType(eventType: String): Bool {
    return eventType == "knowledge/context" || eventType == "knowledge/context/clear" ||
        eventType == "knowledge/retrieval" || eventType == "mode/mode" ||
        eventType == "plan/mode" || eventType == "plan/permission" ||
        eventType == "permission/preset"
}

public class ModeController {
    let log: SessionLog

    public init(log: SessionLog) { this.log = log }

    public func current(): String {
        if (log.isDurableFrozen()) { throw Exception("mode-persistence-unsettled") }
        var value = ""
        for (event in log.snapshotEvents()) {
            if (event.eventType == "mode/mode") {
                value = event.data
            } else if (event.eventType == "plan/mode") {
                value = if (event.data == "true") { "plan" } else { "build" }
            } else if (event.eventType == "permission/preset") {
                value = if (event.data == "danger-full-access") { "yolo" } else { "build" }
            }
        }
        return if (value.size == 0) { "build" } else { value }
    }

    public func set(mode: String): String {
        if (mode != "plan" && mode != "build" && mode != "auto" && mode != "yolo") {
            throw Exception("unknown-approval-mode")
        }
        // 计划模式期间有效权限恒为只读；此时切换权限会破坏只读覆盖，直接拒绝。
        // 退出计划由 PlanModeController.exit() 在 deactivate 之后调用本方法恢复原档，不受此拒。
        if (PlanModeController(log).active()) { throw Exception("plan-mode-active") }
        if (current() == mode) { return "noop" }
        log.append("mode/mode", mode)
        return "committed"
    }

    public func setDurable(mode: String, lease: WriteLease): String {
        if (log.isDurableFrozen()) { throw Exception("mode-persistence-unsettled") }
        if (!lease.protects(log.path)) { throw Exception("mode-write-lease-required") }
        let result = set(mode)
        if (!log.durableCheckpoint(lease)) {
            log.freezeAfterDurableFailure()
            throw Exception("mode-persistence-failed")
        }
        return result
    }
}
