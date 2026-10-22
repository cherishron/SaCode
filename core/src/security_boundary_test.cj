package core

import std.fs.*
import std.process.*
import std.unittest.*

func securityBoundaryRuntime(log: SessionLog, base: String): ToolRuntime {
    let registry = ToolRegistry()
    for (name in ["read", "grep", "lsp", "write", "edit"]) {
        registry.register(ToolSpec(name, name, "{}", name == "write" || name == "edit"))
    }
    return ToolRuntime(log, registry, workingDirectory: base)
}

func securityBoundaryArgs(path: String, fields: String): String {
    return "{\"path\":\"" + jsonEscapeText(path) + "\"" + fields + "}"
}

@Test
func securityWorkspaceRejectsAbsoluteTraversalAndSiblingPaths() {
    let root = Directory.createTemp(Path(coreTestRoot())).toString()
    let workspace = "${root}/workspace"
    Directory.create(workspace)
    Directory.create("${root}/workspace-sibling")
    let outside = "${root}/outside.txt"
    let secret = "SYNTHETIC_OUTSIDE_BODY"
    File.writeTo(outside, secret.toArray())
    let log = SessionLog("${root}/session.log")
    let runtime = securityBoundaryRuntime(log, canonicalize(workspace).toString())
    let absolute = canonicalize(outside).toString()
    for (path in [absolute, "../outside.txt", "../workspace-sibling/new.txt"]) {
        for ((tool, fields) in [("grep", ",\"pattern\":\"SYNTHETIC\""), ("lsp", ""),
            ("write", ",\"content\":\"replacement\""),
            ("edit", ",\"old_string\":\"SYNTHETIC\",\"new_string\":\"replacement\"")]) {
            let result = runtime.execute(tool, securityBoundaryArgs(path, fields), "allowed-once", true)
            @Expect(result.allowed, false)
            @Expect(result.why.startsWith("outside-workspace:"), true)
            @Expect(runtime.lastDetail.stage, "outside-workspace")
            @Expect(result.why.contains(secret), false)
        }
    }
    @Expect(String.fromUtf8(File.readFrom(outside)), secret)
    @Expect(exists("${root}/workspace-sibling/new.txt"), false)
    for (event in log.snapshotEvents()) {
        @Expect(event.data.contains(secret), false)
    }
    removeIfExists(root, recursive: true)
}

@Test
func securityWorkspaceAllowsInBoundsAndEmptyBaseCompatibility() {
    let root = Directory.createTemp(Path(coreTestRoot())).toString()
    let workspace = "${root}/workspace"
    Directory.create(workspace)
    let log = SessionLog("${root}/session.log")
    let runtime = securityBoundaryRuntime(log, canonicalize(workspace).toString())
    @Expect(runtime.execute("write", securityBoundaryArgs("new.txt", ",\"content\":\"alpha\""), "allowed-once", true).allowed, true)
    @Expect(runtime.execute("read", securityBoundaryArgs("new.txt", ""), "", true).why, "alpha")
    @Expect(runtime.execute("edit", securityBoundaryArgs("new.txt", ",\"old_string\":\"alpha\",\"new_string\":\"beta\""), "allowed-once", true).allowed, true)
    @Expect(runtime.execute("grep", "{\"pattern\":\"beta\"}", "", true).why.contains("beta"), true)
    let unbound = securityBoundaryRuntime(SessionLog("${root}/unbound.log"), "")
    let absolute = canonicalize(root).join("unbound.txt").toString()
    @Expect(unbound.execute("write", securityBoundaryArgs(absolute, ",\"content\":\"compatibility\""), "allowed-once", true).allowed, true)
    @Expect(unbound.execute("grep", securityBoundaryArgs(absolute, ",\"pattern\":\"compatibility\""), "", true).why.contains("compatibility"), true)
    removeIfExists(root, recursive: true)
}

@Test
func securityWorkspaceSessionDirectoryOverridesFallback() {
    let root = Directory.createTemp(Path(coreTestRoot())).toString()
    Directory.create("${root}/selected")
    let log = SessionLog("${root}/session.log")
    SessionWorkspace(log).setDirectory("${root}/selected")
    let runtime = securityBoundaryRuntime(log, canonicalize(root).toString())
    let result = runtime.execute("write", securityBoundaryArgs("../outside.txt", ",\"content\":\"blocked\""), "allowed-once", true)
    @Expect(result.allowed, false)
    @Expect(result.why.startsWith("outside-workspace:"), true)
    @Expect(exists("${root}/outside.txt"), false)
    removeIfExists(root, recursive: true)
}

@When[os == "Windows"]
@Test
func securityWorkspaceRejectsJunctionAndSkipsRecursiveEscape() {
    let root = Directory.createTemp(Path(coreTestRoot())).toString()
    Directory.create("${root}/workspace")
    Directory.create("${root}/outside")
    File.writeTo("${root}/outside/secret.txt", "SYNTHETIC_LINK_SECRET".toArray())
    let workspace = canonicalize("${root}/workspace").toString()
    let target = canonicalize("${root}/outside").toString()
    let link = Path(workspace).join("escape").toString()
    let (rc, _, err) = executeWithOutput("cmd", ["/c", "mklink", "/J", link, target])
    if (rc != 0) { throw Exception("junction-fixture-unavailable:${String.fromUtf8(err)}") }
    try {
        let runtime = securityBoundaryRuntime(SessionLog("${root}/session.log"), workspace)
        let result = runtime.execute("grep", "{\"pattern\":\"SYNTHETIC\"}", "", true)
        @Expect(result.allowed, true)
        @Expect(result.why.contains("SYNTHETIC_LINK_SECRET"), false)
        @Expect(runtime.execute("write", securityBoundaryArgs("escape/new.txt", ",\"content\":\"blocked\""), "allowed-once", true).allowed, false)
        @Expect(runtime.execute("grep", securityBoundaryArgs("escape/secret.txt", ",\"pattern\":\"SYNTHETIC\""), "", true).allowed, false)
        @Expect(exists("${target}/new.txt"), false)
    } finally {
        // 先移除重解析点，再清理自己的夹具，不能递归进入目标。
        executeWithOutput("cmd", ["/c", "rmdir", link])
    }
    @Expect(String.fromUtf8(File.readFrom("${target}/secret.txt")), "SYNTHETIC_LINK_SECRET")
    removeIfExists(root, recursive: true)
}

@Test
func securityReservedEventsRejectPermissionFactsButKeepOrdinaryEvents() {
    for (eventType in ["knowledge/context", "knowledge/context/clear", "knowledge/retrieval",
        "mode/mode", "plan/mode", "plan/permission", "permission/preset"]) {
        @Expect(isReservedSessionEventType(eventType), true)
    }
    for (eventType in ["user/message", "todo/write", "session/title", "turn/start", "assistant/message"]) {
        @Expect(isReservedSessionEventType(eventType), false)
    }
}
