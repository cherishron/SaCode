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

// resources provider只接受冻结契约的三种操作；server由scope分派层另行选择。
@Test
func mcpResourceRequestsKeepOpaqueParametersAndOmitAbsentCursor() {
    @Expect(McpResourceRequest.list().method, "resources/list")
    @Expect(McpResourceRequest.templates().method, "resources/templates/list")
    @Expect(McpResourceRequest.read("doc://a").method, "resources/read")
    @Expect(McpResourceRequest.list().paramsJson(), "{}")
    @Expect(McpResourceRequest.templates().paramsJson(), "{}")
    @Expect(McpResourceRequest.list(cursor: Some("")).paramsJson(), "{\"cursor\":\"\"}")
    @Expect(McpResourceRequest.templates(cursor: Some(" 页::%2F? ")).paramsJson(), "{\"cursor\":\" 页::%2F? \"}")
    @Expect(McpResourceRequest.read("doc://a/%2F?q=中文#片段").paramsJson(), "{\"uri\":\"doc://a/%2F?q=中文#片段\"}")
    @Expect(McpResourceRequest.read("a\"b\\c\n").paramsJson(), "{\"uri\":\"a\\\"b\\\\c\\n\"}")
}

@Test
func mcpReconnectDefaultsAndCappedBackoff() {
    let p = McpReconnectPolicy()
    @Expect(p.enabled, true)
    @Expect(p.initialDelayMs, 500.0)
    @Expect(p.maxDelayMs, 30000.0)
    @Expect(p.maxAttempts, Int64(10))
    @Expect(p.delayForAttempt(1), 500.0)
    @Expect(p.delayForAttempt(2), 1000.0)
    @Expect(p.delayForAttempt(7), 30000.0)
    @Expect(p.delayForAttempt(1000000), 30000.0)
    let custom = McpReconnectPolicy(enabled: false, initialDelayMs: 1.25, maxDelayMs: 3.5, maxAttempts: 7.0)
    @Expect(custom.enabled, false)
    @Expect(custom.delayForAttempt(2), 2.5)
    @Expect(custom.delayForAttempt(3), 3.5)
    @Expect(custom.maxAttempts, Int64(7))
}

@Test
func mcpReconnectRejectsInvalidConfigurationBeforeConnecting() {
    for (values in [(0.0, 30000.0, 10.0), (-1.0, 30000.0, 10.0),
        (2147483648.0, 2147483648.0, 10.0), (1.0, 0.0, 10.0),
        (100.0, 5.0, 10.0), (1.0, 2.0, 0.0), (1.0, 2.0, 1.5),
        (1.0, 2.0, 9007199254740992.0)]) {
        var rejected = false
        try {
            McpReconnectPolicy(initialDelayMs: values[0], maxDelayMs: values[1], maxAttempts: values[2])
        } catch (e: Exception) { rejected = true }
        @Expect(rejected, true)
    }
    var rejected = false
    try { McpReconnectPolicy().delayForAttempt(0) } catch (e: Exception) { rejected = true }
    @Expect(rejected, true)
}

@Test
func mcpReconnectRejectsNonFiniteDelays() {
    var zero: Float64 = 0.0
    for (value in [zero / zero, 1.0 / zero, -1.0 / zero]) {
        var initialRejected = false
        var ceilingRejected = false
        try { McpReconnectPolicy(initialDelayMs: value) } catch (e: Exception) { initialRejected = true }
        try { McpReconnectPolicy(maxDelayMs: value) } catch (e: Exception) { ceilingRejected = true }
        @Expect(initialRejected, true)
        @Expect(ceilingRejected, true)
    }
}
