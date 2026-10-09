package daemon

import core.*
import std.collection.*
import std.unittest.*

// RemoteRequestGate 落 daemon/src 后第一批行为测试。
// 覆盖计划 §6-7：认证 → 授权 → 审计三段各自的成败与落盘计数，
// 尤其「认证通过但 workspace/session 不在允许集」与「denied 也必落审计」
// 两条最容易漏的不变量。使用真实 RemoteIdentityStore，token 通过 enroll+exchangeToken 拿到。

class GateCollectSink <: AuditSink {
    let lines = ArrayList<String>()
    public func append(line: String): Bool { lines.add(line); return true }
    public func flush(): Bool { return true }
    public func size(): Int64 { lines.size }
    public func at(i: Int64): String { lines[i] }
}

class GateFixture {
    let store: RemoteIdentityStore
    let audit: RemoteAuditLog
    let authorizer: RemoteAccessAuthorizer
    let gate: RemoteRequestGate
    let sink: GateCollectSink
    let goodToken: String

    init() {
        store = RemoteIdentityStore()
        sink = GateCollectSink()
        audit = RemoteAuditLog(sink)
        authorizer = RemoteAccessAuthorizer()
        authorizer.register(CapabilitySpec(
            method: "session/submit", permission: AUTHZ_PERM_WRITE,
            needsWorkspace: true, needsSession: true))
        // management 需要 scope；默认 DeviceAuthzView 无 scope，可复现「认证过但授权拒」。
        authorizer.register(CapabilitySpec(
            method: "auth/revoke", permission: AUTHZ_PERM_MANAGEMENT,
            needsWorkspace: false, needsSession: false))
        let secret = store.createEnrollmentSecret("p-1")
        let device = store.enroll(secret.value, "test-dev", "desktop")
        let token = store.exchangeToken(device.deviceId, device.credential)
        goodToken = token.value
        gate = RemoteRequestGate(store, authorizer, audit, "inst-test")
    }
}

func bearer(t: String): String { "Bearer ${t}" }

@Test
func gateRejectsMissingBearer() {
    let f = GateFixture()
    let out = f.gate.check("", "session/submit", "ws-1", "s-1", "op-1")
    @Expect(out.allowed, false)
    @Expect(out.denyReason == "missing-bearer", true)
    @Expect(f.sink.size() == Int64(1), true)
}

@Test
func gateRejectsNonBearerPrefix() {
    let f = GateFixture()
    let out = f.gate.check("Basic abc", "session/submit", "ws-1", "s-1", "op-1")
    @Expect(out.allowed, false)
    @Expect(out.denyReason == "missing-bearer", true)
    @Expect(f.sink.size() == Int64(1), true)
}

@Test
func gateRejectsUnknownToken() {
    let f = GateFixture()
    let out = f.gate.check("Bearer wrong-token", "session/submit", "ws-1", "s-1", "op-1")
    // 不区分过期/撤销/无效——统一 invalid-token 避免旁路枚举。
    @Expect(out.allowed, false)
    @Expect(out.denyReason == "invalid-token", true)
    @Expect(f.sink.size() == Int64(1), true)
}

@Test
func gateAuthPassedButAuthzDeniedStillAudits() {
    // 真实 goodToken 过认证；auth/revoke 是 management 权限，默认
    // DeviceAuthzView 无 management scope → authorizer 拒 SCOPE_REQUIRED，
    // denied 审计必落一条且带 deviceId。这条锁住「denied 也必落审计」不变量。
    let f = GateFixture()
    let out = f.gate.check(bearer(f.goodToken), "auth/revoke", "", "", "op-1")
    @Expect(out.allowed, false)
    @Expect(out.context.isSome(), true)
    @Expect(f.sink.size() == Int64(1), true)
    let line = f.sink.at(0)
    @Expect((line.indexOf("\"outcome\":\"denied\"") ?? Int64(-1)) >= Int64(0), true)
    @Expect((line.indexOf("test-dev") ?? Int64(-1)) >= Int64(0), true)
    @Expect((line.indexOf("scope-required") ?? Int64(-1)) >= Int64(0), true)
}

@Test
func gateEmptyBearerSuffixTreatedAsMissing() {
    // "Bearer " 后面是空串——按未认证路径处理，落 missing-bearer。
    let f = GateFixture()
    let out = f.gate.check("Bearer ", "session/submit", "ws-1", "s-1", "op-1")
    @Expect(out.allowed, false)
    @Expect(out.denyReason == "missing-bearer", true)
    @Expect(f.sink.size() == Int64(1), true)
}
