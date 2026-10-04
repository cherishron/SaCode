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

// 沙箱运行时：confine 只接受 confined 集合里的档位（`read-only` / `workspace-write`），
// 其余——包括 `danger-full-access`、拼错的、空串——一律拒绝，禁止静默透传给 provider
// （上游 §221 里的 ConfinedSandboxMode 是类型级收窄，本仓在运行期按闭集校验等效它）。
// `backendAvailable` 默认 true；`withoutBackend()` 通过命名参数把它关掉，用来
// 表达「本机没有可用的 sandbox 后端」这一档失败模式。
// confined 集合由上游冻死：只有这两档可以带着 argv 交给 provider。
func isConfinedMode(mode: String): Bool {
    return mode == "read-only" || mode == "workspace-write"
}

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
        // 认不出的档位一律拒。原先只点名 danger-full-access，于是拼错的、空的、
        // 自定义的 mode 全都被当「没约束」原样透传——调用方以为沙箱生效了，
        // 实际一条都没拦，这是 fail-open。
        if (!isConfinedMode(mode)) {
            throw Exception("SANDBOX_MODE_NOT_CONFINED")
        }
        return argv
    }
}
