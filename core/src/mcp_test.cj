package core
import std.collection.*
import std.fs.*
import std.unittest.*

// MCP 上游契约（M7）：`ctx.mcp.register(server, transport)` 挂一台 MCP 服务器；
// `list()` 枚举；`deregister(name)` 卸载。本切片以 log-only `mcp/server` 事件
// 承载 `register::<name>::<transport>` / `deregister::<name>`，投影读侧重建状态。

@Test
func mcpRegisterAndList() {
    let root = "core-mcp-list"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let mcp = McpRegistry(log)
    mcp.register("github", "stdio")
    mcp.register("sentry", "http")
    @Expect(mcp.list().size, Int64(2))
    @Expect(mcp.isRegistered("github"), true)
    removeIfExists(root, recursive: true)
}

@Test
func mcpRejectsEmptyNameOrTransport() {
    let root = "core-mcp-empty"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let mcp = McpRegistry(log)
    var threwName = false
    try {
        mcp.register("", "stdio")
    } catch (e: Exception) {
        threwName = true
    }
    @Expect(threwName, true)
    var threwTransport = false
    try {
        mcp.register("github", "")
    } catch (e: Exception) {
        threwTransport = true
    }
    @Expect(threwTransport, true)
    @Expect(mcp.list().size, Int64(0))
    removeIfExists(root, recursive: true)
}

@Test
func mcpDeregisterRemoves() {
    let root = "core-mcp-drop"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let mcp = McpRegistry(log)
    mcp.register("github", "stdio")
    mcp.deregister("github")
    @Expect(mcp.isRegistered("github"), false)
    @Expect(mcp.list().size, Int64(0))
    removeIfExists(root, recursive: true)
}

@Test
func mcpEventsAreLogOnlyAcrossReplay() {
    let root = "core-mcp-replay"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let mcp = McpRegistry(log)
    log.append("user/message", "开工")
    mcp.register("github", "stdio")
    @Expect(log.flush(), true)
    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    @Expect(fresh.deriveMessages().size, Int64(1))
    @Expect(McpRegistry(fresh).isRegistered("github"), true)
    removeIfExists(root, recursive: true)
}
