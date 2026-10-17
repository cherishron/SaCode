package core

import std.unittest.*
import std.collection.*

func ctxWithVersion(principalId: String): AuthenticationContext {
    return AuthenticationContext("dev-1", principalId, Int64(1))
}

@Test
func authzUnknownMethodRejected() {
    let auth = RemoteAccessAuthorizer()
    auth.register(CapabilitySpec(method: "initialize", permission: AUTHZ_PERM_READ, needsWorkspace: false, needsSession: false))
    let view = DeviceAuthzView(ctxWithVersion("p"))
    let d = auth.check(view, "made/up/method", "", "")
    @Expect(d.allowed, false)
    @Expect(d.reason == AUTHZ_REASON_METHOD_NOT_REGISTERED, true)
}

@Test
func authzReadNeedsNoScope() {
    let auth = RemoteAccessAuthorizer()
    auth.register(CapabilitySpec(method: "session/projection", permission: AUTHZ_PERM_READ, needsWorkspace: true, needsSession: true))
    let view = DeviceAuthzView(ctxWithVersion("p"))
    let d = auth.check(view, "session/projection", "ws-1", "s-1")
    @Expect(d.allowed, true)
    @Expect(d.reason == AUTHZ_REASON_OK, true)
}

@Test
func authzWorkspaceAllowListMatches() {
    let auth = RemoteAccessAuthorizer()
    auth.register(CapabilitySpec(method: "session/projection", permission: AUTHZ_PERM_READ, needsWorkspace: true, needsSession: false))
    let base = DeviceAuthzView(ctxWithVersion("p"))
    let restricted = base.withAllowedWorkspace("ws-allowed")
    // 声称在 ws-allowed 的：通过
    @Expect(auth.check(restricted, "session/projection", "ws-allowed", "").allowed, true)
    // 声称在其他 ws 的：拒
    let d = auth.check(restricted, "session/projection", "ws-other", "")
    @Expect(d.allowed, false)
    @Expect(d.reason == AUTHZ_REASON_WORKSPACE_NOT_ALLOWED, true)
}

@Test
func authzSessionAllowListMatches() {
    let auth = RemoteAccessAuthorizer()
    auth.register(CapabilitySpec(method: "session/submit", permission: AUTHZ_PERM_WRITE, needsWorkspace: true, needsSession: true))
    let view = DeviceAuthzView(ctxWithVersion("p")).withAllowedSession("s-allowed")
    @Expect(auth.check(view, "session/submit", "ws-1", "s-allowed").allowed, true)
    let d = auth.check(view, "session/submit", "ws-1", "s-other")
    @Expect(d.allowed, false)
    @Expect(d.reason == AUTHZ_REASON_SESSION_NOT_ALLOWED, true)
}

@Test
func authzWorkspaceMissingRejected() {
    let auth = RemoteAccessAuthorizer()
    auth.register(CapabilitySpec(method: "session/submit", permission: AUTHZ_PERM_WRITE, needsWorkspace: true, needsSession: true))
    let view = DeviceAuthzView(ctxWithVersion("p"))
    let d = auth.check(view, "session/submit", "", "s-1")
    @Expect(d.allowed, false)
    @Expect(d.reason == AUTHZ_REASON_WORKSPACE_REQUIRED, true)
}

@Test
func authzSessionMissingRejected() {
    let auth = RemoteAccessAuthorizer()
    auth.register(CapabilitySpec(method: "session/submit", permission: AUTHZ_PERM_WRITE, needsWorkspace: true, needsSession: true))
    let view = DeviceAuthzView(ctxWithVersion("p"))
    let d = auth.check(view, "session/submit", "ws-1", "")
    @Expect(d.allowed, false)
    @Expect(d.reason == AUTHZ_REASON_SESSION_REQUIRED, true)
}

@Test
func authzManagementNeedsScope() {
    let auth = RemoteAccessAuthorizer()
    auth.register(CapabilitySpec(method: "credential/set", permission: AUTHZ_PERM_MANAGEMENT, needsWorkspace: true, needsSession: false))
    let plain = DeviceAuthzView(ctxWithVersion("user"))
    let d = auth.check(plain, "credential/set", "ws-1", "")
    @Expect(d.allowed, false)
    @Expect(d.reason == AUTHZ_REASON_SCOPE_REQUIRED, true)
    let elevated = plain.withScope(AUTHZ_SCOPE_MANAGEMENT)
    @Expect(auth.check(elevated, "credential/set", "ws-1", "").allowed, true)
}

@Test
func authzApprovalNeedsScope() {
    let auth = RemoteAccessAuthorizer()
    auth.register(CapabilitySpec(method: "approval/answer", permission: AUTHZ_PERM_APPROVAL, needsWorkspace: true, needsSession: true))
    let plain = DeviceAuthzView(ctxWithVersion("user"))
    @Expect(auth.check(plain, "approval/answer", "ws", "s").allowed, false)
    let withApproval = plain.withScope(AUTHZ_SCOPE_APPROVAL)
    @Expect(auth.check(withApproval, "approval/answer", "ws", "s").allowed, true)
}

@Test
func authzExecuteNeedsScope() {
    let auth = RemoteAccessAuthorizer()
    auth.register(CapabilitySpec(method: "task/start", permission: AUTHZ_PERM_EXECUTE, needsWorkspace: true, needsSession: true))
    let plain = DeviceAuthzView(ctxWithVersion("user"))
    @Expect(auth.check(plain, "task/start", "ws", "s").allowed, false)
    let withExec = plain.withScope(AUTHZ_SCOPE_EXECUTE)
    @Expect(auth.check(withExec, "task/start", "ws", "s").allowed, true)
}

@Test
func authzNoWorkspaceNeededAllowsEmpty() {
    let auth = RemoteAccessAuthorizer()
    auth.register(CapabilitySpec(method: "initialize", permission: AUTHZ_PERM_READ, needsWorkspace: false, needsSession: false))
    let view = DeviceAuthzView(ctxWithVersion("p"))
    let d = auth.check(view, "initialize", "", "")
    @Expect(d.allowed, true)
}

@Test
func authzCountMatchesRegistration() {
    let auth = RemoteAccessAuthorizer()
    auth.register(CapabilitySpec(method: "a", permission: AUTHZ_PERM_READ, needsWorkspace: false, needsSession: false))
    auth.register(CapabilitySpec(method: "b", permission: AUTHZ_PERM_READ, needsWorkspace: false, needsSession: false))
    auth.register(CapabilitySpec(method: "c", permission: AUTHZ_PERM_WRITE, needsWorkspace: true, needsSession: false))
    @Expect(auth.registeredCount(), Int64(3))
}

@Test
func authzDuplicateRegistrationOverwritesNotDuplicates() {
    let auth = RemoteAccessAuthorizer()
    auth.register(CapabilitySpec(method: "x", permission: AUTHZ_PERM_READ, needsWorkspace: false, needsSession: false))
    auth.register(CapabilitySpec(method: "x", permission: AUTHZ_PERM_WRITE, needsWorkspace: true, needsSession: false))
    // HashMap.add 在 Cangjie 语义下替换同键旧值；不应出现 size 增长到 2
    @Expect(auth.registeredCount(), Int64(1))
}

// 变异反证：把 needsWorkspace 检查从「非空即过」改成「永远过」，
// 上面 workspaceMissingRejected 与 sessionMissingRejected 应红。
// 手动施加变异由脚本完成；此处只留标记说明。
