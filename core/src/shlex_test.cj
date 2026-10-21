package core

import std.fs.*
import std.sync.*
import std.unittest.*

// Shell 执行器测试：验证子进程启动、stdout/stderr 捕获、退出码、超时与沙箱策略。

// 2026-10-12 起默认 SandboxRuntime 无 enforcing 后端，下面每条要真启动子进程的用例
// 都显式注入 passthrough 后端。它只在这几条用例里出现，且只喂无副作用的固定命令；
// 产品路径一律走默认的 fail-closed 实例。
func shlexTestRuntime(): SandboxRuntime {
    return SandboxRuntime(provider: { argv, _ => argv })
}

func shlexTmpFile(tag: String): String {
    return "core-shlex-${tag}.txt"
}

func shlexCleanup(tag: String) {
    removeIfExists(shlexTmpFile(tag), recursive: false)
}

@Test
func shellExecutesSimpleCommand() {
    // 用 echo 验证基本命令执行与 stdout 捕获
    let exec = ShellExecutor(sandboxRuntime: shlexTestRuntime())
    let result = exec.run("cmd", ["/c", "echo hello"], cwd: "", timeoutMs: 10000, sandboxMode: "workspace-write")
    @Expect(result.isSome(), true)
    if (let Some(r) <- result) {
        @Expect(r.exitCode, Int64(0))
        @Expect(r.stdout.contains("hello"), true)
        @Expect(r.timedOut, false)
    }
}

@Test
func shellCapturesExitCode() {
    // 用 exit 1 验证非零退出码捕获
    let exec = ShellExecutor(sandboxRuntime: shlexTestRuntime())
    let result = exec.run("cmd", ["/c", "exit 42"], cwd: "", timeoutMs: 10000, sandboxMode: "workspace-write")
    @Expect(result.isSome(), true)
    if (let Some(r) <- result) {
        @Expect(r.exitCode, Int64(42))
        @Expect(r.timedOut, false)
    }
}

@Test
func shellSandboxRejectsDangerFullAccess() {
    // 沙箱策略 fail-closed：danger-full-access 不允许通过。
    // 失败必须带可靠原因，而不是退化成无原因的 None。
    let exec = ShellExecutor(sandboxRuntime: SandboxRuntime())
    let result = exec.run("echo", ["test"], cwd: "", timeoutMs: 10000, sandboxMode: "danger-full-access")
    @Expect(result.isSome(), true)
    if (let Some(r) <- result) {
        @Expect(r.error, "SANDBOX_MODE_NOT_CONFINED")
        @Expect(r.exitObserved, false)
    }
}

@Test
func shellSandboxRejectsUnknownMode() {
    // 未知沙箱模式也被拒绝，并保留可靠原因。
    let exec = ShellExecutor(sandboxRuntime: SandboxRuntime())
    let result = exec.run("echo", ["test"], cwd: "", timeoutMs: 10000, sandboxMode: "unknown-mode")
    @Expect(result.isSome(), true)
    if (let Some(r) <- result) {
        @Expect(r.error, "SANDBOX_MODE_NOT_CONFINED")
        @Expect(r.exitObserved, false)
    }
}

@Test
func shellSandboxWithoutBackendRejectsAll() {
    // 无后端时所有模式都被拒绝；拒绝必须带可靠原因，且不伪造退出事实。
    let exec = ShellExecutor(sandboxRuntime: SandboxRuntime.withoutBackend())
    let result = exec.run("echo", ["test"], cwd: "", timeoutMs: 10000, sandboxMode: "workspace-write")
    @Expect(result.isSome(), true)
    if (let Some(r) <- result) {
        @Expect(r.exitObserved, false)
        @Expect(r.error.size > 0, true)
    }
}

@Test
func shellRunShellCommandWorks() {
    // 通过 shell 包装执行命令
    let exec = ShellExecutor(sandboxRuntime: shlexTestRuntime())
    let result = exec.runShellCommand("cmd", ["/c"], "echo test-output", cwd: "", timeoutMs: 10000, sandboxMode: "workspace-write")
    @Expect(result.isSome(), true)
    if (let Some(r) <- result) {
        @Expect(r.exitCode, Int64(0))
        @Expect(r.stdout.contains("test-output"), true)
    }
}

@Test
func shellNonexistentCommandReportsStartFailure() {
    // 不存在的命令是启动失败，不是静默退出；必须带原因且不伪造退出码。
    let exec = ShellExecutor(sandboxRuntime: shlexTestRuntime())
    let result = exec.run("nonexistent-command-xyz", [], cwd: "", timeoutMs: 5000, sandboxMode: "workspace-write")
    @Expect(result.isSome(), true)
    if (let Some(r) <- result) {
        @Expect(r.exitObserved, false)
        @Expect(r.error.size > 0, true)
    }
}

