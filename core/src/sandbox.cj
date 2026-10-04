package core

// 沙箱策略解析：`explicit > sessionLast > deploymentDefault`——上游 §221 里
// `ctx.sandboxPolicy.resolve({ session?, mode? })` 的三档优先级；空串视作缺位。
public class SandboxPolicy {
    public let mode: String
    public init(mode: String) {
        this.mode = mode
    }
}

public class SandboxPolicyService {
    public init() {}

    public func resolve(explicit: String, sessionLast: String, deploymentDefault: String): SandboxPolicy {
        if (explicit.size > 0) {
            return SandboxPolicy(explicit)
        }
        if (sessionLast.size > 0) {
            return SandboxPolicy(sessionLast)
        }
        return SandboxPolicy(deploymentDefault)
    }
}

// 沙箱运行时：confine 必须走可用后端；danger-full-access 不属 confined 集合，
// 禁止静默透传给 provider（上游 §221 里的 ConfinedSandboxMode）。
// `backendAvailable` 默认 true；`withoutBackend()` 通过命名参数把它关掉，用来
// 表达「本机没有可用的 sandbox 后端」这一档失败模式。
public class SandboxRuntime {
    public var backendAvailable: Bool = true

    public init() {}

    public static func withoutBackend(): SandboxRuntime {
        let r = SandboxRuntime()
        r.backendAvailable = false
        return r
    }

    public func confine(argv: Array<String>, mode: String): Array<String> {
        if (!backendAvailable) {
            throw Exception("SANDBOX_UNAVAILABLE")
        }
        if (mode == "danger-full-access") {
            throw Exception("SANDBOX_MODE_NOT_CONFINED")
        }
        return argv
    }
}
