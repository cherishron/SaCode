package daemon
import core.*

import std.unittest.*
import std.collection.*

func lineContains(line: String, needle: String): Bool {
    return (line.indexOf(needle) ?? Int64(-1)) >= Int64(0)
}

// 内存版 sink，测试专用；每次 append 落进 ArrayList，flush 返回可断言的落盘条数。
class MemoryAuditSink <: AuditSink {
    let lines = ArrayList<String>()
    var flushCalls: Int64 = 0
    var failNextFlush = false

    public func append(line: String): Bool {
        lines.add(line)
        return true
    }

    public func flush(): Bool {
        flushCalls += 1
        if (failNextFlush) { failNextFlush = false; return false }
        return true
    }

    public func snapshot(): ArrayList<String> { lines }
}

@Test
func auditRecordAllowedSerializesWhitelistedFields() {
    let sink = MemoryAuditSink()
    let log = RemoteAuditLog(sink)
    let entry = AuditEntry(
        ts: Int64(1700000000000),
        principalId: "p-1",
        deviceId: "d-1",
        instanceId: "i-1",
        workspaceId: "w-1",
        sessionId: "s-1",
        method: "session/submit",
        operationId: "op-1",
        outcome: AUDIT_OUTCOME_ALLOWED
    )
    @Expect(log.record(entry), true)
    @Expect(log.count(), Int64(1))
    let lines = sink.snapshot()
    @Expect(Int64(lines.size), Int64(1))
    let line = lines[0]
    @Expect(lineContains(line, "\"method\":\"session/submit\""), true)
    @Expect(lineContains(line, "\"outcome\":\"allowed\""), true)
    @Expect(lineContains(line, "\"approvalRef\""), false)
    @Expect(lineContains(line, "\"denyReason\""), false)
}

@Test
func auditDeniedRecordsReason() {
    let sink = MemoryAuditSink()
    let log = RemoteAuditLog(sink)
    let entry = AuditEntry(
        ts: Int64(1), principalId: "p", deviceId: "d", instanceId: "i",
        workspaceId: "w", sessionId: "s", method: "credential/set",
        operationId: "op", outcome: AUDIT_OUTCOME_DENIED,
        approvalRef: "", denyReason: "scope-required"
    )
    @Expect(log.record(entry), true)
    let line = sink.snapshot()[0]
    @Expect(lineContains(line, "\"denyReason\":\"scope-required\""), true)
    @Expect(lineContains(line, "\"outcome\":\"denied\""), true)
}

@Test
func auditNeverContainsForbiddenKeyNames() {
    let sink = MemoryAuditSink()
    let log = RemoteAuditLog(sink)
    let entry = AuditEntry(
        ts: Int64(1), principalId: "p", deviceId: "d", instanceId: "i",
        workspaceId: "w", sessionId: "s", method: "auth/token",
        operationId: "op", outcome: AUDIT_OUTCOME_ALLOWED
    )
    @Expect(log.record(entry), true)
    let line = sink.snapshot()[0]
    @Expect(lineContains(line, "\"token\""), false)
    @Expect(lineContains(line, "\"credential\""), false)
    @Expect(lineContains(line, "\"authorization\""), false)
    @Expect(lineContains(line, "\"params\""), false)
    @Expect(lineContains(line, "\"body\""), false)
}