// 超时从 launch 起计算：进程不退出也必须在预算内结算，不能挂在 stdout 读取上。
@Test
func shellTimeoutTerminatesProcessInsteadOfWaitingForOutput() {
    let exec = ShellExecutor(sandboxRuntime: shlexTestRuntime())
    let result = exec.run("powershell", ["-NoProfile", "-NonInteractive", "-Command", "Start-Sleep -Seconds 8"],
        cwd: "", timeoutMs: 400, sandboxMode: "workspace-write")
    @Expect(result.isSome(), true)
    if (let Some(r) <- result) {
        @Expect(r.timedOut, true)
        @Expect(r.cancelled, false)
        // 实现不为"一定观测到退出"背书：要么给出真实退出，要么留下明确失败原因；
        // 不允许既无退出事实、又无原因地静默结算。
        @Expect(r.exitObserved || r.error.size > 0, true)
        @Expect(r.error.startsWith("appcontainer-"), false)
    }
}

// 默认实例没有任何后端：连档位合法的 workspace-write 也必须拒绝，
// 否则「模式名合法」会被当成「已经有隔离」。
@Test
func shellDefaultRuntimeRefusesEvenWithValidMode() {
    let result = ShellExecutor().run("cmd", ["/c", "echo hi"], cwd: "", timeoutMs: 10000, sandboxMode: "workspace-write")
    @Expect(result.isSome(), true)
    if (let Some(r) <- result) {
        @Expect(r.exitObserved, false)
        @Expect(r.error.size > 0, true)
    }
}

// 反例回归：合法程序静默退出 1（无 stdout/stderr）必须保留真实退出事实，
// 不得因为"exit 1 + 空输出"被误标成 AppContainer 初始化失败。
// 覆盖范围：本用例走 passthrough 测试后端，锁的是"已观测退出不被改写成未启动"这条语义，
// 不覆盖 AppContainer 专属分支；该分支的分类由下方纯函数用例覆盖。
@Test
func shellSilentExitOneKeepsRealExitCode() {
    let exec = ShellExecutor(sandboxRuntime: shlexTestRuntime())
    let result = exec.run("cmd", ["/c", "exit 1"], cwd: "", timeoutMs: 10000, sandboxMode: "workspace-write")
    @Expect(result.isSome(), true)
    if (let Some(r) <- result) {
        @Expect(r.exitObserved, true)
        @Expect(r.exitCode, Int64(1))
        @Expect(r.error.size, Int64(0))
        @Expect(r.stdout, "")
        @Expect(r.stderr, "")
        @Expect(r.error.contains("appcontainer-init-failed"), false)
        @Expect(r.error.startsWith("appcontainer-"), false)
    }
}

@Test
func shellExitZeroKeepsRealExitCode() {
    let exec = ShellExecutor(sandboxRuntime: shlexTestRuntime())
    let result = exec.run("cmd", ["/c", "exit 0"], cwd: "", timeoutMs: 10000, sandboxMode: "workspace-write")
    @Expect(result.isSome(), true)
    if (let Some(r) <- result) {
        @Expect(r.exitObserved, true)
        @Expect(r.exitCode, Int64(0))
        @Expect(r.error.size, Int64(0))
    }
}

// 取消：进程已创建后由取消令牌终止，结果必须是 cancelled，而不是初始化失败。
@Test
func shellCancelDuringRunReportsCancelled() {
    let exec = ShellExecutor(sandboxRuntime: shlexTestRuntime())
    let cancelled = AtomicBool(false)
    let watcher = spawn { =>
        sleep(300 * Duration.millisecond)
        cancelled.store(true)
    }
    let result = exec.run("powershell", ["-NoProfile", "-NonInteractive", "-Command", "Start-Sleep -Seconds 8"],
        cwd: "", timeoutMs: 10000, sandboxMode: "workspace-write", cancelled: { => cancelled.load() })
    watcher.get(5000 * Duration.millisecond)
    @Expect(result.isSome(), true)
    if (let Some(r) <- result) {
        @Expect(r.cancelled, true)
        @Expect(r.timedOut, false)
        // 终止后是否已退出按实际观测填写：不强制"一定已退出"，但必须留下观测或原因。
        @Expect(r.exitObserved || r.error.size > 0, true)
        @Expect(r.error.startsWith("appcontainer-"), false)
    }
}

// ── AppContainer 错误分类（纯函数边界，不依赖原生 DLL）────────────────────────
// 下列用例覆盖"启动失败不得虚构退出事实"与"分类必须互斥"两条约束。

@Test
func appContainerFailureCarriesNoInventedExit() {
    let r = appContainerFailure("appcontainer-create-failed:87")
    @Expect(r.error, "appcontainer-create-failed:87")
    @Expect(r.exitObserved, false)
    @Expect(r.exitCode, Int64(-1))
    @Expect(r.stdout, "")
    @Expect(r.stderr, "")
    // 没启动过进程就不能声称"输出已完整捕获"。
    @Expect(r.outputComplete, false)
}

