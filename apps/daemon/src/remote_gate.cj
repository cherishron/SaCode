package daemon

import core.*
import std.sync.*
import std.time.*

// 远程接入的门面：把 RemoteIdentityStore / RemoteAccessAuthorizer /
// RemoteAuditLog 三块拼成「一句请求 → 一条决定」，daemon.cj 只在 /rpc
// 与 /sse 的 handler 头部各调一次 gate.check(...)，不复制粘贴安全逻辑。
//
// 硬约束（对应 docs/superpowers/specs/2026-10-10-unified-remote-mobile-design.md §5）：
//   - 任何请求都必须先认证，未认证的 token 直接拒且落一条审计，不落参数原文。
//   - 认证通过后走 per-method 授权；scope 缺失或 workspace/session 越权各归各原因。
//   - 允许与拒绝**都**要写审计；写失败（sink 落盘 false）不能把请求放行。
//   - 不新增独立部署的 PC 桥；本文件只做请求入口层，不接管 HTTP 服务器。

public class GateOutcome {
    public let allowed: Bool
    public let denyReason: String       // allowed=false 时非空
    public let context: Option<AuthenticationContext>
    public init(allowed: Bool, denyReason: String, context: Option<AuthenticationContext>) {
        this.allowed = allowed
        this.denyReason = denyReason
        this.context = context
    }
}

public class RemoteRequestGate {
    let identity: RemoteIdentityStore
    let authorizer: RemoteAccessAuthorizer
    let audit: RemoteAuditLog
    let instanceId: String
    // 设备快照路径：带上它时，每次认证前先看磁盘有没有被带外管理入口改过
    // （--manage revoke-device）。不带它则纯内存语义，测试夹具照旧。
    let snapshotPath: String
    let base = MonoTime.now()
    let lock = Mutex()

    public init(identity: RemoteIdentityStore, authorizer: RemoteAccessAuthorizer,
                audit: RemoteAuditLog, instanceId: String, snapshotPath!: String = "") {
        this.identity = identity
        this.authorizer = authorizer
        this.audit = audit
        this.instanceId = instanceId
        this.snapshotPath = snapshotPath
    }

    func nowMs(): Int64 {
        return (MonoTime.now() - base).toMilliseconds()
    }

    // 从 "Bearer <token>" 剥离 token。Bearer 前缀大小写敏感（RFC 6750 §2.1），
    // 不匹配前缀一律视作未认证；空串返回给调用方做统一分支。
    // headerValue[7..size] 落在 UTF-8 边界，因为前 7 字节 ASCII 已被 startsWith 保证。
    static func extractBearer(headerValue: String): String {
        if (headerValue.size <= 7) { return "" }
        if (!headerValue.startsWith("Bearer ")) { return "" }
        return headerValue[7..headerValue.size]
    }

    // 归属字段是客户端可控字符串，序列化后若拼出被禁键串（如 workspaceId 写成
    // `x","token"`），整条审计会被 RemoteAuditLog.record() 拒落——攻击者就能靠构造
    // 标识符让「越权尝试」不进审计。这里先按标识符字符集净化，越界整串换成固定标记，
    // 保证审计既不漏记也不被投毒；上限 64 与身份存储的 id 形状一致。
    public static func sanitizeId(raw: String): String {
        if (raw.size == 0) { return "" }
        for (b in raw.toArray()) {
            let ok = (b >= 48 && b <= 57) || (b >= 65 && b <= 90) || (b >= 97 && b <= 122)
                || b == 45 || b == 46 || b == 58 || b == 95 || b == 47
            if (!ok) { return "sanitized-invalid" }
        }
        if (raw.size > 64) { return raw[0..64] }
        return raw
    }

    // 判定栈：认证 → 授权 → 审计；任一步失败返回拒绝并已经写完审计。
    public func check(authHeader: String, method: String, workspaceId: String,
                      sessionId: String, operationId: String): GateOutcome {
        // 认证前吸收带外撤销：管理入口在 daemon 之外把某台设备标成 revoked 后，
        // 它的令牌必须从下一个请求起就被拒，而不是等 daemon 重启。
        identity.refreshFromDisk(snapshotPath)
        let ws = RemoteRequestGate.sanitizeId(workspaceId)
        let sid = RemoteRequestGate.sanitizeId(sessionId)
        let op = RemoteRequestGate.sanitizeId(operationId)
        let token = extractBearer(authHeader)
        if (token.size == 0) {
            recordDenied("", "", method, ws, sid, op, "unauthenticated-missing-bearer")
            return GateOutcome(false, "missing-bearer", None)
        }
        let ctx = identity.authenticate(token)
        if (let Some(c) <- ctx) {
            // 远程执行门禁：认证通过、但这台实例没有 OS 强制执行能力时，契约里标 execute
            // 那一族在建账与转宿主之前就拒（规格 §7「沙箱失败不得通过用户批准绕过」）。
            // 放在 scope/归属判定之前，是为了让「这台机器现在能不能安全执行」先于
            // 「你有没有这个权限」——否则客户端拿到的是 scope-required，会误以为
            // 申请个权限就能远程跑代码。未认证的请求仍只拿到认证拒因，不透露策略差异。
            let enforcement = RemoteSandboxEnforcement.current()
            var permission = ""
            if (let Some(spec) <- authorizer.specOf(method)) { permission = spec.permission }
            let refuse = refusalReason(permission, enforcement.enforcing)
            if (refuse != "") {
                recordDenied(c.deviceId, c.principalId, method, ws, sid, op, refuse)
                return GateOutcome(false, refuse, ctx)
            }
            let view = DeviceAuthzView(c)
            let decision = authorizer.check(view, method, ws, sid)
            if (decision.allowed) {
                recordAllowed(c, method, ws, sid, op)
                return GateOutcome(true, "", ctx)
            }
            recordDenied(c.deviceId, c.principalId, method, ws, sid, op, decision.reason)
            return GateOutcome(false, decision.reason, ctx)
        }
        // 未认证：token 无效/过期/被撤销——三者都归 unauthenticated-invalid。
        // 不透露是哪一种，避免旁路枚举（denied 审计仍记录）。
        recordDenied("", "", method, ws, sid, op, "unauthenticated-invalid")
        return GateOutcome(false, "invalid-token", None)
    }