@Test
func auditRedactsValueContainingBannedKeyButKeepsTheEvent() {
    // 与 core/src/remote_audit_test.cj 同名同断言的可运行副本（core 侧链接段本机出不来）。
    // 语义变更（批次 N）：嵌了禁用键串的值不再让整条审计消失，而是只把那个字段的值
    // 换成 audit-redacted:<字段名>。规格要求「审计保存 who/when/what/result」与
    // 「日志不含登记秘密」同时成立——原来的丢弃只守住了后半句，
    // 并让调用方可以自选一个 operationId 把自己的授权尝试抹掉。
    let sink = MemoryAuditSink()
    let log = RemoteAuditLog(sink)
    let entry = AuditEntry(
        ts: Int64(1), principalId: "p", deviceId: "d", instanceId: "i",
        workspaceId: "w", sessionId: "s", method: "m",
        operationId: "op", outcome: AUDIT_OUTCOME_DENIED,
        approvalRef: "", denyReason: "{\"credential\":\"leak\"}"
    )
    var threw = false
    try {
        let _r = log.record(entry)
    } catch (_: Exception) {
        threw = true
    }
    @Expect(threw, false)
    @Expect(log.rejectedCount(), Int64(0))
    @Expect(log.count(), Int64(1))
    @Expect(Int64(sink.snapshot().size), Int64(1))
    let line = sink.snapshot()[0]
    @Expect(lineContains(line, "leak"), false)
    @Expect(lineContains(line, "\\\"credential\\\""), false)
    @Expect(lineContains(line, "\"denyReason\":\"audit-redacted:denyReason\""), true)
    @Expect(lineContains(line, "\"outcome\":\"denied\""), true)
    @Expect(lineContains(line, "\"deviceId\":\"d\""), true)
    @Expect(lineContains(line, "\"operationId\":\"op\""), true)
}

@Test
func auditRedactsInjectedDeviceIdButKeepsServerSideFields() {
    // deviceId 不是「服务端产生的安全字段」：它由登记请求体里的 deviceName 拼出来
    // （remote_identity.cj:215），/auth/token 的失败条目还把请求体的 deviceId 原文
    // 直接写进审计（remote_access.cj:291）。这条钉住两侧：注入的 deviceId 被脱，
    // 而同一行里的真信息一个都不能少——脱敏是字段级的，不是整行丢弃。
    let sink = MemoryAuditSink()
    let log = RemoteAuditLog(sink)
    let entry = AuditEntry(
        ts: Int64(2), principalId: "p", deviceId: "d{\"credential\":\"leak\"}", instanceId: "i",
        workspaceId: "w", sessionId: "s", method: "m",
        operationId: "op", outcome: AUDIT_OUTCOME_DENIED, approvalRef: "", denyReason: "invalid-credential"
    )
    var threw = false
    try {
        let _r = log.record(entry)
    } catch (_: Exception) {
        threw = true
    }
    @Expect(threw, false)
    @Expect(log.rejectedCount(), Int64(0))
    @Expect(log.count(), Int64(1))
    let line = sink.snapshot()[0]
    @Expect(lineContains(line, "leak"), false)
    @Expect(lineContains(line, "\\\"credential\\\""), false)
    @Expect(lineContains(line, "\"deviceId\":\"audit-redacted:deviceId\""), true)
    @Expect(lineContains(line, "\"principalId\":\"p\""), true)
    @Expect(lineContains(line, "\"instanceId\":\"i\""), true)
    @Expect(lineContains(line, "\"denyReason\":\"invalid-credential\""), true)
    @Expect(lineContains(line, "\"outcome\":\"denied\""), true)
}

@Test
func auditEscapesQuotesInFieldValues() {
    let sink = MemoryAuditSink()
    let log = RemoteAuditLog(sink)
    let entry = AuditEntry(
        ts: Int64(1), principalId: "user\"admin", deviceId: "d", instanceId: "i",
        workspaceId: "w", sessionId: "s", method: "m",
        operationId: "op", outcome: AUDIT_OUTCOME_ALLOWED
    )
    @Expect(log.record(entry), true)
    let line = sink.snapshot()[0]
    @Expect(lineContains(line, "\\\"admin"), true)
}

@Test
func auditFlushPropagatesSinkFailure() {
    let sink = MemoryAuditSink()
    let log = RemoteAuditLog(sink)
    log.record(AuditEntry(ts: Int64(1), principalId: "p", deviceId: "d", instanceId: "i", workspaceId: "w", sessionId: "s", method: "m", operationId: "op", outcome: AUDIT_OUTCOME_ALLOWED))
    sink.failNextFlush = true
    @Expect(log.flush(), false)
    @Expect(log.flush(), true)
}
