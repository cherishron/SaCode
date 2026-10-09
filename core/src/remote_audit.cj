package core

import std.collection.*
import std.sync.*

// 远程接入审计：who/when/what/result 落盘，绝不泄漏凭据原文/token/登记秘密/模型密钥。
//
// 契约（对应 docs/superpowers/specs/2026-10-10-unified-remote-mobile-design.md §5）：
//   - 每条审计是**结构化字段**序列化成一行 JSON；字段是白名单，
//     调用方塞进来的任何非白名单字段（token/credential/params/body）
//     在序列化层就消失。
//   - outcome 是闭集：allowed / denied / unauthenticated / revoked / error。
//   - 拒绝记录必须与授权记录同层落盘，禁止只留成功侧、抹去失败侧。
//   - 具体落到哪儿由 AuditSink 决定；本模块不假设文件/网络后端。
//     生产实现由 daemon 装配时提供 FileAuditSink 或 RemoteAuditSink；
//     测试用 MemoryAuditSink 直接断言 sink 收到的内容。

public const AUDIT_OUTCOME_ALLOWED: String = "allowed"
public const AUDIT_OUTCOME_DENIED: String = "denied"
public const AUDIT_OUTCOME_UNAUTHENTICATED: String = "unauthenticated"
public const AUDIT_OUTCOME_REVOKED: String = "revoked"
public const AUDIT_OUTCOME_ERROR: String = "error"

func jsonEscape(s: String): String {
    let out = ArrayList<Byte>()
    for (b in s.toArray()) {
        if (b == 34) { out.add(UInt8(92)); out.add(UInt8(34)) }
        else if (b == 92) { out.add(UInt8(92)); out.add(UInt8(92)) }
        else if (b == 10) { out.add(UInt8(92)); out.add(UInt8(110)) }
        else if (b == 13) { out.add(UInt8(92)); out.add(UInt8(114)) }
        else if (b == 9) { out.add(UInt8(92)); out.add(UInt8(116)) }
        else { out.add(b) }
    }
    return String.fromUtf8(out.toArray())
}

public class AuditEntry {
    public let ts: Int64
    public let principalId: String
    public let deviceId: String
    public let instanceId: String
    public let workspaceId: String
    public let sessionId: String
    public let method: String
    public let operationId: String
    public let outcome: String
    public let approvalRef: String     // 空串表示无关联审批
    public let denyReason: String      // outcome=denied/revoked/unauthenticated 时的原因；其他情况空串

    public init(ts: Int64, principalId: String, deviceId: String, instanceId: String,
                workspaceId: String, sessionId: String, method: String, operationId: String,
                outcome: String, approvalRef!: String = "", denyReason!: String = "") {
        this.ts = ts
        this.principalId = principalId
        this.deviceId = deviceId
        this.instanceId = instanceId
        this.workspaceId = workspaceId
        this.sessionId = sessionId
        this.method = method
        this.operationId = operationId
        this.outcome = outcome
        this.approvalRef = approvalRef
        this.denyReason = denyReason
    }

    public func serialize(): String {
        let parts = ArrayList<String>()
        parts.add("\"ts\":${ts}")
        parts.add("\"principalId\":\"${jsonEscape(principalId)}\"")
        parts.add("\"deviceId\":\"${jsonEscape(deviceId)}\"")
        parts.add("\"instanceId\":\"${jsonEscape(instanceId)}\"")
        parts.add("\"workspaceId\":\"${jsonEscape(workspaceId)}\"")
        parts.add("\"sessionId\":\"${jsonEscape(sessionId)}\"")
        parts.add("\"method\":\"${jsonEscape(method)}\"")
        parts.add("\"operationId\":\"${jsonEscape(operationId)}\"")
        parts.add("\"outcome\":\"${jsonEscape(outcome)}\"")
        if (approvalRef.size > 0) { parts.add("\"approvalRef\":\"${jsonEscape(approvalRef)}\"") }
        if (denyReason.size > 0) { parts.add("\"denyReason\":\"${jsonEscape(denyReason)}\"") }
        var joined = ""
        var first = true
        for (p in parts) {
            if (first) { joined = p; first = false } else { joined = "${joined},${p}" }
        }
        return "{${joined}}"
    }
}

public interface AuditSink {
    func append(line: String): Bool
    func flush(): Bool
}

public class RemoteAuditLog {
    let sink: AuditSink
    let lock = Mutex()
    var totalAppended: Int64 = 0
    var rejectedBySerialization: Int64 = 0

    public init(sink: AuditSink) {
        this.sink = sink
    }

    // 落一条审计。白名单字段序列化产物里绝不允许出现禁用键串；
    // 若某字段值里嵌了禁词（有人把 denyReason 写成含 "credential" 键串），
    // 本条被拒并计入 rejectedBySerialization，不落盘。
    public func record(entry: AuditEntry): Bool {
        let line = entry.serialize()
        for (banned in ["\"token\"", "\"secret\"", "\"credential\"", "\"authorization\"", "\"params\"", "\"body\""]) {
            if ((line.indexOf(banned) ?? Int64(-1)) >= Int64(0)) {
                lock.lock()
                rejectedBySerialization += 1
                lock.unlock()
                throw Exception("audit-serialization-leak")
            }
        }
        let ok = sink.append(line)
        if (ok) {
            lock.lock()
            totalAppended += 1
            lock.unlock()
        }
        return ok
    }

    public func flush(): Bool { sink.flush() }

    public func count(): Int64 {
        lock.lock()
        let n = totalAppended
        lock.unlock()
        return n
    }

    public func rejectedCount(): Int64 {
        lock.lock()
        let n = rejectedBySerialization
        lock.unlock()
        return n
    }
}
