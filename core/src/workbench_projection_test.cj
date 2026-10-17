package core

import std.unittest.*
import std.fs.*
import stdx.encoding.json.*

@Test
func workspaceRevisionIgnoresOtherEventsAndNoOpSelection() {
    removeIfExists("workspace-projection-revision.log", recursive: false)
    let log = SessionLog("workspace-projection-revision.log")
    let workspace = SessionWorkspace(log)
    @Expect(workspace.revision(), Int64(0))
    log.append("message/user", "问题")
    @Expect(workspace.revision(), Int64(0))
    @Expect(workspace.setDirectory("."), true)
    @Expect(workspace.revision(), Int64(1))
    @Expect(workspace.setDirectory("."), false)
    @Expect(workspace.revision(), Int64(1))
    log.append("workspace/directory", canonicalize(".").toString())
    @Expect(workspace.revision(), Int64(2))
    @Expect(log.flush(), true)
    let restored = SessionLog("workspace-projection-revision.log")
    @Expect(restored.load(), true)
    @Expect(SessionWorkspace(restored).revision(), Int64(2))
    removeIfExists("workspace-projection-revision.log", recursive: false)
}

@Test
func terminalProjectionPaginatesAndSkipsMalformedChunks() {
    let log = SessionLog("terminal-projection-pages.log")
    log.append("terminal/chunk", "broken")
    log.append("terminal/chunk", "job::第一行")
    log.append("message/user", "不属于终端")
    log.append("terminal/chunk", "job::第二行")
    let first = JsonValue.fromStr(terminalOutputJson(log, 0, 1)).asObject()
    @Expect(first.get("malformed").getOrThrow().asInt().getValue(), Int64(1))
    @Expect(first.get("more").getOrThrow().asBool().getValue(), true)
    let cursor = first.get("nextCursor").getOrThrow().asInt().getValue()
    let second = JsonValue.fromStr(terminalOutputJson(log, cursor, 1)).asObject()
    @Expect(second.get("rows").getOrThrow().asArray().size(), Int64(1))
    @Expect(second.get("more").getOrThrow().asBool().getValue(), false)
    @Expect(second.get("rows").getOrThrow().asArray().get(0).getOrThrow().asObject()
        .get("text").getOrThrow().asString().getValue(), "第二行")
}

@Test
func terminalProjectionTruncationPreservesUtf8AndRejectsInvalidPage() {
    let log = SessionLog("terminal-projection-utf8.log")
    var text = ""
    for (_ in 0..3000) { text += "中" }
    log.append("terminal/chunk", "job::${text}")
    let row = JsonValue.fromStr(terminalOutputJson(log, 0, 1)).asObject()
        .get("rows").getOrThrow().asArray().get(0).getOrThrow().asObject()
    let shown = row.get("text").getOrThrow().asString().getValue()
    @Expect(shown.toArray().size, Int64(8190))
    @Expect(row.get("truncated").getOrThrow().asBool().getValue(), true)
    var rejected: Int64 = 0
    for (limit in [Int64(0), Int64(17)]) {
        try { terminalOutputJson(log, 0, limit) }
        catch (_: Exception) { rejected += 1 }
    }
    try { terminalOutputJson(log, -1, 1) }
    catch (_: Exception) { rejected += 1 }
    @Expect(rejected, Int64(3))
}