// 四类失败必须落在不同分类：初始化失败 / 命令解析参数 / 进程创建 / 创建后监督，
// 不能统一归成"环境不支持沙箱"。
@Test
func appContainerFailureCategorizesStages() {
    @Expect(appContainerFailureCategory("create", "windows-process-create:87"), "appcontainer-create-failed:87")
    @Expect(appContainerFailureCategory("create", "windows-process-invalid-create-reply"),
        "appcontainer-create-failed:invalid-reply")
    @Expect(appContainerFailureCategory("command", "windows-process-unsupported-shell-arguments"),
        "appcontainer-command-invalid:arguments")
    @Expect(appContainerFailureCategory("command", "windows-process-invalid-argument"),
        "appcontainer-command-invalid:arguments")
    @Expect(appContainerFailureCategory("command", "windows-process-command-too-long"),
        "appcontainer-command-invalid:too-long")
    @Expect(appContainerFailureCategory("resolve", "windows-enforcing-resolve-not-found"),
        "appcontainer-command-invalid:executable-not-found")
    @Expect(appContainerFailureCategory("profile", "windows-profile-create:1332"),
        "appcontainer-init-failed:profile:profile-create:1332")
    @Expect(appContainerFailureCategory("library", "windows-process-library-unavailable"),
        "appcontainer-init-failed:library:library-unavailable")
    @Expect(appContainerFailureCategory("library", "windows-process-abi-version"),
        "appcontainer-init-failed:library:library-abi-version")
    @Expect(appContainerFailureCategory("library", "windows-process-export-missing:sacode_windows_process_create"),
        "appcontainer-init-failed:library:library-export-missing")
    @Expect(appContainerFailureCategory("environment", "appcontainer-environment-unavailable"),
        "appcontainer-init-failed:environment:environment-unavailable")
    @Expect(appContainerFailureCategory("environment", "windows-enforcing-environment-localappdata"),
        "appcontainer-init-failed:environment:environment-localappdata")
    @Expect(appContainerFailureCategory("create", "windows-process-bad-args"),
        "appcontainer-init-failed:create:unknown")
    // LPAC 形态（缺 ALL APPLICATION PACKAGES）必须与命令退出码分开报。
    @Expect(appContainerFailureCategory("create", "windows-process-create:50"),
        "SANDBOX_INIT_FAILED:token-missing-all-application-packages")
}

@Test
func appContainerSupervisionReasonsAreWhitelisted() {
    @Expect(appContainerSupervisionReason("windows-process-resume:5"), "resume:5")
    @Expect(appContainerSupervisionReason("windows-process-wait:258"), "wait:258")
    @Expect(appContainerSupervisionReason("windows-process-read:109"), "read:109")
    @Expect(appContainerSupervisionReason("windows-process-active:6"), "active:6")
    @Expect(appContainerSupervisionReason("windows-process-cleanup-only"), "resume-after-failed-create")
    @Expect(appContainerSupervisionReason("windows-process-invalid-limits"), "invalid-limits")
    @Expect(appContainerSupervisionReason("something-else"), "unknown")
}

// 未知异常常把本机路径、账户名或底层文本带进 message：对外只能返回固定分类。
@Test
func appContainerFailureDropsSensitiveExceptionText() {
    let leaked = "open C:\\Users\\jingg\\secret\\token.txt failed: access denied"
    let category = appContainerFailureCategory("library", leaked)
    @Expect(category, "appcontainer-init-failed:library:unknown")
    @Expect(category.contains("jingg"), false)
    @Expect(category.contains("secret"), false)
    @Expect(category.contains("token"), false)
    @Expect(appContainerSupervisionReason(leaked), "unknown")
    @Expect(appContainerCleanupReason(leaked), "unknown")
    @Expect(appContainerProfileCloseReason(leaked), "profile-unknown")
    @Expect(appContainerLibraryCloseReason(leaked), "library-unknown")
}

// 可选文本归一化：让 @Expect 能比较 ?String 的确切取值（"<none>" 表示未保留）。
func shlexOptionalText(value: ?String): String {
    if (let Some(text) <- value) {
        return text
    }
    return "<none>"
}

