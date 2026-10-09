package core

import std.unittest.*
import std.collection.*

func lineContains(line: String, needle: Substring): Bool {
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
func auditRejectsValueContainingBannedKey() {
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
    @Expect(threw, true)
    @Expect(log.rejectedCount(), Int64(1))
    @Expect(log.count(), Int64(0))
    @Expect(Int64(sink.snapshot().size), Int64(0))
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
