package core
import std.collection.*
import std.fs.*
import std.unittest.*

// Otel 上游契约（M8）：`ctx.otel.createEventReporter(...)` + `createSessionLogReporter(...)`
// 两 channel；本仓无遥测后端，默认不外发。C04 已核：上游 exporter、配置与账号依赖已核，
// 仅以明确启用的可替换服务提供。本切片只做本地 span 事件的 log-only 登记 + `enabled`
// 开关；未启用时 `record(span)` 抛。

@Test
func otelEnabledRecordsSpan() {
    let root = "core-otel-on"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let o = OtelLedger(log)
    o.enable()
    o.record("turn-1.start")
    @Expect(o.spanCount(), Int64(1))
    removeIfExists(root, recursive: true)
}

@Test
func otelDisabledRejectsRecord() {
    let root = "core-otel-off"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let o = OtelLedger(log)
    var threw = false
    try {
        o.record("turn-1.start")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    @Expect(o.spanCount(), Int64(0))
    removeIfExists(root, recursive: true)
}

@Test
func otelDisableStopsFurtherRecords() {
    let root = "core-otel-toggle"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let o = OtelLedger(log)
    o.enable()
    o.record("a")
    o.disable()
    var threw = false
    try {
        o.record("b")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    @Expect(o.spanCount(), Int64(1))
    removeIfExists(root, recursive: true)
}

@Test
func otelSpanEventIsLogOnlyAcrossReplay() {
    let root = "core-otel-replay"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let o = OtelLedger(log)
    log.append("user/message", "开工")
    o.enable()
    o.record("a")
    @Expect(log.flush(), true)
    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    @Expect(fresh.deriveMessages().size, Int64(1))
    @Expect(OtelLedger(fresh).spanCount(), Int64(1))
    removeIfExists(root, recursive: true)
}
