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
    let deviceId: String

    init() {
        store = RemoteIdentityStore()
        sink = GateCollectSink()
        audit = RemoteAuditLog(sink)
        authorizer = RemoteAccessAuthorizer()
        // 真部署里 initialize 由策略文件登记（契约第 1 行 read/无资源键），
        // 夹具不登记就等于「认证过但方法未登记」，走不到业务分支，也占不到槽。
        authorizer.register(CapabilitySpec(
            method: "initialize", permission: AUTHZ_PERM_READ,
            needsWorkspace: false, needsSession: false))
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
        deviceId = device.deviceId
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

@Test
func gateDeniedAuditsAttemptedWorkspaceAndSession() {
    // 设计 §7「审计保存 who/when/what/result」：拒绝条目也必须记 attempted 的
    // workspace/session，否则事后无法还原「哪个设备试图访问哪个会话」。
    let f = GateFixture()
    let out = f.gate.check(bearer(f.goodToken), "auth/revoke", "ws-audit", "s-audit", "op-a")
    @Expect(out.allowed, false)
    @Expect(f.sink.size() == Int64(1), true)
    let line = f.sink.at(0)
    @Expect((line.indexOf("\"workspaceId\":\"ws-audit\"") ?? Int64(-1)) >= Int64(0), true)
    @Expect((line.indexOf("\"sessionId\":\"s-audit\"") ?? Int64(-1)) >= Int64(0), true)
}

@Test
func gatePoisonedIdentifierCannotBlankAudit() {
    // 归属字段是客户端可控串。若原样进审计，jsonEscape 后 `"` 变成 `\"`，
    // 拼出被禁键串 `\"token\"`，RemoteAuditLog.record() 会整条拒落——
    // 攻击者即可靠构造 workspaceId 让越权尝试「不进审计」。
    // 净化后必须：请求照旧拒、审计照旧落一条、禁串不出现、原文不出现。
    let f = GateFixture()
    let out = f.gate.check(
        bearer(f.goodToken), "auth/revoke", "a\",\"token\":\"b", "s-1", "op-1")
    @Expect(out.allowed, false)
    @Expect(f.sink.size() == Int64(1), true)
    let line = f.sink.at(0)
    @Expect((line.indexOf("sanitized-invalid") ?? Int64(-1)) >= Int64(0), true)
    @Expect((line.indexOf("\\\"token\\\"") ?? Int64(-1)) == Int64(-1), true)
    @Expect((line.indexOf("\"token\"") ?? Int64(-1)) == Int64(-1), true)
}

@Test
func gateSanitizeIdAcceptsIdentifierShapesAndCapsLength() {
    // 正常标识符不能被净化弄坏；超长要截断到 64。
    @Expect(RemoteRequestGate.sanitizeId("ws-1") == "ws-1", true)
    @Expect(RemoteRequestGate.sanitizeId("a_b.c:d/e") == "a_b.c:d/e", true)
    @Expect(RemoteRequestGate.sanitizeId("") == "", true)
    @Expect(RemoteRequestGate.sanitizeId("带中文") == "sanitized-invalid", true)
    var longStr = ""
    for (_ in 0..100) { longStr += "a" }
    @Expect(RemoteRequestGate.sanitizeId(longStr).size == Int64(64), true)
}

// 以下是 daemon.cj 里 dispatchRpcWithAuth 与 global gate slot 的接线合同。
// 目标：证明设计 §4.2「/rpc 每次请求都认证」不只是模块能拒，而是 HTTP 分派层
// 也真的会拦下——Gate 拒时返回 -32001 且**不**进 Host/Team/SessionCatalog 任一分支。
@Test
func dispatchWithoutGateKeepsLegacyPath() {
    setRemoteGate(None)
    let response = dispatchRpcWithAuth(
        "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}", "")
    // 未启用 gate → 0.1 旧路径不变，仍返 protocolVersion。
    @Expect((response.indexOf("protocolVersion") ?? Int64(-1)) >= Int64(0), true)
    @Expect((response.indexOf("-32001") ?? Int64(-1)) == Int64(-1), true)
}

@Test
func dispatchWithGateRejectsMissingBearer() {
    let f = GateFixture()
    setRemoteGate(Some(f.gate))
    let response = dispatchRpcWithAuth(
        "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"initialize\",\"params\":{}}", "")
    @Expect((response.indexOf("-32001") ?? Int64(-1)) >= Int64(0), true)
    @Expect((response.indexOf("authz-denied:missing-bearer") ?? Int64(-1)) >= Int64(0), true)
    // 拒时**不**执行 initialize 分支，响应不含 capabilities。
    @Expect((response.indexOf("capabilities") ?? Int64(-1)) == Int64(-1), true)
    // 拒也落审计。
    @Expect(f.sink.size() == Int64(1), true)
    setRemoteGate(None)
}

@Test
func dispatchWithGateExtractsWorkspaceSessionOperationId() {
    // 归属字段来自 params 顶层，不是 session/select 全局态。
    let f = GateFixture()
    setRemoteGate(Some(f.gate))
    let response = dispatchRpcWithAuth(
        "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"auth/revoke\",\"params\":{\"workspaceId\":\"ws-9\",\"sessionId\":\"s-9\",\"operationId\":\"op-42\"}}",
        bearer(f.goodToken))
    // auth/revoke 是 management 权限，默认 view 无 scope，拒；
    // 审计里应能看到三个归属字段都从 params 顶层取到。
    @Expect((response.indexOf("-32001") ?? Int64(-1)) >= Int64(0), true)
    @Expect(f.sink.size() == Int64(1), true)
    let line = f.sink.at(0)
    @Expect((line.indexOf("\"workspaceId\":\"ws-9\"") ?? Int64(-1)) >= Int64(0), true)
    @Expect((line.indexOf("\"sessionId\":\"s-9\"") ?? Int64(-1)) >= Int64(0), true)
    @Expect((line.indexOf("\"operationId\":\"op-42\"") ?? Int64(-1)) >= Int64(0), true)
    setRemoteGate(None)
}

@Test
func dispatchReleasesRpcSlotAfterEachRequest() {
    // 每设备 8 个并发槽，连打 9 次 initialize 都必须成功：
    // 只要有一次没在 finally 里归还，第 9 次就会被自己的槽位账拦下。
    let f = GateFixture()
    setRemoteGate(Some(f.gate))
    var okCount: Int64 = 0
    for (i in 0..9) {
        let r = dispatchRpcWithAuth(
            "{\"jsonrpc\":\"2.0\",\"id\":${i},\"method\":\"initialize\",\"params\":{}}",
            bearer(f.goodToken))
        if ((r.indexOf("protocolVersion") ?? Int64(-1)) >= Int64(0)) { okCount += 1 }
    }
    @Expect(okCount, Int64(9))
    @Expect(remoteLimiter.rpcHeldBy(f.deviceId), Int64(0))
    setRemoteGate(None)
}

@Test
func dispatchRejectsWhenDeviceRpcSlotsAreExhausted() {
    // 槽位被这台设备自己占满时，新请求必须按限额拒，且不执行业务分支。
    // 被拒的请求不能再占第 9 个槽——否则一轮拒绝就能把设备永久锁死。
    let f = GateFixture()
    setRemoteGate(Some(f.gate))
    for (i in 0..8) {
        @Expect(remoteLimiter.acquireRpc(f.deviceId).allowed, true)
    }
    let r = dispatchRpcWithAuth(
        "{\"jsonrpc\":\"2.0\",\"id\":99,\"method\":\"initialize\",\"params\":{}}",
        bearer(f.goodToken))
    @Expect((r.indexOf("-32005") ?? Int64(-1)) >= Int64(0), true)
    @Expect((r.indexOf("concurrency-denied:rpc-per-device") ?? Int64(-1)) >= Int64(0), true)
    @Expect((r.indexOf("protocolVersion") ?? Int64(-1)) == Int64(-1), true)
    @Expect(remoteLimiter.rpcHeldBy(f.deviceId), RPC_PER_DEVICE_LIMIT)
    for (i in 0..8) { remoteLimiter.releaseRpc(f.deviceId) }
    setRemoteGate(None)
}
