package core

import std.fs.*

public class PtcExecResult {
    public let exitCode: Int64
    public let stdout: String
    public let stderr: String
    public let timedOut: Bool
    public let error: String
    public let cancelled: Bool
    public let outputComplete: Bool
    public init(exitCode: Int64, stdout: String, stderr: String, timedOut: Bool, error: String,
        cancelled!: Bool = false, outputComplete!: Bool = true) {
        this.exitCode = exitCode; this.stdout = stdout; this.stderr = stderr
        this.timedOut = timedOut; this.error = error; this.cancelled = cancelled
        this.outputComplete = outputComplete
    }
}

// PTC 与 shell 共用监督：输出并发有界读取，超时从 launch 起计算。
// 默认没有 enforcing 后端，绝不因模式名合法就裸跑 Node。
public class PtcExecutor {
    let workingDirectory: String
    let sandboxRuntime: SandboxRuntime
    public init(workingDirectory!: String = "", sandboxRuntime!: SandboxRuntime = platformSandbox(workingDirectory)) {
        this.workingDirectory = workingDirectory; this.sandboxRuntime = sandboxRuntime
    }
    private func execute(argv: Array<String>, cwd: String, timeoutMs: Int64, mode: String,
        cancelled: () -> Bool, startToken!: ?TurnToken = None): ?PtcExecResult {
        if (timeoutMs < 1 || timeoutMs > 300000 || cancelled()) { return None }
        // Windows 强制隔离与 ShellExecutor 共用同一条 AppContainer 通路：仅在显式选择加入
        // （SACODE_WINDOWS_ENFORCING + 原生 DLL）时执行；否则 None，继续走下方 fail-closed 的
        // platformSandbox，绝不因模式名合法就裸跑 Node。
        let token = if (let Some(t) <- startToken) { t } else { TurnToken() }
        if (let Some(r) <- windowsEnforcingExecute(workingDirectory, argv[0], argv[1..], cwd,
                timeoutMs, 65536, token, { _ => }, { _ => })) {
            var output = r.stdout
            var diagnostic = r.stderr
            if (r.stdoutTruncated) { output += "\n[ptc-stdout-truncated:65536-bytes]" }
            if (r.stderrTruncated) { diagnostic += "\n[ptc-stderr-truncated:65536-bytes]" }
            return Some(PtcExecResult(r.exitCode, output, diagnostic, r.timedOut, r.error,
                cancelled: r.cancelled, outputComplete: r.outputComplete && r.exitObserved))
        }
        var confined = Array<String>()
        try { confined = sandboxRuntime.confine(argv, mode) }
        catch (_: Exception) { return None }
        var wd: Option<Path> = None
        if (cwd.size > 0) { wd = Some(Path(cwd)) }
        let owned = runOwnedProcess(confined[0], confined[1..], wd, timeoutMs, 65536, cancelled, { _ => })
        match (owned) {
            case Some(r) =>
                var output = r.stdout
                var diagnostic = r.stderr
                if (r.stdoutTruncated) { output += "\n[ptc-stdout-truncated:65536-bytes]" }
                if (r.stderrTruncated) { diagnostic += "\n[ptc-stderr-truncated:65536-bytes]" }
                return Some(PtcExecResult(r.exitCode, output, diagnostic, r.timedOut, r.error,
                    cancelled: r.cancelled, outputComplete: r.outputComplete && r.exitObserved))
            case None => return None
        }
    }
    public func runCode(code: String, timeoutMs!: Int64 = 30000,
        sandboxMode!: String = "workspace-write", cwd!: String = "", cancelled!: () -> Bool = { => false },
        startToken!: ?TurnToken = None): ?PtcExecResult {
        return execute(["node", "-e", code], if (cwd.size > 0) { cwd } else { workingDirectory },
            timeoutMs, sandboxMode, cancelled, startToken: startToken)
    }
    // 保留调用契约但不再覆盖 cwd 下的固定 __ptc_tmp.cjs；Node 的 -e 同样支持 require。
    public func runCodeFromFile(code: String, timeoutMs!: Int64 = 30000,
        sandboxMode!: String = "workspace-write", startToken!: ?TurnToken = None): ?PtcExecResult {
        return runCode(code, timeoutMs: timeoutMs, sandboxMode: sandboxMode, startToken: startToken)
    }
}

func ptcSucceeded(result: PtcExecResult): Bool {
    return result.exitCode == 0 && !result.timedOut && !result.cancelled && result.outputComplete && result.error.size == 0
}
