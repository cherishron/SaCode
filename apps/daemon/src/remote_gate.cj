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
    let base = MonoTime.now()
    let lock = Mutex()

    public init(identity: RemoteIdentityStore, authorizer: RemoteAccessAuthorizer,
                audit: RemoteAuditLog, instanceId: String) {
        this.identity = identity
        this.authorizer = authorizer
        this.audit = audit
        this.instanceId = instanceId
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

    // 判定栈：认证 → 授权 → 审计；任一步失败返回拒绝并已经写完审计。
    public func check(authHeader: String, method: String, workspaceId: String,
                      sessionId: String, operationId: String): GateOutcome {
        let token = extractBearer(authHeader)
        if (token.size == 0) {
            recordDenied("", "", method, operationId, "unauthenticated-missing-bearer")
            return GateOutcome(false, "missing-bearer", None)
        }
        let ctx = identity.authenticate(token)
        if (let Some(c) <- ctx) {
            let view = DeviceAuthzView(c)
            let decision = authorizer.check(view, method, workspaceId, sessionId)
            if (decision.allowed) {
                recordAllowed(c, method, workspaceId, sessionId, operationId)
                return GateOutcome(true, "", ctx)
            }
            recordDenied(c.deviceId, c.principalId, method, operationId, decision.reason)
            return GateOutcome(false, decision.reason, ctx)
        }
        // 未认证：token 无效/过期/被撤销——三者都归 unauthenticated-invalid。
        // 不透露是哪一种，避免旁路枚举（denied 审计仍记录）。
        recordDenied("", "", method, operationId, "unauthenticated-invalid")
        return GateOutcome(false, "invalid-token", None)
    }

    func recordAllowed(c: AuthenticationContext, method: String, workspaceId: String,
                       sessionId: String, operationId: String) {
        let entry = AuditEntry(ts: nowMs(),
            principalId: c.principalId, deviceId: c.deviceId, instanceId: instanceId,
            workspaceId: workspaceId, sessionId: sessionId, method: method,
            operationId: operationId, outcome: "allowed")
        audit.record(entry)
    }

    func recordDenied(deviceId: String, principalId: String,
                      method: String, operationId: String, reason: String) {
        let entry = AuditEntry(ts: nowMs(),
            principalId: principalId, deviceId: deviceId, instanceId: instanceId,
            workspaceId: "", sessionId: "", method: method,
            operationId: operationId, outcome: "denied", denyReason: reason)
        audit.record(entry)
    }
}
