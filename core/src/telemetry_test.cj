package core
import std.collection.*
import std.fs.*
import std.unittest.*

// 会话遥测上游契约（213 行）：`ctx.sessionTelemetry.emit(record)` 走 ledger
// 镜像 + ops 两条 channel，`session-telemetry/record` 是 waterfall 脱敏扩展点，
// **fail-closed**——任一监听器抛异常则整条记录扣下（既不给后续监听器，也不落
// 事件）。本切片以 log-only `session-telemetry/record` 事件近似 ledger 镜像。

class RecordingListener <: TelemetryListener {
    let sink = ArrayList<String>()
    public func onRecord(record: String): Unit {
        sink.add(record)
    }
    public func count(): Int64 {
        return Int64(sink.size)
    }
}

class PoisonListener <: TelemetryListener {
    public func onRecord(record: String): Unit {
        throw Exception("listener-blew-up")
    }
}

@Test
func telemetryEmitReachesAllListenersAndLandsEvent() {
    let root = "core-telemetry-emit"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let hub = SessionTelemetryHub(log)
    let a = RecordingListener()
    let b = RecordingListener()
    hub.subscribe("a", a)
    hub.subscribe("b", b)
    hub.emit("turn=1")
    @Expect(a.count(), Int64(1))
    @Expect(b.count(), Int64(1))
    @Expect(hub.recordCount(), Int64(1))
    removeIfExists(root, recursive: true)
}

@Test
func telemetryThrowingListenerHoldsBackRecord() {
    let root = "core-telemetry-failclosed"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let hub = SessionTelemetryHub(log)
    let later = RecordingListener()
    hub.subscribe("poison", PoisonListener())
    hub.subscribe("later", later)
    var threw = false
    try {
        hub.emit("turn=2")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    // fail-closed：后续监听器不应拿到，事件也不该落。
    @Expect(later.count(), Int64(0))
    @Expect(hub.recordCount(), Int64(0))
    removeIfExists(root, recursive: true)
}

@Test
func telemetryUnsubscribeRemovesListener() {
    let root = "core-telemetry-unsub"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let hub = SessionTelemetryHub(log)
    let a = RecordingListener()
    hub.subscribe("a", a)
    hub.unsubscribe("a")
    hub.emit("turn=3")
    @Expect(a.count(), Int64(0))
    @Expect(hub.recordCount(), Int64(1))
    removeIfExists(root, recursive: true)
}

@Test
func telemetryRecordEventIsLogOnly() {
    let root = "core-telemetry-surface"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let hub = SessionTelemetryHub(log)
    log.append("user/message", "开工")
    hub.emit("turn=4")
    @Expect(log.flush(), true)
    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    // 关键：session-telemetry/record 不进 surface——deriveMessages 只看到那一条 user/message。
    @Expect(fresh.deriveMessages().size, Int64(1))
    @Expect(SessionTelemetryHub(fresh).recordCount(), Int64(1))
    removeIfExists(root, recursive: true)
}
