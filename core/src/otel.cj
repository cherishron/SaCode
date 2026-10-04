package core
import std.collection.*

// Otel ledger：log-only `otel/span` 事件承载 `<spanName>`；`enable()/disable()`
// 是本地开关（不落事件），未启用时 record 抛 `otel-not-enabled`；空 spanName 抛
// `otel-empty-name`。默认关闭，与 C04 已核一致（本仓无遥测后端，不外发）。
public class OtelLedger {
    let log: SessionLog
    var on = false

    public init(log: SessionLog) {
        this.log = log
    }

    public func enable(): Unit {
        on = true
    }

    public func disable(): Unit {
        on = false
    }

    public func record(spanName: String): Unit {
        if (!on) {
            throw Exception("otel-not-enabled")
        }
        if (spanName.size == 0) {
            throw Exception("otel-empty-name")
        }
        log.append("otel/span", spanName)
    }

    public func spanCount(): Int64 {
        var n: Int64 = 0
        for (event in log.snapshotEvents()) {
            if (event.eventType == "otel/span") {
                n = n + 1
            }
        }
        return n
    }
}
