package daemon

import core.*
import std.collection.*
import std.env.*
import std.fs.*
import std.unittest.*

// 身份引导面（POST /auth/enroll、POST /auth/token）与接入启动校验的行为测试。
// 覆盖计划 §6：登记秘密一次消费、凭据兑换、大小/速率限制、审计不含秘密、
// 实例身份跨重启稳定、配置缺项必须启动失败。
// 临时文件一律走 getTempDirectory()，不落仓库目录（AGENTS.md 红线）。

func tmpPath(name: String): String {
    "${getTempDirectory().toString()}/sa-remote-${name}"
}

func dropFile(name: String): Unit {
    let p = Path(tmpPath(name))
    if (exists(p)) { try { remove(p, recursive: false) } catch (_: Exception) {} }
}

class AccessFixture {
    let store: RemoteIdentityStore
    let sink: GateCollectSink
    let audit: RemoteAuditLog
    let limiter: RemoteAuthRateLimiter
    let api: RemoteAccessEndpoints

    init(name: String) {
        store = RemoteIdentityStore()
        sink = GateCollectSink()
        audit = RemoteAuditLog(sink)
        limiter = RemoteAuthRateLimiter()
        api = RemoteAccessEndpoints(store, audit, limiter, "inst-access")
        dropFile(name)
    }

    // 本地管理入口创建登记秘密（设计 §4.2：这一步不经网络）。
    func secret(principalId: String): EnrollmentSecret { store.createEnrollmentSecret(principalId) }

    func enrollBody(s: EnrollmentSecret): String {
        "{\"enrollmentSecret\":\"${s.value}\",\"deviceName\":\"dev-1\",\"kind\":\"mobile\"}"
    }

    func tokenBody(deviceId: String, credential: String): String {
        "{\"deviceId\":\"${deviceId}\",\"credential\":\"${credential}\"}"
    }
}

@Test
func enrollWithUnknownSecretRejected() {
    let f = AccessFixture("e1")
    let resp = f.api.enroll("{\"enrollmentSecret\":\"00112233445566778899aabbccddeeff\",\"deviceName\":\"d\",\"kind\":\"mobile\"}", "127.0.0.1")
    @Expect(resp.status == Int64(401), true)
    // 归一原因，不区分不存在/已消费/已过期。
    @Expect((resp.body.indexOf("invalid-enrollment") ?? Int64(-1)) >= Int64(0), true)
    @Expect(f.sink.size() == Int64(1), true)
}

@Test
func enrollConsumesSecretOnce() {
    let f = AccessFixture("e2")
    let s = f.secret("p-1")
    let first = f.api.enroll(f.enrollBody(s), "127.0.0.1")
    @Expect(first.status == Int64(200), true)
    let second = f.api.enroll(f.enrollBody(s), "127.0.0.1")
    @Expect(second.status == Int64(401), true)
}

@Test
func enrollOverBodyLimitRejected() {
    let f = AccessFixture("e3")
    let s = f.secret("p-1")
    // 把秘密塞进一个超过 16 KiB 的体里：必须 413，且不消费票据。
    var padding = ""
    for (_ in 0..20000) { padding += "a" }
    let resp = f.api.enroll("{\"enrollmentSecret\":\"${s.value}\",\"pad\":\"${padding}\"}", "127.0.0.1")
    @Expect(resp.status == Int64(413), true)
    // 票据没被消费：换个合法体仍能成功。
    let ok = f.api.enroll(f.enrollBody(s), "127.0.0.1")
    @Expect(ok.status == Int64(200), true)
}

@Test
func enrollResponseLeaksNeitherSecretNorDigest() {
    let f = AccessFixture("e4")
    let s = f.secret("p-1")
    let resp = f.api.enroll(f.enrollBody(s), "127.0.0.1")
    @Expect(resp.status == Int64(200), true)
    @Expect((resp.body.indexOf(s.value) ?? Int64(-1)) == Int64(-1), true)
    @Expect((resp.body.indexOf(sha256Hex(s.value.toArray())) ?? Int64(-1)) == Int64(-1), true)
    // 审计同样不得留登记秘密。
    for (i in 0..f.sink.size()) {
        @Expect((f.sink.at(i).indexOf(s.value) ?? Int64(-1)) == Int64(-1), true)
    }
}

