package core
import std.collection.*

// 会话遥测 hub：上游 §213 的 `ctx.sessionTelemetry` 承接。emit 走 waterfall
// 语义——按订阅顺序逐个调用监听器；**fail-closed**：任一监听器抛异常，
// 立即中止且**不落** `session-telemetry/record` 事件（后续监听器也拿不到）。
// 事件本身是 log-only（不进 surface）；`recordCount()` 从事件流重算，所以
// 回放后仍能看到历史条数。

public interface TelemetryListener {
    func onRecord(record: String): Unit
}

class Subscription {
    let id: String
    let listener: TelemetryListener
    init(id: String, listener: TelemetryListener) {
        this.id = id
        this.listener = listener
    }
}

public class SessionTelemetryHub {
    let log: SessionLog
    let subs = ArrayList<Subscription>()

    public init(log: SessionLog) {
        this.log = log
    }

    public func subscribe(id: String, listener: TelemetryListener): Unit {
        for (s in subs) {
            if (s.id == id) {
                throw Exception("telemetry-duplicate-subscriber")
            }
        }
        subs.add(Subscription(id, listener))
    }

    public func unsubscribe(id: String): Unit {
        for (i in 0..subs.size) {
            if (subs[i].id == id) {
                subs.remove(i..(i + 1))
                return
            }
        }
    }

    public func emit(record: String): Unit {
        // 先跑 waterfall，任一监听器抛即中止且不落事件。
        for (s in subs) {
            s.listener.onRecord(record)
        }
        log.append("session-telemetry/record", record)
    }

    public func recordCount(): Int64 {
        var n: Int64 = 0
        for (event in log.snapshotEvents()) {
            if (event.eventType == "session-telemetry/record") {
                n = n + 1
            }
        }
        return n
    }
}
