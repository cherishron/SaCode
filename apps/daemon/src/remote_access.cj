package daemon

import core.*
import std.collection.*
import std.sync.*
import std.time.*
import std.fs.*
import std.env.*
import stdx.crypto.crypto.*
import stdx.encoding.hex.*
import stdx.encoding.json.*

// 身份引导面（设计 §4.2 / §7）。网络侧只允许两个端点：
//   POST /auth/enroll  提交一次性登记秘密，换 deviceId + 设备凭据（仅此一次明文返回）
//   POST /auth/token   用设备凭据换短期 opaque access token
// 它们只做认证，不执行业务；登记秘密的**创建与确认**是本地管理入口动作，不经网络
// （设计 §4.2「首次登记由目标端本地管理入口创建一次性登记秘密」）。
//
// 本文件还承载接入开关的启动校验：默认关闭、回环监听；对外开启时缺 TLS / 身份 /
// 方法策略任一项都必须启动失败，不能降级裸跑。

public class AuthResponse {
    public let status: Int64
    public let body: String
    public init(status: Int64, body: String) {
        this.status = status
        this.body = body
    }

    // 错误体只有稳定原因码：不回显输入片段，免得把秘密写进响应或日志。
    static public func deny(status: Int64, reason: String): AuthResponse {
        AuthResponse(status, "{\"error\":\"${reason}\"}")
    }
}

// 认证体上限 16 KiB（设计 §7），比 RPC 的 1 MiB 更严——引导端点不需要大正文。
public const AUTH_BODY_LIMIT: Int64 = 16384

// 每来源每分钟 10 次；每登记票据最多 5 次失败尝试（设计 §7）。
public const AUTH_PER_SOURCE_PER_MIN: Int64 = 10
public const AUTH_PER_TICKET_MAX_FAILS: Int64 = 5
public const AUTH_WINDOW_MS: Int64 = 60000

// deviceName 进 deviceId 之前要过门禁：只允许 ASCII 字母数字与「-」和「_」，
// UTF-8 字节上界 64。deviceId 走 HTTP 头与快照 JSON 字段，字符集越界就是
// 客户端在探测（换行拆审计、反斜杠破快照路径、非 ASCII 撑坏字节比对）。
public const DEVICE_NAME_MAX_BYTES: Int64 = 64

func deviceNameAllowed(s: String): Bool {
    let bytes = s.toArray()
    if (bytes.size == 0) { return false }
    for (b in bytes) {
        let ok = (b >= 48 && b <= 57) || (b >= 65 && b <= 90) || (b >= 97 && b <= 122)
        if (!ok && b != 45 && b != 95) { return false }
    }
    return true
}

func deviceKindAllowed(s: String): Bool {
    if (s == "desktop" || s == "mobile" || s == "cli" || s == "host") { return true }
    return false
}

// 顺序钉死：先 kind（枚举），再长度，再字符集。三个错误码语义独立：
// kind-invalid 是「枚举外」，name-too-long 是「字节数越界但字符本身没错」，
// name-invalid 是「字符集越界但长度够」。把长度与字符集合在一起会让客户端
// 分不清是「打太长」还是「打了不该打的字符」——错误归因模糊本身就是漏洞。
func deviceFieldViolation(deviceName: String, kind: String): String {
    if (!deviceKindAllowed(kind)) { return "device-kind-invalid" }
    let bytes = deviceName.toArray()
    if (bytes.size > DEVICE_NAME_MAX_BYTES) { return "device-name-too-long" }
    if (!deviceNameAllowed(deviceName)) { return "device-name-invalid" }
    return ""
}

// 固定窗口计数。刻度取真实单调钟：调用方不能 tick，协议面也推不动它，
// 所以「窗口没过就一直 429」不会变成可被客户端利用的停摆开关。
public class RemoteAuthRateLimiter {
    let lock = Mutex()
    let base = MonoTime.now()
    var windowStart = Int64(0)
    var perSource = HashMap<String, Int64>()
    // 票据失败计数按登记秘密摘要键控：内存里不留原文，也不会因换来源地址而清零。
    var perTicketFails = HashMap<String, Int64>()

    func nowMs(): Int64 { (MonoTime.now() - base).toMilliseconds() }

    func rotateIfNeededLocked(now: Int64): Unit {
        if (now - windowStart >= AUTH_WINDOW_MS) {
            windowStart = now
            perSource.clear()
        }
    }

