package core

import std.collection.*
import std.sync.*

// 请求级授权：daemon 处理器在把方法派发到 HostProxy/TeamHost 之前必须过这里。
//
// 契约（docs/superpowers/specs/2026-10-10-unified-remote-mobile-design.md §4.3、§5）：
//   - 未登记的方法一律拒（不透传）——白名单，不是黑名单。
//   - 权限类别是闭集：read / write / execute / approval / management；
//     每个方法登记时归属唯一一类。
//   - 设备作用域是独立维度：普通设备默认只有 read/write；执行工具/审批/管理类
//     要显式启用对应 scope，未启用即拒。
//   - workspace/session 归属由请求参数携带，与 AuthenticationContext 里的
//     allowList 做交集检查；allowList 是 Option，None 代表「未限制」。
//   - 拒因是稳定字符串（deniedReason），处理器据此回 -32001，客户端可断言。
//
// 与身份模块的关系：本模块只消费 AuthenticationContext，不生成/撤销之。
// 与能力契约表的关系：本文件的 register(...) 是唯一注入点；启动装配阶段
// 由 daemon 按 docs/plans/remote-capability-contract.json 把方法灌进来。

public const AUTHZ_PERM_READ: String = "read"
public const AUTHZ_PERM_WRITE: String = "write"
public const AUTHZ_PERM_EXECUTE: String = "execute"
public const AUTHZ_PERM_APPROVAL: String = "approval"
public const AUTHZ_PERM_MANAGEMENT: String = "management"

public const AUTHZ_SCOPE_MANAGEMENT: String = "management"
public const AUTHZ_SCOPE_APPROVAL: String = "approval"
public const AUTHZ_SCOPE_EXECUTE: String = "execute"

public const AUTHZ_REASON_OK: String = ""
public const AUTHZ_REASON_METHOD_NOT_REGISTERED: String = "method-not-registered"
public const AUTHZ_REASON_SCOPE_REQUIRED: String = "scope-required"
public const AUTHZ_REASON_WORKSPACE_NOT_ALLOWED: String = "workspace-not-allowed"
public const AUTHZ_REASON_SESSION_NOT_ALLOWED: String = "session-not-allowed"
public const AUTHZ_REASON_WORKSPACE_REQUIRED: String = "workspace-required"
public const AUTHZ_REASON_SESSION_REQUIRED: String = "session-required"

public class AuthzDecision {
    public let allowed: Bool
    public let reason: String
    public init(allowed: Bool, reason: String) {
        this.allowed = allowed
        this.reason = reason
    }
}

public class CapabilitySpec {
    public let method: String
    public let permission: String
    public let needsWorkspace: Bool
    public let needsSession: Bool
    public init(method!: String, permission!: String, needsWorkspace!: Bool, needsSession!: Bool) {
        this.method = method
        this.permission = permission
        this.needsWorkspace = needsWorkspace
        this.needsSession = needsSession
    }
}

// 设备的授权视图：由 daemon 装配层从身份模块 + 设备登记记录组合出来。
// AuthenticationContext 只有身份（deviceId/principalId/revocationVersion），
// 这里加"作用域"与"资源白名单"两个维度；两者都不落盘，只在单次请求的
// 判定栈里存在。
public class DeviceAuthzView {
    public let context: AuthenticationContext
    public let scopes: HashSet<String>
    public let allowedWorkspaces: Option<HashSet<String>>   // None = 不限制
    public let allowedSessions: Option<HashSet<String>>     // None = 不限制

    public init(context: AuthenticationContext,
                scopes!: HashSet<String> = HashSet<String>(),
                allowedWorkspaces!: Option<HashSet<String>> = None,
                allowedSessions!: Option<HashSet<String>> = None) {
        this.context = context
        this.scopes = scopes
        this.allowedWorkspaces = allowedWorkspaces
        this.allowedSessions = allowedSessions
    }

    public func withScope(scope: String): DeviceAuthzView {
        let s = HashSet<String>()
        for (k in scopes) { s.add(k) }
        s.add(scope)
        let ws = copySet(allowedWorkspaces)
        let ss = copySet(allowedSessions)
        return DeviceAuthzView(context, scopes: s, allowedWorkspaces: ws, allowedSessions: ss)
    }

