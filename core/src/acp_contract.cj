package core

// ACP 委派契约闭集与能力声明类型（无 I/O）。
// 取值与实现方案 design §2.2.2 逐字一致；未知 phase/reason 一律视为非法，
// 不得用于状态迁移或错误回传（REQ-A1-06；spec §6.6/6.7/6.9/6.10）。

public let acpDelegationPhases: Array<String> = [
    "pending", "initializing", "authenticating", "session-establishing",
    "running", "awaiting-permission", "awaiting-input", "completing", "completed",
    "incomplete", "failed", "cancelling", "cancelled", "outcome-unknown", "rejected"
]

public let acpFailReasons: Array<String> = [
    "invalid-input", "revision-conflict", "not-authorized", "unsupported", "busy",
    "not-found", "cancelled", "provider-unavailable", "persistence-failed", "outcome-unknown"
]

public let acpPermissionDecisions: Array<String> = ["allowed-once", "denied", "expired"]

public let acpElicitationDecisions: Array<String> = ["submitted", "abandoned", "expired"]

public let acpProbeVerdicts: Array<String> = ["measured", "pending-verification", "blocked"]

public let acpEnvStates: Array<String> = [
    "not-installed", "installed-usable", "installed-auth-missing",
    "entry-unsupported", "probe-failed-unknown", "pending-verification"
]

public let acpInstallPhases: Array<String> = [
    "awaiting-authorization", "running", "succeeded", "failed", "cancelled", "timed-out"
]

func acpIn(arr: Array<String>, v: String): Bool {
    for (x in arr) {
        if (x == v) {
            return true
        }
    }
    return false
}

// 闭集成员校验：未知值一律视为非法（design §2.2.2）。
public func acpPhaseValid(phase: String): Bool {
    return acpIn(acpDelegationPhases, phase)
}

public func acpFailReasonValid(reason: String): Bool {
    return acpIn(acpFailReasons, reason)
}

public func acpPermissionDecisionValid(d: String): Bool {
    return acpIn(acpPermissionDecisions, d)
}

public func acpElicitationDecisionValid(d: String): Bool {
    return acpIn(acpElicitationDecisions, d)
}

public func acpProbeVerdictValid(v: String): Bool {
    return acpIn(acpProbeVerdicts, v)
}

public func acpEnvStateValid(s: String): Bool {
    return acpIn(acpEnvStates, s)
}

public func acpInstallPhaseValid(p: String): Bool {
    return acpIn(acpInstallPhases, p)
}

func acpCount(arr: Array<String>): Int64 {
    var n = Int64(0)
    for (_ in arr) {
        n += 1
    }
    return n
}

public func acpPhaseCount(): Int64 { return acpCount(acpDelegationPhases) }
public func acpFailReasonCount(): Int64 { return acpCount(acpFailReasons) }
public func acpPermissionDecisionCount(): Int64 { return acpCount(acpPermissionDecisions) }
public func acpElicitationDecisionCount(): Int64 { return acpCount(acpElicitationDecisions) }
public func acpProbeVerdictCount(): Int64 { return acpCount(acpProbeVerdicts) }
public func acpEnvStateCount(): Int64 { return acpCount(acpEnvStates) }
public func acpInstallPhaseCount(): Int64 { return acpCount(acpInstallPhases) }

// 结构化能力声明：由 initialize 协商所得，不得冒报（design §2.2.2）。
// verbs 只列经协商/已实现的动作；方言方法逐产品登记，不混用。
public class AcpCapabilityKind {
    public let version: String
    public let authMethods: Array<String>
    public let verbs: Array<String>
    public let toolProxy: Bool
    public let multitask: Bool
    public let configOptions: Array<String>
    public let dialectMethods: Array<String>
    public init(version: String, authMethods: Array<String>, verbs: Array<String>,
        toolProxy: Bool, multitask: Bool, configOptions: Array<String>, dialectMethods: Array<String>) {
        this.version = version
        this.authMethods = authMethods
        this.verbs = verbs
        this.toolProxy = toolProxy
        this.multitask = multitask
        this.configOptions = configOptions
        this.dialectMethods = dialectMethods
    }
    public func supports(verb: String): Bool {
        return acpIn(this.verbs, verb)
    }
}