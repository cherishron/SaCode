package core
import std.collection.*

// 浏览器使用：log-only `browser-use/action` 事件承载 `<verb>::<target>`；
// verb 白名单四选一（navigate/click/type/scroll），非白名单抛 `browser-use-bad-verb`；
// 空 target 抛 `browser-use-empty-target`。
//
// 本切片假设 verb/target 不含 `::`；未来放开需换长度前缀编码。
public class BrowserUseLedger {
    let log: SessionLog

    public init(log: SessionLog) {
        this.log = log
    }

    public func perform(verb: String, target: String): Unit {
        if (!allowed(verb)) {
            throw Exception("browser-use-bad-verb")
        }
        if (target.size == 0) {
            throw Exception("browser-use-empty-target")
        }
        log.append("browser-use/action", "${verb}::${target}")
    }

    public func entries(): ArrayList<String> {
        let out = ArrayList<String>()
        for (event in log.snapshotEvents()) {
            if (event.eventType == "browser-use/action") {
                out.add(event.data)
            }
        }
        return out
    }

    private func allowed(verb: String): Bool {
        if (verb == "navigate") {
            return true
        }
        if (verb == "click") {
            return true
        }
        if (verb == "type") {
            return true
        }
        if (verb == "scroll") {
            return true
        }
        return false
    }
}
