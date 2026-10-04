package core

// Plan mode 控制器：`plan/mode` 事件 log-only（不进 isSurfaceEvent），
// 每次实际状态变化落一条 { active: boolean }；同值 set 返回 "noop" 且不落事件。
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
}
