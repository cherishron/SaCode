package core
import std.collection.*

// 槽位：上游 M5/M6 `ctx.slots` 的窄化非渲染面。`register(slotId, kind)` 落
// log-only `slots/register` 事件；`activate(slotId)` 未注册拒、已激活 noop
// 不落事件；正常激活落 `slots/activate`。事件本身不进 surface。
//
// 本切片假设 slotId/kind 不含 `::`；未来放开需换长度前缀编码。
public class SlotRegistry {
    let log: SessionLog
    let registered = HashSet<String>()
    let activated = HashSet<String>()

    public init(log: SessionLog) {
        this.log = log
        for (event in log.snapshotEvents()) {
            let t = event.eventType
            if (t == "slots/register") {
                let parts = splitOnce(event.data, "::")
                registered.add(parts.v0Name)
            } else if (t == "slots/activate") {
                activated.add(event.data)
            }
        }
    }

    public func register(slotId: String, kind: String): Unit {
        if (slotId.size == 0) {
            throw Exception("slots-empty-id")
        }
        if (registered.contains(slotId)) {
            return
        }
        registered.add(slotId)
        log.append("slots/register", "${slotId}::${kind}")
    }

    public func activate(slotId: String): Unit {
        if (!registered.contains(slotId)) {
            throw Exception("slots-unknown")
        }
        if (activated.contains(slotId)) {
            return
        }
        activated.add(slotId)
        log.append("slots/activate", slotId)
    }

    public func isRegistered(slotId: String): Bool {
        return registered.contains(slotId)
    }

    public func isActivated(slotId: String): Bool {
        return activated.contains(slotId)
    }

    public func eventCount(log: SessionLog): Int64 {
        var n: Int64 = 0
        for (event in log.snapshotEvents()) {
            let t = event.eventType
            if (t == "slots/register" || t == "slots/activate") {
                n = n + 1
            }
        }
        return n
    }

    private func splitOnce(s: String, sep: String): SplitResult {
        let idx = s.indexOf(sep) ?? Int64(-1)
        if (idx < 0) {
            return SplitResult(s, "")
        }
        return SplitResult(s[0..idx], s[(idx + sep.size)..s.size])
    }
}

class SplitResult {
    let v0Name: String
    let v1Name: String
    init(a: String, b: String) {
        v0Name = a
        v1Name = b
    }
}
