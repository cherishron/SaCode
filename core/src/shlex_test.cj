package core

import std.fs.*
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
    // 沙箱策略 fail-closed：danger-full-access 不允许通过
    let exec = ShellExecutor(sandboxRuntime: SandboxRuntime())
    let result = exec.run("echo", ["test"], cwd: "", timeoutMs: 10000, sandboxMode: "danger-full-access")
    @Expect(result.isNone(), true)
}

@Test
func shellSandboxRejectsUnknownMode() {
    // 未知沙箱模式也被拒绝
    let exec = ShellExecutor(sandboxRuntime: SandboxRuntime())
    let result = exec.run("echo", ["test"], cwd: "", timeoutMs: 10000, sandboxMode: "unknown-mode")
    @Expect(result.isNone(), true)
}

@Test
func shellSandboxWithoutBackendRejectsAll() {
    // 无后端时所有模式都被拒绝
    let exec = ShellExecutor(sandboxRuntime: SandboxRuntime.withoutBackend())
    let result = exec.run("echo", ["test"], cwd: "", timeoutMs: 10000, sandboxMode: "workspace-write")
    @Expect(result.isNone(), true)
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
func shellNonexistentCommandReturnsNone() {
    // 不存在的命令返回 None
    let exec = ShellExecutor(sandboxRuntime: shlexTestRuntime())
    let result = exec.run("nonexistent-command-xyz", [], cwd: "", timeoutMs: 5000, sandboxMode: "workspace-write")
    @Expect(result.isNone(), true)
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
        @Expect(r.exitObserved, true)
    }
}

// 默认实例没有任何后端：连档位合法的 workspace-write 也必须拒绝，
// 否则「模式名合法」会被当成「已经有隔离」。
@Test
func shellDefaultRuntimeRefusesEvenWithValidMode() {
    let result = ShellExecutor().run("cmd", ["/c", "echo hi"], cwd: "", timeoutMs: 10000, sandboxMode: "workspace-write")
    @Expect(result.isNone(), true)
}