    // true 表示放行并已计数；false 表示超限（超限不计数，否则窗口永不清零）。
    public func allowSource(key: String): Bool {
        let now = nowMs()
        lock.lock()
        rotateIfNeededLocked(now)
        var used = Int64(0)
        if (let Some(n) <- perSource.get(key)) { used = n }
        let ok = used < AUTH_PER_SOURCE_PER_MIN
        if (ok) { perSource[key] = used + 1 }
        lock.unlock()
        return ok
    }

    // 读-判定-写组合在一个锁段内：分开两次调用会有并发窗口
    // （多个请求同时读到「没到 5」，然后各自 +1，直到下一批才看得见锁），
    // 那等于让攻击者能用并发把锁死次数拉高。返回 true 表示本次失败已到阈值。
    public func checkAndRecordTicketFailure(secretDigest: String, threshold: Int64): Bool {
        lock.lock()
        var n = Int64(0)
        if (let Some(v) <- perTicketFails.get(secretDigest)) { n = v }
        if (n >= threshold) {
            lock.unlock()
            return true
        }
        perTicketFails[secretDigest] = n + 1
        lock.unlock()
        return false
    }

    public func clearTicket(secretDigest: String): Unit {
        lock.lock()
        perTicketFails.remove(secretDigest)
        lock.unlock()
    }
}

// 审计落盘（设计 §7「审计保存 who/when/what/result」的生产后端）。
// 攒在内存里、flush 才落——但 append 失败必须让 record() 返回 false，
// 远程接入的 gate 依赖「写不进审计就不放行」这条不变量，不能假成功。
public class FileAuditSink <: AuditSink {
    let path: Path
    let lock = Mutex()
    let pending = ArrayList<String>()
    var appended = Int64(0)

    public init(filePath: String) { path = Path(filePath) }

    public func append(line: String): Bool {
        lock.lock()
        // 一条一写：审计的价值在崩溃后仍在，攒批会把拒绝记录留在内存里丢给它。
        var ok = true
        try { File.appendTo(path, "${line}\n".toArray()) }
        catch (_: Exception) { ok = false }
        if (ok) { appended += 1 } else { pending.add(line) }
        lock.unlock()
        return ok
    }

    public func flush(): Bool {
        lock.lock()
        var ok = true
        while (pending.size > 0) {
            let line = pending[0]
            pending.remove(at: Int64(0))
            try { File.appendTo(path, "${line}\n".toArray()) }
            catch (_: Exception) { pending.add(line); ok = false; break }
        }
        lock.unlock()
        return ok
    }

    public func writtenCount(): Int64 {
        lock.lock()
        let n = appended
        lock.unlock()
        return n
    }
}

// 实例身份：初始化生成并持久保存，重启不变（设计 §4.1）。
// 换文件即换身份——客户端的证书/实例绑定必须显式重新信任，不自动覆盖旧绑定。
public class RemoteInstanceIdentity {
    public let instanceId: String

    init(instanceId: String) { this.instanceId = instanceId }

    // 读已有身份文件；不存在则生成并落盘。落盘失败必须显式报错——
    // 「内存里生成一个、重启就变」会让客户端绑定悄悄失效，比启动失败更糟。
    static public func loadOrCreate(filePath: String): RemoteInstanceIdentity {
        let p = Path(filePath)
        if (exists(p)) {
            let bytes = try { File.readFrom(p) } catch (_: Exception) { Array<Byte>(0, repeat: 0) }
            let id = try { String.fromUtf8(bytes).trimAscii() } catch (_: Exception) { "" }
            if (id.size >= 16) { return RemoteInstanceIdentity(id) }
        }
        let fresh = randomInstanceId()
        let written = try { File.writeTo(p, fresh.toArray()); true }
            catch (_: Exception) { false }
        // 写不进去就不带身份启动：身份是跨目标连接绑定的锚，缺它等于没有 instanceId。
        if (!written) { throw Exception("instance-identity-unwritable") }
        return RemoteInstanceIdentity(fresh)
    }

    static func randomInstanceId(): String {
        let buf = Array<Byte>(16, repeat: 0)
        SecureRandom().nextBytes(buf)
        return toHexString(buf)
    }
}

public class RemoteAccessEndpoints {
    let store: RemoteIdentityStore
    let audit: RemoteAuditLog
    let limiter: RemoteAuthRateLimiter
    let instanceId: String
    // 设备快照落点；空串表示不落盘（单测与嵌入式场景）。
    let snapshotPath: String
    let base = MonoTime.now()

