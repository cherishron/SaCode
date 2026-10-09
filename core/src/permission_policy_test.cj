package core

import std.unittest.*

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
