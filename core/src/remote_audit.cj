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

// 禁用键串的两种形态：顶层 `"key"`，以及字段值经 jsonEscape 后的 `\"key\"`。
// 后者才是攻击面——把整段 JSON 塞进 operationId 就会走这条。
let AUDIT_BANNED_KEYS = ["\"token\"", "\"secret\"", "\"credential\"", "\"authorization\"", "\"params\"", "\"body\""]
let AUDIT_BANNED_ESCAPED = ["\\\"token\\\"", "\\\"secret\\\"", "\\\"credential\\\"", "\\\"authorization\\\"", "\\\"params\\\"", "\\\"body\\\""]

func auditContainsBanned(text: String): Bool {
    for (banned in AUDIT_BANNED_ESCAPED) {
        if ((text.indexOf(banned) ?? Int64(-1)) >= Int64(0)) { return true }
    }
    return false
}

// 值级脱敏：自由文本字段里嵌了禁用键串时，只把**那一个字段**换成带字段名的占位标记。
//
// 为什么不是「整条丢弃」：workspaceId/sessionId/operationId/approvalRef 都是从调用方
// params 里取的任意字符串，丢弃意味着任何想少留痕的调用方只要把这些字段写成含
// `"credential"` 的内容，这次授权判定在审计里就**不存在**。规格要求的是两条同时成立
// ——「审计保存 who/when/what/result」与「日志不含登记秘密」；只满足后者等于把
// 前者送给了对手。标记里带字段名是为了事后还能判断是哪一层塞进来的。
//
// 哪些字段进来、哪些不进（这条必须写清，否则下一个人会以为「自由文本」是个含糊分类）：
//   - workspaceId / sessionId / operationId：/rpc 面第一道是 RemoteRequestGate.sanitizeId
//     （越字符集整串换成 sanitized-invalid），这里只是第二道，兜住不走门禁的直接调用方。
//   - deviceId：**没有第一道**。设备 id 由 `${deviceName}-${序号}` 构成
//     （remote_identity.cj:215，deviceName 是登记请求体里的客户端串），
//     /auth/token 的失败条目更把请求体里的 deviceId 原文直接写进审计
//     （remote_access.cj:291）。实测 wire 用例：注入后那条认证失败审计整条消失，
//     应答还变成 {"error":"audit-serialization-leak"}——既抹掉探测痕迹，
//     又把「注入奏效」回显给攻击者，而且那台设备永远登记不上（登记应答被拖成 400）。
//   - approvalRef / denyReason：一并纳入，审批引用与拒因同样可能是调用方给的串。
//   - principalId / instanceId / method 不在其列：principalId 与 instanceId 只由本地
//     管理入口和服务端随机数产生，不是远程输入面；method 在进 gate.check 之前已过
//     RemoteRequestSchema.methodViolation 字符集门禁。把真信息脱成占位符是掩盖不是保护。
func auditRedact(name: String, value: String): String {
    return if (auditContainsBanned(jsonEscape(value))) { "audit-redacted:${name}" } else { value }
}

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

    public init(ts!: Int64, principalId!: String, deviceId!: String, instanceId!: String,
                workspaceId!: String, sessionId!: String, method!: String, operationId!: String,
                outcome!: String, approvalRef!: String = "", denyReason!: String = "") {
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

    // 六个客户端可控字段先过脱敏，再进序列化；理由见 auditRedact 上方那段。
    public func serialize(): String {
        // 脱敏结果先落局部变量：`${...}` 里直接写带 `\"` 的字符串字面量会把插值解析打断
        // （实测 error: unterminated string interpolation），换成先算再插就没这个坑。
        let dev = jsonEscape(auditRedact("deviceId", deviceId))
        let w = jsonEscape(auditRedact("workspaceId", workspaceId))
        let sid = jsonEscape(auditRedact("sessionId", sessionId))
        let oid = jsonEscape(auditRedact("operationId", operationId))
        let ref = jsonEscape(auditRedact("approvalRef", approvalRef))
        let why = jsonEscape(auditRedact("denyReason", denyReason))
        let parts = ArrayList<String>()
        parts.add("\"ts\":${ts}")
        parts.add("\"principalId\":\"${jsonEscape(principalId)}\"")
        parts.add("\"deviceId\":\"${dev}\"")
        parts.add("\"instanceId\":\"${jsonEscape(instanceId)}\"")
        parts.add("\"workspaceId\":\"${w}\"")
        parts.add("\"sessionId\":\"${sid}\"")
        parts.add("\"method\":\"${jsonEscape(method)}\"")
        parts.add("\"operationId\":\"${oid}\"")
        parts.add("\"outcome\":\"${jsonEscape(outcome)}\"")
        if (approvalRef.size > 0) {
            parts.add("\"approvalRef\":\"${ref}\"")
        }
        if (denyReason.size > 0) {
            parts.add("\"denyReason\":\"${why}\"")
        }
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

    // 落一条审计。字段级脱敏已在 serialize 里做完，这里剩下的检查是**兜底断言**：
    // 白名单字段序列化产物里仍不许出现禁用键串（顶层 `"key"` 或转义后的 `\"key\"`）。
    // 正常情况下它不该触发——触发说明出现了脱敏没覆盖到的新字段，那时宁可拒落盘，
    // 也不能把未知形态的秘密写进日志。计数与异常都保留，就是为了这种情况能被发现。
    public func record(entry: AuditEntry): Bool {
        let line = entry.serialize()
        for (banned in AUDIT_BANNED_KEYS) {
            if ((line.indexOf(banned) ?? Int64(-1)) >= Int64(0)) {
                lock.lock()
                rejectedBySerialization += 1
                lock.unlock()
                throw Exception("audit-serialization-leak")
            }
        }
        for (banned in AUDIT_BANNED_ESCAPED) {
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
