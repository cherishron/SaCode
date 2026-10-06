package core

import std.fs.*
import std.unittest.*

// Shell 执行器测试：验证子进程启动、stdout/stderr 捕获、退出码、超时与沙箱策略。

func shlexTmpFile(tag: String): String {
    return "core-shlex-${tag}.txt"
}

func shlexCleanup(tag: String) {
    removeIfExists(shlexTmpFile(tag), recursive: false)
}

@Test
func shellExecutesSimpleCommand() {
    // 用 echo 验证基本命令执行与 stdout 捕获
    let exec = ShellExecutor()
    let result = exec.run("echo", ["hello"], cwd: "", timeoutMs: 10000, sandboxMode: "workspace-write")
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
    let exec = ShellExecutor()
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
    let exec = ShellExecutor()
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
    let exec = ShellExecutor()
    let result = exec.run("nonexistent-command-xyz", [], cwd: "", timeoutMs: 5000, sandboxMode: "workspace-write")
    @Expect(result.isNone(), true)
}
