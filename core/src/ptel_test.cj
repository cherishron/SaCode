package core
import std.collection.*
import std.fs.*
import std.unittest.*

// Product telemetry 上游契约（M1）：`ctx.productTelemetry.emit(name)` 同步入队；
// `ctx.productAnalytics` @Remote（enabled/watchPolicy/report）。C04 已核：本仓无上报，
// 默认关闭。本切片只做本地 emit 事件的 log-only 登记 + `enabled` 开关；
// 未启用时 `emit(name)` 抛。

@Test
func productTelemetryEnabledEmits() {
    let root = "core-pt-happy"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let pt = ProductTelemetryLedger(log)
    pt.enable()
    pt.emit("button_click")
    pt.emit("session_start")
    @Expect(pt.count(), Int64(2))
    removeIfExists(root, recursive: true)
}

@Test
func productTelemetryDisabledRejectsEmit() {
    let root = "core-pt-off"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let pt = ProductTelemetryLedger(log)
    var threw = false
    try {
        pt.emit("x")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    @Expect(pt.count(), Int64(0))
    removeIfExists(root, recursive: true)
}

@Test
func productTelemetryRejectsEmptyName() {
    let root = "core-pt-empty"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let pt = ProductTelemetryLedger(log)
    pt.enable()
    var threw = false
    try {
        pt.emit("")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    removeIfExists(root, recursive: true)
}

@Test
func productTelemetryEventIsLogOnlyAcrossReplay() {
    let root = "core-pt-replay"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let pt = ProductTelemetryLedger(log)
    log.append("user/message", "开工")
    pt.enable()
    pt.emit("a")
    @Expect(log.flush(), true)
    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    @Expect(fresh.deriveMessages().size, Int64(1))
    @Expect(ProductTelemetryLedger(fresh).count(), Int64(1))
    removeIfExists(root, recursive: true)
}
