package core
import std.collection.*
import std.fs.*
import std.unittest.*

// 工作区上游契约（M5/M6）：`ctx.workspaces` 提供 `WorkspaceRegistry`——
// `create(id, path)` 登记 + `archive(id)` 归档 + `pin(id, sessionId)` 关联会话。
// 本切片以 log-only `workspace/change` 事件承载 `create::<id>::<path>` /
// `archive::<id>` / `pin::<id>::<sessionId>`；`list()` 只回 active；
// `pinned(id)` 取会话集合序列。

@Test
func workspaceCreateArchiveAndPin() {
    let root = "core-ws-happy"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let ws = WorkspaceRegistry(log)
    ws.create("w1", "/path/one")
    ws.pin("w1", "s-1")
    @Expect(ws.list().size, Int64(1))
    @Expect(ws.pinned("w1").size, Int64(1))
    ws.archive("w1")
    @Expect(ws.list().size, Int64(0))
    removeIfExists(root, recursive: true)
}

@Test
func workspaceDuplicateCreateRejected() {
    let root = "core-ws-dup"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let ws = WorkspaceRegistry(log)
    ws.create("w1", "/x")
    var threw = false
    try {
        ws.create("w1", "/y")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    removeIfExists(root, recursive: true)
}

@Test
func workspaceUnknownPinRejected() {
    let root = "core-ws-unknown"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let ws = WorkspaceRegistry(log)
    var threw = false
    try {
        ws.pin("ghost", "s-1")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    removeIfExists(root, recursive: true)
}

@Test
func workspaceEventsAreLogOnlyAcrossReplay() {
    let root = "core-ws-replay"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let ws = WorkspaceRegistry(log)
    log.append("user/message", "开工")
    ws.create("w1", "/x")
    ws.pin("w1", "s-1")
    @Expect(log.flush(), true)
    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    @Expect(fresh.deriveMessages().size, Int64(1))
    let replayed = WorkspaceRegistry(fresh)
    @Expect(replayed.list().size, Int64(1))
    @Expect(replayed.pinned("w1").size, Int64(1))
    removeIfExists(root, recursive: true)
}