@Test
func tokenExchangeThenBearerPassesGate() {
    // 端到端：本地建票 → 网络登记 → 换 token → token 过 gate。
    let f = AccessFixture("e5")
    let s = f.secret("p-1")
    let enrolled = f.api.enroll(f.enrollBody(s), "127.0.0.1")
    @Expect(enrolled.status == Int64(200), true)
    let deviceId = RemoteAccessEndpoints.field(enrolled.body, "deviceId")
    let credential = RemoteAccessEndpoints.field(enrolled.body, "credential")
    let bad = f.api.token(f.tokenBody(deviceId, "deadbeef"), "127.0.0.1")
    @Expect(bad.status == Int64(401), true)
    let got = f.api.token(f.tokenBody(deviceId, credential), "127.0.0.1")
    @Expect(got.status == Int64(200), true)
    let accessToken = RemoteAccessEndpoints.field(got.body, "accessToken")
    @Expect(accessToken.size > Int64(0), true)

    let authorizer = RemoteAccessAuthorizer()
    authorizer.register(CapabilitySpec(
        method: "session/submit", permission: AUTHZ_PERM_WRITE,
        needsWorkspace: true, needsSession: true))
    let gate = RemoteRequestGate(f.store, authorizer, f.audit, "inst-access")
    let out = gate.check("Bearer ${accessToken}", "session/submit", "ws-1", "s-1", "op-1")
    @Expect(out.allowed, true)
}

@Test
func authSourceRateLimitBlocksAfterTen() {
    let f = AccessFixture("e6")
    // 每次换一个秘密：票据失败计数各自独立，确保这里触发的只有「每来源每分钟」这一条。
    var reasons = ""
    var blocked = Int64(0)
    for (i in 0..12) {
        let resp = f.api.enroll(
            "{\"enrollmentSecret\":\"tick${i}0000000000000000000000000\",\"deviceName\":\"d\",\"kind\":\"mobile\"}",
            "10.0.0.9")
        if (resp.status == Int64(429)) { blocked += 1; reasons += resp.body }
    }
    // 前 10 次进窗口（都因票据无效返 401），第 11、12 次被限，且原因必须是限流不是锁票。
    @Expect(blocked == Int64(2), true)
    @Expect((reasons.indexOf("rate-limited") ?? Int64(-1)) >= Int64(0), true)
    @Expect((reasons.indexOf("ticket-locked") ?? Int64(-1)) == Int64(-1), true)
}

@Test
func authRateLimitKeepsSecretsOutOfAudit() {
    let f = AccessFixture("e7")
    let s = f.secret("p-1")
    for (_ in 0..12) { f.api.enroll(f.enrollBody(s), "10.0.0.10") }
    // 被限流的尝试也应落审计（限流是安全事件），但一条都不许带秘密。
    @Expect(f.sink.size() > Int64(0), true)
    for (i in 0..f.sink.size()) {
        @Expect((f.sink.at(i).indexOf(s.value) ?? Int64(-1)) == Int64(-1), true)
    }
}

@Test
func ticketFailuresLockAfterFiveAttempts() {
    // 同一个秘密连续失败 5 次后，第 6 次不再返 401 而返 429 ticket-locked。
    // 抗的是「已泄露的登记秘密被反复重放试探」；计数按提交值摘要键控，
    // 所以换一个秘密就打不动这条票据的计数。
    let f = AccessFixture("e8")
    let repeated = "{\"enrollmentSecret\":\"aaaa00000000000000000000000000aa\",\"deviceName\":\"d\",\"kind\":\"mobile\"}"
    var last = ""
    for (_ in 0..5) { last = f.api.enroll(repeated, "10.5.5.5").body }
    @Expect((last.indexOf("invalid-enrollment") ?? Int64(-1)) >= Int64(0), true)
    let sixth = f.api.enroll(repeated, "10.5.5.5")
    @Expect(sixth.status == Int64(429), true)
    @Expect((sixth.body.indexOf("ticket-locked") ?? Int64(-1)) >= Int64(0), true)
    // 锁定只针对该票据：另一个秘密仍正常返 401，不被牵连。
    let other = f.api.enroll(
        "{\"enrollmentSecret\":\"bbbb00000000000000000000000000bb\",\"deviceName\":\"d\",\"kind\":\"mobile\"}",
        "10.5.5.6")
    @Expect(other.status == Int64(401), true)
    // 合法秘密也不会被别人的失败计数误锁。
    let s = f.secret("p-1")
    let ok = f.api.enroll(f.enrollBody(s), "10.5.5.7")
    @Expect(ok.status == Int64(200), true)
}

@Test
func instanceIdStableAcrossReload() {
    let p = tmpPath("inst")
    dropFile("inst")
    let a = RemoteInstanceIdentity.loadOrCreate(p)
    let b = RemoteInstanceIdentity.loadOrCreate(p)
    // 重启不变：同一文件第二次读到的必须是同一个 id，不能每次新生成。
    @Expect(a.instanceId == b.instanceId, true)
    @Expect(a.instanceId.size == Int64(32), true)
    dropFile("inst")
}