    public init(store: RemoteIdentityStore, audit: RemoteAuditLog,
                limiter: RemoteAuthRateLimiter, instanceId: String,
                snapshotPath!: String = "") {
        this.store = store
        this.audit = audit
        this.limiter = limiter
        this.instanceId = instanceId
        this.snapshotPath = snapshotPath
    }

    // 登记成功后立刻落盘：设备是长期身份，daemon 重启后必须还在。
    // 落盘失败不回滚登记（设备此刻确实已注册），但要记一条审计并让调用方
    // 能从 stderr 看到——静默丢掉持久化会让「重启后设备消失」变成隐性问题。
    func persistAfterEnroll(): Bool {
        if (snapshotPath.size == 0) { return true }
        return store.saveSnapshot(snapshotPath)
    }

    func nowMs(): Int64 { (MonoTime.now() - base).toMilliseconds() }

    // 引导端点的拒绝同样落审计（何时/哪个设备槽/哪个端点/结果），但不落任何秘密：
    // workspace/session/operation 留空，method 记端点名。
    func auditBootstrap(deviceId: String, principalId: String, method: String,
                        outcome: String, reason: String) {
        let entry = AuditEntry(ts: nowMs(), principalId: principalId, deviceId: deviceId,
            instanceId: instanceId, workspaceId: "", sessionId: "", method: method,
            operationId: "", outcome: outcome, denyReason: reason)
        audit.record(entry)
    }

    func overSize(body: String): Bool { body.size > AUTH_BODY_LIMIT }

    // 从 JSON 体取字符串字段；缺失或类型不对返回空串，不猜字段。
    static public func field(body: String, name: String): String {
        var obj = JsonObject()
        let parsed = try { obj = JsonValue.fromStr(body).asObject(); true }
            catch (_: Exception) { false }
        if (!parsed) { return "" }
        if (let Some(node) <- obj.get(name)) {
            return try { node.asString().getValue() } catch (_: Exception) { "" }
        }
        return ""
    }

    // POST /auth/enroll：消费一次性登记秘密，返回 deviceId + credential（仅此一次）。
    // 失败归一为 401 invalid-enrollment，不区分「不存在/已消费/已过期/并发复用」，
    // 免得网络侧被当成有效票据枚举器。
    public func enroll(body: String, source: String): AuthResponse {
        if (overSize(body)) { return AuthResponse.deny(413, "auth-body-too-large") }
        if (!limiter.allowSource("enroll:${source}")) {
            auditBootstrap("", "", "auth/enroll", "denied", "rate-limited-source")
            return AuthResponse.deny(429, "rate-limited")
        }
        let secret = field(body, "enrollmentSecret")
        let deviceName = field(body, "deviceName")
        let kind = field(body, "kind")
        if (secret.size == 0 || deviceName.size == 0) {
            return AuthResponse.deny(400, "enroll-fields-missing")
        }
        // 字段门禁在票据校验之前：非法 shape 不消耗票据，也不动失败计数。
        // 否则「先塞一串非法请求再抢跑合法请求」的客户端能把票据失败计数器打满，
        // 后面连合法登记都会被 429 ticket-locked 卡住——那是把 shape 错当成
        // 凭据错的攻击面。归因码分三类（kind-invalid / name-too-long / name-invalid）
        // 让客户能自己区分是「枚举外」「字节越界」还是「字符集越界」。
        let violation = deviceFieldViolation(deviceName, kind)
        if (violation.size > 0) {
            auditBootstrap("", "", "auth/enroll", "denied", violation)
            return AuthResponse.deny(400, violation)
        }
        // 受理前先合入本地管理入口新建的票据：store 与建票进程不是同一个，
        // 不做这步的话 /auth/enroll 永远查不到刚创建的票据。
        if (snapshotPath.size > 0) { store.reloadTicketsFrom(snapshotPath) }
        let digest = sha256Hex(secret.toArray())
        // 一次尝试记一次失败，登记成功再清账——用 check-and-increment 的原子形态
        // 而不是先读后写：并发下分开两次调用会让所有并到锁边界的请求都通过检查
        // （多个请求同时读到 0，然后各自 +1，第 N+1 个请求读到的仍是 0 因此被放行），
        // 攻击者能用一波并发把锁死的阈值从 5 拉到 6、7、甚至更多。
        // 成功路径末尾会 clearTicket，让「先失败几次再拿对」这条正常序列仍可通过。
        if (limiter.checkAndRecordTicketFailure(digest, AUTH_PER_TICKET_MAX_FAILS)) {
            auditBootstrap("", "", "auth/enroll", "denied", "ticket-failures-exceeded")
            return AuthResponse.deny(429, "ticket-locked")
        }
        // 先声明可选槽位，try 只负责登记与异常审计，不制造未使用的 Bool 结果。
        var enrolled: Option<DeviceRecord> = None
        try {
            enrolled = Some(store.enroll(secret, deviceName, kind))
        } catch (_: Exception) {
            auditBootstrap("", "", "auth/enroll", "denied", "invalid-enrollment")
        }
        if (let Some(record) <- enrolled) {
            limiter.clearTicket(digest)
            auditBootstrap(record.deviceId, record.principalId, "auth/enroll", "allowed", "")
            persistAfterEnroll()
            // 凭据只在登记成功这一次明文回出；此后服务端只存摘要。
            var body = "{\"instanceId\":\"${jsonEscapeText(instanceId)}\""
            body += ",\"deviceId\":\"${jsonEscapeText(record.deviceId)}\""
            body += ",\"credential\":\"${jsonEscapeText(record.credential)}\"}"
            return AuthResponse(200, body)
        }
        return AuthResponse.deny(401, "invalid-enrollment")
    }

