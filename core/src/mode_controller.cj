package core

public class ModeController {
    let log: SessionLog

    public init(log: SessionLog) { this.log = log }

    public func current(): String {
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
        if (current() == mode) { return "noop" }
        log.append("mode/mode", mode)
        return "committed"
    }
}
