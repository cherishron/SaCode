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

// 金值来自冻结 tools.ts 的 publicToolName；不在测试内复写命名算法。
// 这是纯命名契约，空原始名的函数结果不代表协议Schema允许空工具名。
// 同一金值已有独立纯函数编译验证；完整core单测尚未运行。
@Test
func mcpPublicNamesMatchFrozenUpstreamGoldenValues() {
    @Expect(mcpPublicToolName("github", "search"), "mcp__github__search")
    @Expect(mcpPublicToolName("web", "search"), "mcp__web__search")
    @Expect(mcpPublicToolName("fixture", "a/b"), "mcp__fixture__a_b_63aa69f30757")
    @Expect(mcpPublicToolName("fixture", "a_b"), "mcp__fixture__a_b")
    @Expect(mcpPublicToolName("fixture", "a b"), "mcp__fixture__a_b_d9538f025b71")
    @Expect(mcpPublicToolName("fixture", "中文工具"), "mcp__fixture_______8c946630e1dc")
    @Expect(mcpPublicToolName("fixture", ""), "mcp__fixture__")
    @Expect(mcpPublicToolName("fixture", "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"), "mcp__fixture__xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")
    @Expect(mcpPublicToolName("fixture", "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"), "mcp__fixture__xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")
    @Expect(mcpPublicToolName("fixture", "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"), "mcp__fixture__xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx_563ce0d166ec")
    @Expect(mcpPublicToolName("fixture", "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"), "mcp__fixture__xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx_67ce7c6ea70b")
    @Expect(mcpPublicToolName("fixture", "😀"), "mcp__fixture_____bdd0c92035a6")
    @Expect(mcpPublicToolName("fixture", "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxa"), "mcp__fixture__xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx_02f118e33f65")
    @Expect(mcpPublicToolName("fixture", "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxb"), "mcp__fixture__xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx_780add56f777")
    @Expect(mcpPublicToolName("A-_9", "name.with:punctuation"), "mcp__A-_9__name_with_punctuation_4fe542783064")
}