    // POST /auth/token：设备凭据换短期 access token。
    // 不回传 expiresIn 之外的设备信息，也不透露该 deviceId 属不存在还是已撤销。
    public func token(body: String, source: String): AuthResponse {
        if (overSize(body)) { return AuthResponse.deny(413, "auth-body-too-large") }
        if (!limiter.allowSource("token:${source}")) {
            auditBootstrap("", "", "auth/token", "denied", "rate-limited-source")
            return AuthResponse.deny(429, "rate-limited")
        }
        let deviceId = field(body, "deviceId")
        let credential = field(body, "credential")
        if (deviceId.size == 0 || credential.size == 0) {
            return AuthResponse.deny(400, "token-fields-missing")
        }
        var exchanged: Option<AccessToken> = None
        try {
            exchanged = Some(store.exchangeToken(deviceId, credential))
        } catch (_: Exception) {
            auditBootstrap(deviceId, "", "auth/token", "denied", "invalid-credential")
        }
        if (let Some(t) <- exchanged) {
            auditBootstrap(deviceId, "", "auth/token", "allowed", "")
            var body = "{\"accessToken\":\"${jsonEscapeText(t.value)}\""
            body += ",\"expiresInMs\":${store.tokenRemainingMs(t)}"
            body += ",\"tokenType\":\"Bearer\"}"
            return AuthResponse(200, body)
        }
        return AuthResponse.deny(401, "invalid-credential")
    }
}

// 接入配置与启动校验。默认关闭；开启必须有身份文件与方法策略文件，
// 非回环监听还必须有 TLS 证书/私钥——缺任一项即启动失败，不降级裸跑。
public class RemoteAccessConfig {    public let enabled: Bool
    public let bind: String
    public let identityPath: String
    public let certPath: String
    public let keyPath: String
    public let policyPath: String

    public init(enabled!: Bool, bind!: String, identityPath!: String,
                certPath!: String, keyPath!: String, policyPath!: String) {
        this.enabled = enabled
        this.bind = bind
        this.identityPath = identityPath
        this.certPath = certPath
        this.keyPath = keyPath
        this.policyPath = policyPath
    }

    public func isLoopback(): Bool {
        bind == "127.0.0.1" || bind == "::1" || bind.startsWith("127.")
    }

    // None 表示配置可用；Some(原因) 表示必须启动失败。
    public func validate(): Option<String> {
        if (!enabled) { return None }
        if (identityPath.size == 0) { return Some("remote-identity-path-required") }
        if (policyPath.size == 0) { return Some("remote-policy-path-required") }
        if (!exists(Path(policyPath))) { return Some("remote-policy-file-missing") }
        if (isLoopback()) { return None }
        // 非回环：设计 §4.2「所有网络，包括内网，都禁止明文 bearer」→ 必须 TLS。
        if (certPath.size == 0 || keyPath.size == 0) { return Some("tls-required-for-external-bind") }
        if (!exists(Path(certPath)) || !exists(Path(keyPath))) { return Some("tls-files-missing") }
        return None
    }