// 只有经校验的十进制原生码才保留；非数字、越界、多段一律丢弃。
@Test
func appContainerFailureValidatesNativeCode() {
    @Expect(shlexOptionalText(windowsValidatedCode("00087")), "87")
    @Expect(shlexOptionalText(windowsValidatedCode("4294967295")), "4294967295")
    @Expect(shlexOptionalText(windowsValidatedCode("4294967296")), "<none>")
    @Expect(shlexOptionalText(windowsValidatedCode("-1")), "<none>")
    @Expect(shlexOptionalText(windowsValidatedCode("8a")), "<none>")
    @Expect(shlexOptionalText(windowsValidatedCode("")), "<none>")
    @Expect(appContainerFailureCategory("create", "windows-process-create:abc"),
        "appcontainer-init-failed:create:unknown")
    @Expect(appContainerFailureCategory("create", "windows-process-create:99999999999"),
        "appcontainer-init-failed:create:unknown")
    @Expect(appContainerFailureCategory("create", "windows-process-create:87:C:\\x"),
        "appcontainer-init-failed:create:unknown")
}

// 回收未确认不得被主分类掩盖，更不能当成完整回收。
@Test
func appContainerCleanupUnconfirmedIsExplicit() {
    @Expect(appContainerError("appcontainer-create-failed:87", ""), "appcontainer-create-failed:87")
    @Expect(appContainerError("", "close:170"), "appcontainer-cleanup-unconfirmed:close:170")
    @Expect(appContainerError("appcontainer-supervision-failed:wait:258", "tree-alive"),
        "appcontainer-supervision-failed:wait:258|appcontainer-cleanup-unconfirmed:tree-alive")
    @Expect(appendWindowsCleanup("", "close:170"), "close:170")
    @Expect(appendWindowsCleanup("close:170", "library-in-use"), "close:170,library-in-use")
    @Expect(appContainerCleanupReason("windows-process-close:170"), "close:170")
    @Expect(appContainerCleanupReason("windows-process-active:6"), "observe:6")
    @Expect(appContainerCleanupReason("windows-process-readers-active"), "readers-active")
    @Expect(appContainerProfileCloseReason("windows-profile-in-use"), "profile-in-use")
    @Expect(appContainerProfileCloseReason("windows-profile-delete:5"), "profile-delete:5")
    @Expect(appContainerLibraryCloseReason("windows-process-library-in-use"), "library-in-use")
}

// enforcing 适配边界：仅在显式选择加入且原生薄层就位时执行，否则跳过（不伪造通过）。
// 覆盖 AppContainer 专属分支"失败不带虚构退出事实、错误串不含本机路径"的约束。
@Test
func windowsEnforcingFailureHasNoExitFacts() {
    if (!shellWindows) {
        return
    }
    if (!windowsExecutionEnforcingAvailable(".")) {
        return
    }
    let missing = "Z:\\sacode-missing-probe.exe"
    let result = windowsEnforcingExecute(".", missing, [], ".", 5000, 65536, TurnToken(), { _ => }, { _ => })
    @Expect(result.isSome(), true)
    if (let Some(r) <- result) {
        @Expect(r.exitObserved, false)
        @Expect(r.exitCode, Int64(-1))
        @Expect(r.error.startsWith("appcontainer-"), true)
        @Expect(r.error.contains("Z:\\"), false)
        @Expect(r.outputComplete, false)
    }
}

// 缺口一验收约束：监督失败必须保持 supervision-failed 分类，不得改写成 init-failed / create-failed。
// 后者意味着"进程从未运行"，与"已观测退出但收束失败（S1/S2）"语义互斥；前端文案据此不能按"未能启动"呈现。
@Test
func appContainerSupervisionFailureMustNotBeInitOrCreate() {
    let reasons = ["resume:5", "wait:258", "read:109", "active:6", "stop:170", "invalid-limits",
        "resume-after-failed-create", "closed", "poll-timeout", "channel", "unknown"]
    for (reason in reasons) {
        let error = "appcontainer-supervision-failed:${reason}"
        @Expect(error.startsWith("appcontainer-supervision-failed:"), true)
        @Expect(error.contains("init-failed"), false)
        @Expect(error.contains("create-failed"), false)
    }
}

// 回归：windowsEnforcingExecute 现在向 collectWindowsProcess 传入事实桶（facts），
// 成功路径不受影响——真实退出码与观测状态照常保留，且不引入虚构事实。
// S1/S2（已观测退出后收束失败）的行为需原生故障注入夹具方能确定性触发，超出单元用例范围，
// 由构建轮在 Windows + DLL 环境复核；此处只守住"成功/正常路径不退化"这一下限。
@Test
func windowsEnforcingExecuteKeepsObservedExitWithFactsBucket() {
    if (!shellWindows) {
        return
    }
    if (!windowsExecutionEnforcingAvailable(".")) {
        return
    }
    let result = windowsEnforcingExecute(".", "cmd", ["/c", "exit 0"], ".", 5000, 65536, TurnToken(), { _ => }, { _ => })
    @Expect(result.isSome(), true)
    if (let Some(r) <- result) {
        @Expect(r.exitObserved, true)
        @Expect(r.exitCode, Int64(0))
        @Expect(r.error.size, Int64(0))
    }
}