    public func withAllowedWorkspace(ws: String): DeviceAuthzView {
        let s = HashSet<String>()
        if (let Some(prev) <- allowedWorkspaces) { for (w in prev) { s.add(w) } }
        s.add(ws)
        let ss = copySet(allowedSessions)
        return DeviceAuthzView(context, scopes: copySetSome(scopes), allowedWorkspaces: Some(s), allowedSessions: ss)
    }

    public func withAllowedSession(sid: String): DeviceAuthzView {
        let s = HashSet<String>()
        if (let Some(prev) <- allowedSessions) { for (v in prev) { s.add(v) } }
        s.add(sid)
        let ws = copySet(allowedWorkspaces)
        return DeviceAuthzView(context, scopes: copySetSome(scopes), allowedWorkspaces: ws, allowedSessions: Some(s))
    }
}

func copySet(src: Option<HashSet<String>>): Option<HashSet<String>> {
    if (let Some(s) <- src) {
        let out = HashSet<String>()
        for (v in s) { out.add(v) }
        return Some(out)
    }
    return None
}

func copySetSome(src: HashSet<String>): HashSet<String> {
    let out = HashSet<String>()
    for (v in src) { out.add(v) }
    return out
}

public class RemoteAccessAuthorizer {
    let lock = Mutex()
    let table = HashMap<String, CapabilitySpec>()

    public init() {}

    public func register(spec: CapabilitySpec): Unit {
        lock.lock()
        table.add(spec.method, spec)
        lock.unlock()
    }

    public func registeredCount(): Int64 {
        lock.lock()
        let n = Int64(table.size)
        lock.unlock()
        return n
    }

    // 判定：先按方法查表；再核 scope；最后核 workspace/session 归属。
    // 每一步的拒绝原因都是稳定字符串，方便客户端和审计日志对齐。
    public func check(view: DeviceAuthzView, method: String, workspaceId: String, sessionId: String): AuthzDecision {
        lock.lock()
        let spec = table.get(method)
        lock.unlock()
        if (let Some(s) <- spec) {
            // scope 检查
            let required = scopeFor(s.permission)
            if (let Some(req) <- required) {
                if (!view.scopes.contains(req)) {
                    return AuthzDecision(false, AUTHZ_REASON_SCOPE_REQUIRED)
                }
            }
            // 资源归属：needsWorkspace/needsSession 的字段值必须非空
            if (s.needsWorkspace && workspaceId.size == 0) {
                return AuthzDecision(false, AUTHZ_REASON_WORKSPACE_REQUIRED)
            }
            if (s.needsSession && sessionId.size == 0) {
                return AuthzDecision(false, AUTHZ_REASON_SESSION_REQUIRED)
            }
            // 设备白名单交集
            if (let Some(allowed) <- view.allowedWorkspaces) {
                if (s.needsWorkspace && !allowed.contains(workspaceId)) {
                    return AuthzDecision(false, AUTHZ_REASON_WORKSPACE_NOT_ALLOWED)
                }
            }
            if (let Some(allowed) <- view.allowedSessions) {
                if (s.needsSession && !allowed.contains(sessionId)) {
                    return AuthzDecision(false, AUTHZ_REASON_SESSION_NOT_ALLOWED)
                }
            }
            return AuthzDecision(true, AUTHZ_REASON_OK)
        }
        return AuthzDecision(false, AUTHZ_REASON_METHOD_NOT_REGISTERED)
    }

    func scopeFor(permission: String): Option<String> {
        if (permission == AUTHZ_PERM_READ) { return None }
        if (permission == AUTHZ_PERM_WRITE) { return None }
        if (permission == AUTHZ_PERM_EXECUTE) { return Some(AUTHZ_SCOPE_EXECUTE) }
        if (permission == AUTHZ_PERM_APPROVAL) { return Some(AUTHZ_SCOPE_APPROVAL) }
        if (permission == AUTHZ_PERM_MANAGEMENT) { return Some(AUTHZ_SCOPE_MANAGEMENT) }
        throw Exception("unknown-permission-class")
    }
}