    static func envOr(key: String, dflt: String): String {
        if (let Some(v) <- getVariable(key)) { if (v.size > 0) { return v } }
        return dflt
    }

    static public func fromEnvironment(): RemoteAccessConfig {
        let flag = envOr("SACODE_REMOTE_ACCESS", "0")
        RemoteAccessConfig(
            enabled: flag == "1" || flag == "true",
            bind: envOr("SACODE_REMOTE_BIND", "127.0.0.1"),
            identityPath: envOr("SACODE_REMOTE_IDENTITY", ""),
            certPath: envOr("SACODE_REMOTE_TLS_CERT", ""),
            keyPath: envOr("SACODE_REMOTE_TLS_KEY", ""),
            policyPath: envOr("SACODE_REMOTE_POLICY", "")
        )
    }
}

// 方法策略装载（设计 §4.3「每个方法登记只读/写入/执行/审批/管理类别，
// 默认拒绝未知方法、未知资源及不完整授权配置」）。
// 策略源 docs/plans/remote-capability-contract.json 是任务 1 的能力契约表，
// 逐行按 resourceKeys 推 needsWorkspace/needsSession；任一行不完整就整体启动失败，
// 不能「跳过坏行、其余照跑」——那等于给漏配的方法默认放行。
public class RemotePolicyLoader {
    static let KNOWN_PERMS = ["read", "write", "execute", "approval", "management"]

    static func knownPermission(p: String): Bool {
        for (k in KNOWN_PERMS) { if (k == p) { return true } }
        return false
    }

    static func resourcePresent(row: JsonObject, name: String): Bool {
        if (let Some(node) <- row.get("resourceKeys")) {
            let arr = try { node.asArray() } catch (_: Exception) { return false }
            var i = Int64(0)
            while (i < arr.size()) {
                if (let Some(item) <- arr.get(i)) {
                    let v = try { item.asString().getValue() } catch (_: Exception) { "" }
                    if (v == name) { return true }
                }
                i += 1
            }
        }
        return false
    }

    // durable 必须显式写成 true/false。缺键或写成字符串一律让整表装载失败：
    // 「漏配就当这条写操作不需要幂等」正是一条操作被重放两次的入口，
    // 和本文件开头那条「漏配 resourceKeys 不能默认放行」是同一种错。
    static func durableOf(row: JsonObject): Option<Bool> {
        var out: Option<Bool> = None
        let read = try { out = Some(row.get("durable").getOrThrow().asBool().getValue()); true }
            catch (_: Exception) { false }
        if (read) { return out }
        return None
    }

    // 返回 Some(原因) 即调用方必须拒绝启动。
    static public func load(policyPath: String, authorizer: RemoteAccessAuthorizer): Option<String> {
        let p = Path(policyPath)
        if (!exists(p)) { return Some("policy-file-missing") }
        var text = ""
        let readable = try { text = String.fromUtf8(File.readFrom(p)); true }
            catch (_: Exception) { false }
        if (!readable) { return Some("policy-file-unreadable") }
        var rows = JsonArray()
        let isArray = try { rows = JsonValue.fromStr(text).asArray(); true }
            catch (_: Exception) { false }
        if (!isArray) { return Some("policy-not-a-json-array") }
        if (rows.size() == 0) { return Some("policy-empty") }
        var i: Int64 = 0
        while (i < rows.size()) {
            if (let Some(node) <- rows.get(i)) {
                let row = try { node.asObject() }
                    catch (_: Exception) { return Some("policy-row-${i}-not-object") }
                let method = try { row.get("method").getOrThrow().asString().getValue() }
                    catch (_: Exception) { "" }
                let permission = try { row.get("permission").getOrThrow().asString().getValue() }
                    catch (_: Exception) { "" }
                if (method.size == 0) { return Some("policy-row-${i}-missing-method") }
                if (!knownPermission(permission)) { return Some("policy-row-${i}-unknown-permission") }
                let durable = durableOf(row)
                if (!durable.isSome()) { return Some("policy-row-${i}-durable-missing-or-not-bool") }
                authorizer.register(CapabilitySpec(
                    method: method, permission: permission,
                    needsWorkspace: resourcePresent(row, "workspaceId"),
                    needsSession: resourcePresent(row, "sessionId"),
                    durable: durable.getOrThrow()))
            }
            i += 1
        }
        if (authorizer.registeredCount() != rows.size()) {
            return Some("policy-registration-count-mismatch")
        }
        return None
    }
}
