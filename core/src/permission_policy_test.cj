package core

import std.unittest.*

@Test
func permissionModesAllowLspReadOnlyQueriesAndRenamePreview() {
    let policy = PermissionPolicy()
    for (tool in ["lsp_define", "lsp_lookup", "lsp_references", "lsp_implementation", "lsp_call_hierarchy", "lsp_diagnostics", "lsp_rename"]) {
        for (mode in ["plan", "build", "auto", "yolo"]) { @Expect(policy.decide(mode, tool), "allow") }
    }
}

@Test
func permissionPolicyUnknownToolsCannotBypassApproval() {
    let p = PermissionPolicy()
    for (tool in ["plugin/delete-database", "deploy", "git_push", "npm test && destructive-command", ""]) {
        @Expect(p.decide("plan", tool), "deny")
        @Expect(p.decide("build", tool), "ask")
        @Expect(p.decide("auto", tool), "ask")
        @Expect(p.decide("yolo", tool), "ask")
    }
}

@Test
func permissionPolicyTest() {
    let p = PermissionPolicy()
    // Plan
    @Expect(p.decide("plan", "read") == "allow")
    @Expect(p.decide("plan", "write") == "deny")
    // Build
    @Expect(p.decide("build", "read") == "allow")
    @Expect(p.decide("build", "write") == "allow")
    @Expect(p.decide("build", "bash") == "ask")
    // Auto
    @Expect(p.decide("auto", "read") == "allow")
    @Expect(p.decide("auto", "write") == "ask")
    @Expect(p.decide("auto", "grep") == "allow")
    // Yolo
    @Expect(p.decide("yolo", "write") == "allow")
    // 非法模式
    var threw = false
    try { p.decide("foo", "read"); threw = false } catch (_) { threw = true }
    @Expect(threw)
}
