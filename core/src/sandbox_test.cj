package core
import std.fs.*
import std.unittest.*

// 沙箱上游契约（221 行）：`SandboxMode = read-only | workspace-write |
// danger-full-access`；`ConfinedSandboxMode` 排除 danger-full-access（只有前两
// 可发给 provider）；`SandboxEnforcement = full | partial`（partial 表示后端
// 或旧内核 ABI 仅治理子集）；`ctx.sandbox.confine(argv, policy, signal?)` 在无
// 可用后端时 reject `SANDBOX_UNAVAILABLE`，禁止静默 unconfined passthrough；
// `ctx.sandboxPolicy.resolve({ session?, mode? })`：显式批准 mode > session
// 最后 sandbox/mode 事件 > 部署默认。

@Test
func sandboxResolvePrefersExplicitMode() {
    let policy = SandboxPolicyService().resolve("read-only", "workspace-write", "danger-full-access")
    @Expect(policy.mode, "read-only")
}

@Test
func sandboxResolveUsesSessionLastWhenNoExplicit() {
    let policy = SandboxPolicyService().resolve("", "workspace-write", "danger-full-access")
    @Expect(policy.mode, "workspace-write")
}

@Test
func sandboxResolveFallsBackToDeploymentDefault() {
    let policy = SandboxPolicyService().resolve("", "", "read-only")
    @Expect(policy.mode, "read-only")
}

@Test
func sandboxConfineRejectsDangerFullAccess() {
    // provider 只收 confined 模式；danger-full-access 静默透传被禁止。
    var threw = false
    try {
        SandboxRuntime().confine(["ls"], "danger-full-access")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
}

@Test
func sandboxConfineRequiresAvailableBackend() {
    // 无可用后端时抛 SANDBOX_UNAVAILABLE——不允许 unconfined passthrough。
    var threw = false
    try {
        SandboxRuntime.withoutBackend().confine(["ls"], "workspace-write")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
}
