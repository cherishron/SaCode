package core
import std.collection.*
import std.fs.*
import std.unittest.*

// PTC（per-tool-call）运行时上游契约（M4）：每次工具调用绑定一个 `PtcContext`；
// `begin(callId, toolName)` 开一个 ctx；`attribute(callId, key, value)` 挂附加属性；
// `end(callId, outcome)` 结算。本切片以 log-only `ptc/begin` / `ptc/end` 事件近似。

@Test
func ptcBeginAndEndFlipsStatus() {
    let root = "core-ptc-happy"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let ptc = PtcRuntime(log)
    ptc.begin("c1", "read_file")
    @Expect(ptc.status("c1"), "running")
    ptc.end("c1", "ok")
    @Expect(ptc.status("c1"), "ok")
    removeIfExists(root, recursive: true)
}

@Test
func ptcRejectsDoubleBegin() {
    let root = "core-ptc-dup"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let ptc = PtcRuntime(log)
    ptc.begin("c1", "read_file")
    var threw = false
    try {
        ptc.begin("c1", "read_file")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    removeIfExists(root, recursive: true)
}

@Test
func ptcUnknownEndRejected() {
    let root = "core-ptc-unknown"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let ptc = PtcRuntime(log)
    var threw = false
    try {
        ptc.end("ghost", "ok")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    removeIfExists(root, recursive: true)
}

@Test
func ptcEventsAreLogOnlyAcrossReplay() {
    let root = "core-ptc-replay"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let ptc = PtcRuntime(log)
    log.append("user/message", "开工")
    ptc.begin("c1", "read_file")
    ptc.end("c1", "ok")
    @Expect(log.flush(), true)
    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    @Expect(fresh.deriveMessages().size, Int64(1))
    @Expect(PtcRuntime(fresh).status("c1"), "ok")
    removeIfExists(root, recursive: true)
}
