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

// confined 集合是上游冻死的两档。认不出的档位（拼错、空串、自定义名字）不能
// 当成「没有约束」透传——那等于 fail-open：调用方以为沙箱生效了，其实什么都没拒。
@Test
func sandboxConfineRejectsUnrecognizedMode() {
    var typo = ""
    try {
        SandboxRuntime().confine(["ls"], "read-onlyy")
        typo = "passed-through"
    } catch (e: Exception) {
        typo = e.message
    }
    @Expect(typo, "SANDBOX_MODE_NOT_CONFINED")

    var blank = ""
    try {
        SandboxRuntime().confine(["ls"], "")
        blank = "passed-through"
    } catch (e: Exception) {
        blank = e.message
    }
    @Expect(blank, "SANDBOX_MODE_NOT_CONFINED")

    // 不是「一律拒绝」式的假 fail-closed：认得的两档必须照常放行同一份 argv
    var joined = ""
    for (a in SandboxRuntime().confine(["ls", "-l"], "read-only")) {
        joined += "${a}|"
    }
    @Expect(joined, "ls|-l|")
    joined = ""
    for (a in SandboxRuntime().confine(["echo", "ok"], "workspace-write")) {
        joined += "${a}|"
    }
    @Expect(joined, "echo|ok|")
}

// 上面两条既有用例原先只判「有没有抛」——任何一次抛算都能过。
// 这里把原因钉住：无后端与档位不认必须是两个不同的错误码，别混成一件事。
@Test
func sandboxFailureReasonsAreDistinct() {
    var noBackend = ""
    try {
        SandboxRuntime.withoutBackend().confine(["ls"], "read-only")
        noBackend = "passed-through"
    } catch (e: Exception) {
        noBackend = e.message
    }
    @Expect(noBackend, "SANDBOX_UNAVAILABLE")

    var unconfined = ""
    try {
        SandboxRuntime().confine(["ls"], "danger-full-access")
        unconfined = "passed-through"
    } catch (e: Exception) {
        unconfined = e.message
    }
    @Expect(unconfined, "SANDBOX_MODE_NOT_CONFINED")
}
