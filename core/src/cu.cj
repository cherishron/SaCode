package core
import std.collection.*

// 桌面自动化：log-only `computer-use/action` 事件承载 `<verb>::<target>`；
// verb 白名单五选一（click/drag/scroll/type/press_key）。
//
// 本切片假设 verb/target 不含 `::`。
public class ComputerUseLedger {
    let log: SessionLog

    public init(log: SessionLog) {
        this.log = log
    }

    public func perform(verb: String, target: String): Unit {
        if (!allowed(verb)) {
            throw Exception("computer-use-bad-verb")
        }
        if (target.size == 0) {
            throw Exception("computer-use-empty-target")
        }
        log.append("computer-use/action", "${verb}::${target}")
    }

    public func entries(): ArrayList<String> {
        let out = ArrayList<String>()
        for (event in log.snapshotEvents()) {
            if (event.eventType == "computer-use/action") {
                out.add(event.data)
            }
        }
        return out
    }

    private func allowed(verb: String): Bool {
        if (verb == "click") {
            return true
        }
        if (verb == "drag") {
            return true
        }
        if (verb == "scroll") {
            return true
        }
        if (verb == "type") {
            return true
        }
        if (verb == "press_key") {
            return true
        }
        return false
    }
}