@Test
func instanceIdUnwritableFailsLoud() {
    // 指向一个不存在的目录：写不进去必须抛，不能悄悄用内存里的临时 id 起来。
    let p = "${getTempDirectory().toString()}/no-such-dir-9f3a/instance.id"
    let threw = try {
        RemoteInstanceIdentity.loadOrCreate(p)
        false
    } catch (_: Exception) { true }
    @Expect(threw, true)
}

@Test
func fileAuditSinkWritesRealFileAndScansClean() {
    let p = tmpPath("audit.log")
    dropFile("audit.log")
    let sink = FileAuditSink(p)
    let audit = RemoteAuditLog(sink)
    let secret = "0123456789abcdef0123456789abcdef"
    // 允许 + 拒绝各一条；拒绝条目带 denyReason。
    @Expect(audit.record(AuditEntry(ts: Int64(1), principalId: "p-1", deviceId: "d-1",
        instanceId: "i-1", workspaceId: "ws-1", sessionId: "s-1",
        method: "session/submit", operationId: "op-1", outcome: "allowed")), true)
    @Expect(audit.record(AuditEntry(ts: Int64(2), principalId: "p-1", deviceId: "d-1",
        instanceId: "i-1", workspaceId: "", sessionId: "",
        method: "auth/enroll", operationId: "", outcome: "denied",
        denyReason: "invalid-enrollment")), true)
    @Expect(sink.writtenCount() == Int64(2), true)

    // 遍历真实落盘文件：谁/何时/什么都要在，秘密一个都不能在。
    let text = try { String.fromUtf8(File.readFrom(Path(p))) } catch (_: Exception) { "" }
    @Expect((text.indexOf("\"outcome\":\"allowed\"") ?? Int64(-1)) >= Int64(0), true)
    @Expect((text.indexOf("\"outcome\":\"denied\"") ?? Int64(-1)) >= Int64(0), true)
    @Expect((text.indexOf("session/submit") ?? Int64(-1)) >= Int64(0), true)
    @Expect((text.indexOf(secret) ?? Int64(-1)) == Int64(-1), true)
    @Expect((text.indexOf("\"token\"") ?? Int64(-1)) == Int64(-1), true)
    @Expect((text.indexOf("\"credential\"") ?? Int64(-1)) == Int64(-1), true)
    dropFile("audit.log")
}

@Test
func fileAuditSinkFailureIsNotReportedAsWritten() {
    // 路径不可写 → append 必须返回 false，RemoteAuditLog.record 不能算成功。
    let sink = FileAuditSink("${getTempDirectory().toString()}/no-such-dir-9f3a/audit.log")
    @Expect(sink.append("{\"x\":\"1\"}"), false)
    @Expect(sink.writtenCount() == Int64(0), true)
    let audit = RemoteAuditLog(sink)
    @Expect(audit.count() == Int64(0), true)
}

@Test
func configDisabledNeedsNoTlsOrPolicy() {
    let cfg = RemoteAccessConfig(enabled: false, bind: "127.0.0.1", identityPath: "", certPath: "", keyPath: "", policyPath: "")
    @Expect(cfg.validate().isNone(), true)
}

@Test
func configEnabledWithoutIdentityFails() {
    let cfg = RemoteAccessConfig(enabled: true, bind: "127.0.0.1", identityPath: "", certPath: "", keyPath: "", policyPath: "policy.json")
    let reason = cfg.validate()
    @Expect((reason.isSome()) && (reason.getOrThrow() == "remote-identity-path-required"), true)
}

@Test
func configEnabledWithoutPolicyFails() {
    let cfg = RemoteAccessConfig(enabled: true, bind: "127.0.0.1", identityPath: "id", certPath: "", keyPath: "", policyPath: "")
    let reason = cfg.validate()
    @Expect((reason.isSome()) && (reason.getOrThrow() == "remote-policy-path-required"), true)
}

@Test
func configLoopbackWithPolicyPassesWithoutTls() {
    // 回环可以不带 TLS（本机接入开关场景）；但策略文件必须真实存在。
    let p = tmpPath("policy.json")
    let wrote = try { File.writeTo(Path(p), "{}".toArray()); true } catch (_: Exception) { false }
    @Expect(wrote, true)
    let cfg = RemoteAccessConfig(enabled: true, bind: "127.0.0.1", identityPath: "id", certPath: "", keyPath: "", policyPath: p)
    @Expect(cfg.validate().isNone(), true)
    let cfg2 = RemoteAccessConfig(enabled: true, bind: "127.0.0.1", identityPath: "id", certPath: "", keyPath: "", policyPath: tmpPath("missing.json"))
    @Expect((cfg2.validate().isSome()) && (cfg2.validate().getOrThrow() == "remote-policy-file-missing"), true)
    dropFile("policy.json")
}

