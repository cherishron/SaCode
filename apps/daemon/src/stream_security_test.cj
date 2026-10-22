package daemon

import core.*
import std.unittest.*
import std.unittest.testmacro.*

@Test
func securityStreamUsesMethodScopeAndResourcePolicy() {
    let f = GateFixture()
    let c = f.store.authenticate(f.goodToken).getOrThrow()
    @Expect(f.gate.streamAllows(c, "session/events", "ws", "s"), false)
    f.authorizer.register(CapabilitySpec(method: "session/events", permission: AUTHZ_PERM_READ,
        needsWorkspace: true, needsSession: true))
    @Expect(f.gate.streamAllows(c, "session/events", "ws", ""), false)
    @Expect(f.gate.streamAllows(c, "session/events", "ws", "s"), true)
    let bound = RemoteRequestGate(f.store, f.authorizer, f.audit, "instance",
        boundWorkspace: "ws")
    @Expect(bound.streamAllows(c, "session/events", "other", "s"), false)
    @Expect(bound.streamAllows(c, "session/events", "ws", "s"), true)
    let frame = "{\"method\":\"approval/asked\",\"params\":{\"sessionId\":\"s\"}}"
    @Expect(bound.streamAllowsLive(c, frame), false)
    f.authorizer.register(CapabilitySpec(method: "approval/ask", permission: AUTHZ_PERM_APPROVAL,
        needsWorkspace: true, needsSession: true))
    @Expect(bound.streamAllowsLive(c, frame), false)
    @Expect(f.store.grantScope(deviceId: f.deviceId, scope: AUTHZ_SCOPE_APPROVAL), true)
    let approved = f.store.authenticate(f.goodToken).getOrThrow()
    @Expect(bound.streamAllowsLive(approved, frame), true)
    @Expect(bound.streamAllowsLive(approved, "{\"method\":\"unknown\",\"params\":{\"sessionId\":\"s\"}}"), false)
    @Expect(bound.streamAllowsLive(approved, "{\"method\":\"approval/asked\",\"params\":{}}"), false)
}

@Test
func securityStreamReplayRequiresSameReadPolicyAsRpc() {
    let root = resumeFixtureRoot("security-authorized")
    let sid = SessionCatalog(root).list()[0].id
    let f = GateFixture()
    let c = f.store.authenticate(f.goodToken).getOrThrow()
    let denied = SseResume.buildAuthorized(root: root, lastEventId: "${sid}|0", limit: 200,
        gate: f.gate, context: c)
    @Expect(denied.frames.size, 0)
    f.authorizer.register(CapabilitySpec(method: "session/events", permission: AUTHZ_PERM_READ,
        needsWorkspace: true, needsSession: true))
    let allowed = SseResume.buildAuthorized(root: root, lastEventId: "${sid}|0", limit: 200,
        gate: f.gate, context: c)
    @Expect(allowed.frames.size, 2)
}
