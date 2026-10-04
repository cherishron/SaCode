package core
import std.collection.*
import std.fs.*
import std.unittest.*

// 终端上游契约（M4）：`ctx.terminal` 提供 PTY 会话；本仓无 PTY，窄化只做
// `TerminalBuffer`——每个终端会话有一个 id，chunk 顺序 append，读回按顺序返回。
// 事件走 log-only `terminal/chunk` `<sessionId>::<text>`。

@Test
func terminalBuffersChunksInOrder() {
    let root = "core-term-order"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let term = TerminalBuffer(log)
    term.append("t1", "甲")
    term.append("t1", "乙")
    term.append("t2", "丙")
    let t1 = term.read("t1")
    @Expect(t1.size, Int64(2))
    @Expect(t1[0], "甲")
    @Expect(t1[1], "乙")
    @Expect(term.read("t2").size, Int64(1))
    removeIfExists(root, recursive: true)
}

@Test
func terminalRejectsEmptySessionOrChunk() {
    let root = "core-term-empty"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let term = TerminalBuffer(log)
    var threwId = false
    try {
        term.append("", "x")
    } catch (e: Exception) {
        threwId = true
    }
    @Expect(threwId, true)
    var threwChunk = false
    try {
        term.append("t1", "")
    } catch (e: Exception) {
        threwChunk = true
    }
    @Expect(threwChunk, true)
    removeIfExists(root, recursive: true)
}

@Test
func terminalUnknownSessionReadEmpty() {
    let root = "core-term-unknown"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let term = TerminalBuffer(log)
    @Expect(term.read("ghost").size, Int64(0))
    removeIfExists(root, recursive: true)
}

@Test
func terminalEventIsLogOnlyAcrossReplay() {
    let root = "core-term-replay"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let term = TerminalBuffer(log)
    log.append("user/message", "开工")
    term.append("t1", "x")
    @Expect(log.flush(), true)
    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    @Expect(fresh.deriveMessages().size, Int64(1))
    @Expect(TerminalBuffer(fresh).read("t1").size, Int64(1))
    removeIfExists(root, recursive: true)
}
