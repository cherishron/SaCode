package core
import std.collection.*
import std.fs.*
import std.unittest.*

// 桌面自动化上游契约（M8）：`ctx.computerUse` 提供 click/drag/scroll/type/press_key
// 五种桌面动作。本切片以 log-only `computer-use/action` 事件承载 `<verb>::<target>`；
// verb 白名单在 click/drag/scroll/type/press_key 五选一。

@Test
func computerUseRecordsActions() {
    let root = "core-cu-happy"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let cu = ComputerUseLedger(log)
    cu.perform("click", "(100,200)")
    cu.perform("press_key", "Ctrl+S")
    @Expect(cu.entries().size, Int64(2))
    removeIfExists(root, recursive: true)
}

@Test
func computerUseRejectsUnknownVerb() {
    let root = "core-cu-verb"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let cu = ComputerUseLedger(log)
    var threw = false
    try {
        cu.perform("explode", "x")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    removeIfExists(root, recursive: true)
}

@Test
func computerUseRejectsEmptyTarget() {
    let root = "core-cu-empty"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let cu = ComputerUseLedger(log)
    var threw = false
    try {
        cu.perform("click", "")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    removeIfExists(root, recursive: true)
}

@Test
func computerUseEventIsLogOnlyAcrossReplay() {
    let root = "core-cu-replay"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let cu = ComputerUseLedger(log)
    log.append("user/message", "开工")
    cu.perform("click", "(10,20)")
    @Expect(log.flush(), true)
    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    @Expect(fresh.deriveMessages().size, Int64(1))
    @Expect(ComputerUseLedger(fresh).entries().size, Int64(1))
    removeIfExists(root, recursive: true)
}