@Test
func configExternalBindRequiresTlsFiles() {
    let policy = tmpPath("policy2.json")
    @Expect(try { File.writeTo(Path(policy), "{}".toArray()); true } catch (_: Exception) { false }, true)
    // 非回环 + 无 TLS → 拒。
    let noTls = RemoteAccessConfig(enabled: true, bind: "0.0.0.0", identityPath: "id", certPath: "", keyPath: "", policyPath: policy)
    @Expect((noTls.validate().isSome()) && (noTls.validate().getOrThrow() == "tls-required-for-external-bind"), true)
    // 声明了路径但文件不存在 → 仍然拒（不能只查非空）。
    let missing = RemoteAccessConfig(enabled: true, bind: "0.0.0.0", identityPath: "id", certPath: "no-cert.pem", keyPath: "no-key.pem", policyPath: policy)
    @Expect((missing.validate().isSome()) && (missing.validate().getOrThrow() == "tls-files-missing"), true)
    let cert = tmpPath("c.pem")
    let key = tmpPath("k.pem")
    @Expect(try { File.writeTo(Path(cert), "c".toArray()); true } catch (_: Exception) { false }, true)
    @Expect(try { File.writeTo(Path(key), "k".toArray()); true } catch (_: Exception) { false }, true)
    let ok = RemoteAccessConfig(enabled: true, bind: "0.0.0.0", identityPath: "id", certPath: cert, keyPath: key, policyPath: policy)
    @Expect(ok.validate().isNone(), true)
    dropFile("policy2.json")
    dropFile("c.pem")
    dropFile("k.pem")
}

@Test
func configDefaultsToDisabledLoopback() {
    // 环境变量缺省时：关闭 + 回环。这是「接入开关默认关闭、回环监听」的落点。
    let cfg = RemoteAccessConfig.fromEnvironment()
    @Expect(cfg.enabled, false)
    @Expect(cfg.bind == "127.0.0.1", true)
    @Expect(cfg.isLoopback(), true)
}

@Test
func policyLoadCarriesDurableOntoTheRegisteredSpec() {
    // 幂等账只对契约里标了 durable 的写操作建账。daemon 不再自己维护第二份
    // 写操作名单——两份清单迟早漂移（契约 59 条 durable 就是靠这一条通道生效的）。
    let policy = tmpPath("policy-durable.json")
    let rows = "[{\"method\":\"task/start\",\"permission\":\"execute\"," +
        "\"resourceKeys\":[\"workspaceId\",\"sessionId\"],\"durable\":true}," +
        "{\"method\":\"session/projection\",\"permission\":\"read\"," +
        "\"resourceKeys\":[\"workspaceId\",\"sessionId\"],\"durable\":false}]"
    @Expect(try { File.writeTo(Path(policy), rows.toArray()); true } catch (_: Exception) { false }, true)
    let authorizer = RemoteAccessAuthorizer()
    @Expect(RemotePolicyLoader.load(policy, authorizer).isNone(), true)
    @Expect(authorizer.specOf("task/start").getOrThrow().durable, true)
    @Expect(authorizer.specOf("session/projection").getOrThrow().durable, false)
    @Expect(authorizer.specOf("nope/nope").isNone(), true)
    dropFile("policy-durable.json")
}

@Test
func policyLoadRejectsRowWithoutExplicitDurable() {
    // 漏配 durable 不能当成「这条不需要幂等」：那正是一条写操作被重放两次的路径，
    // 和「漏配 resourceKeys 就默认放行」是同一类错，所以按整表启动失败处理。
    let policy = tmpPath("policy-nodurable.json")
    let rows = "[{\"method\":\"task/start\",\"permission\":\"execute\"," +
        "\"resourceKeys\":[\"workspaceId\"],\"durable\":true}," +
        "{\"method\":\"session/submit\",\"permission\":\"write\",\"resourceKeys\":[\"workspaceId\"]}]"
    @Expect(try { File.writeTo(Path(policy), rows.toArray()); true } catch (_: Exception) { false }, true)
    let authorizer = RemoteAccessAuthorizer()
    let reason = RemotePolicyLoader.load(policy, authorizer)
    @Expect((reason.isSome()) && ((reason.getOrThrow().indexOf("durable") ?? Int64(-1)) >= Int64(0)), true)
    dropFile("policy-nodurable.json")
}