    // 长连接建立面的认证（设计 §4.2「/rpc、/sse 每次建立/请求都认证」）。
    // SSE 与单次 RPC 的区别是：建立时只能判「这个 token 是不是有效主体」，
    // 逐事件资源过滤在订阅建立后按 context 做（任务 8）。这里返回 context，
    // 让调用方持有它做后续过滤，而不是把权限判定推迟到第一帧。
    public func checkStreamAuth(authHeader: String, operationId: String): GateOutcome {
        identity.refreshFromDisk(snapshotPath)
        let op = RemoteRequestGate.sanitizeId(operationId)
        let token = extractBearer(authHeader)
        if (token.size == 0) {
            recordDenied("", "", "sse/subscribe", "", "", op, "unauthenticated-missing-bearer")
            return GateOutcome(false, "missing-bearer", None)
        }
        let ctx = identity.authenticate(token)
        if (let Some(c) <- ctx) {
            recordAllowed(c, "sse/subscribe", "", "", op)
            return GateOutcome(true, "", ctx)
        }
        recordDenied("", "", "sse/subscribe", "", "", op, "unauthenticated-invalid")
        return GateOutcome(false, "invalid-token", None)
    }

    // 在途流的重新校验（设计 §4「撤销先更新服务端版本，再关闭匹配设备的全部 SSE」）。
    // /sse 建流之后就不再走 check()，所以带外撤销（--manage revoke-device 在另一个进程
    // 改盘）只挡住下一个请求，挡不住已经开着的连接。空闲 tick 上重认一次是唯一能把
    // 撤销送进已建连接的路径。
    // 返回空串表示仍然有效；否则返回该用哪个原因关流。
    // 成功不落审计：这是每秒级心跳，落审计会把审计面变成心跳表。
    // 失败落一条 denied 并带上这条流当初认证到的设备，让「这次撤销断了几条流」可查。
    public func revalidateStreamEndReason(authHeader: String, deviceId!: String = ""): String {
        identity.refreshFromDisk(snapshotPath)
        var endReason = SSE_CLOSE_EXPIRED
        let token = extractBearer(authHeader)
        if (token.size == 0) {
            endReason = SSE_CLOSE_REVOKED
        } else {
            if (let Some(_) <- identity.authenticate(token)) { return "" }
            // 认不过有两种：设备被撤，或者令牌到期/丢了。认证面本身故意不区分（防枚举），
            // 但关流原因必须区分——客户端对这两种的恢复动作相反。
            // 这里只用公开的设备清单判「还在不在、有没有被撤」，不去猜令牌内部状态。
            if (!deviceIsRevokedOrGone(deviceId)) { endReason = SSE_CLOSE_EXPIRED } else { endReason = SSE_CLOSE_REVOKED }
        }
        recordDenied(deviceId, "", "sse/stream-revalidate", "", "", "", "stream-${endReason}")
        return endReason
    }

    // 清单里没有这台设备，或清单里它已 revoked，都按撤销处理。
    func deviceIsRevokedOrGone(deviceId: String): Bool {
        if (deviceId.size == Int64(0)) { return true }
        var found = false
        for (d in identity.listDevices()) {
            if (d.deviceId == deviceId) {
                found = true
                if (d.revoked) { return true }
            }
        }
        return !found
    }

    func recordAllowed(c: AuthenticationContext, method: String, workspaceId: String,                       sessionId: String, operationId: String) {
        let entry = AuditEntry(ts: nowMs(),
            principalId: c.principalId, deviceId: c.deviceId, instanceId: instanceId,
            workspaceId: workspaceId, sessionId: sessionId, method: method,
            operationId: operationId, outcome: "allowed")
        audit.record(entry)
    }

    // 拒绝也必须记全 who/when/what：未认证的条目 principalId/deviceId 为空，
    // 但 attempted 的 workspace/session/operation 仍要落盘，否则事后无法还原
    // 「哪个设备试图访问哪个会话」。
    func recordDenied(deviceId: String, principalId: String, method: String,
                      workspaceId: String, sessionId: String, operationId: String,
                      reason: String) {
        let entry = AuditEntry(ts: nowMs(),
            principalId: principalId, deviceId: deviceId, instanceId: instanceId,
            workspaceId: workspaceId, sessionId: sessionId, method: method,
            operationId: operationId, outcome: "denied", denyReason: reason)
        audit.record(entry)
    }
}
