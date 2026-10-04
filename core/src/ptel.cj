package core
import std.collection.*

// Product telemetry ledger：log-only `product-telemetry/emit` 事件承载 `<eventName>`；
// `enable()/disable()` 是本地开关，未启用 emit 抛 `product-telemetry-not-enabled`；
// 空 eventName 抛 `product-telemetry-empty-name`。默认关闭，与 C04 已核一致
// （本仓无上报）。
public class ProductTelemetryLedger {
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

    public func emit(eventName: String): Unit {
        if (!on) {
            throw Exception("product-telemetry-not-enabled")
        }
        if (eventName.size == 0) {
            throw Exception("product-telemetry-empty-name")
        }
        log.append("product-telemetry/emit", eventName)
    }

    public func count(): Int64 {
        var n: Int64 = 0
        for (event in log.snapshotEvents()) {
            if (event.eventType == "product-telemetry/emit") {
                n = n + 1
            }
        }
        return n
    }
}
