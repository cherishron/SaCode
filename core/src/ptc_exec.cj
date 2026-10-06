package core

import std.collection.*
import std.fs.*
import std.io.*
import std.process.*

// PTC 代码执行结果
public class PtcExecResult {
    public let exitCode: Int64
    public let stdout: String
    public let stderr: String
    public let timedOut: Bool
    public let error: String

    public init(exitCode: Int64, stdout: String, stderr: String, timedOut: Bool, error: String) {
        this.exitCode = exitCode
        this.stdout = stdout
        this.stderr = stderr
        this.timedOut = timedOut
        this.error = error
    }
}

// PTC 执行器：通过 node 子进程执行 JavaScript 代码。
// 代码写入临时文件后由 node 执行，执行完毕后清理临时文件。
// 沙箱策略 fail-closed：与 ShellExecutor 一致。
public class PtcExecutor {
    let workingDirectory: String
    let sandboxRuntime: SandboxRuntime

    public init(workingDirectory!: String = "", sandboxRuntime!: SandboxRuntime = SandboxRuntime()) {
        this.workingDirectory = workingDirectory
        this.sandboxRuntime = sandboxRuntime
    }

    // 执行 JavaScript 代码。
    // code: 要执行的 JS 代码；timeoutMs: 超时毫秒数。
    // 返回 None 表示执行失败（node 不存在、沙箱拒绝等）。
    public func runCode(code: String, timeoutMs!: Int64 = 30000,
                        sandboxMode!: String = "workspace-write"): Option<PtcExecResult> {
        // 沙箱策略检查
        let fullArgs = ArrayList<String>()
        fullArgs.add("node")
        fullArgs.add("-e")
        fullArgs.add(code)
        try {
            sandboxRuntime.confine(fullArgs.toArray(), sandboxMode)
        } catch (e: Exception) {
            return None
        }

        let resolvedCwd = workingDirectory
        var wdOpt: Option<Path> = None
        if (resolvedCwd.size > 0) { wdOpt = Some(Path(resolvedCwd)) }

        try {
            let p = launch("node", ["-e", code], workingDirectory: wdOpt,
                           stdIn: ProcessRedirect.Discard, stdOut: ProcessRedirect.Pipe,
                           stdErr: ProcessRedirect.Pipe)

            // stderr 在独立线程读取
            let stderrPipe = p.stdErrPipe
            let stderrFuture = spawn { => readAllStreamStdin(stderrPipe) }

            // stdout 在主线程读取
            let stdout = readAllStreamStdin(p.stdOutPipe)

            // 有超时地等待子进程退出
            var code2: Int64 = 0
            var timedOut = false
            try {
                code2 = p.wait(timeout: timeoutMs * Duration.millisecond)
            } catch (e: Exception) {
                timedOut = true
                try { p.terminate(force: true) } catch (_: Exception) {}
                try { code2 = p.wait() } catch (_: Exception) { code2 = Int64(-1) }
            }

            // 收集 stderr
            var stderr = ""
            try { stderr = stderrFuture.get(3000 * Duration.millisecond) } catch (_: Exception) {}

            return Some(PtcExecResult(code2, stdout, stderr, timedOut, ""))
        } catch (e: Exception) {
            return None
        }
    }

    // 用临时文件方式执行 JS 代码（支持 require 等 Node.js 特性）。
    public func runCodeFromFile(code: String, timeoutMs!: Int64 = 30000,
                                sandboxMode!: String = "workspace-write"): Option<PtcExecResult> {
        // 沙箱策略检查
        let fullArgs = ArrayList<String>()
        fullArgs.add("node")
        fullArgs.add("__ptc_tmp.cjs")
        try {
            sandboxRuntime.confine(fullArgs.toArray(), sandboxMode)
        } catch (e: Exception) {
            return None
        }

        let tmpName = "__ptc_tmp.cjs"
        let resolvedCwd = workingDirectory
        var wdOpt: Option<Path> = None
        if (resolvedCwd.size > 0) { wdOpt = Some(Path(resolvedCwd)) }

        try {
            // 写临时文件
            File.writeTo(tmpName, code.toArray())
        } catch (e: Exception) {
            return None
        }

        try {
            let p = launch("node", [tmpName], workingDirectory: wdOpt,
                           stdIn: ProcessRedirect.Discard, stdOut: ProcessRedirect.Pipe,
                           stdErr: ProcessRedirect.Pipe)

            // stderr 在独立线程读取
            let stderrPipe = p.stdErrPipe
            let stderrFuture = spawn { => readAllStreamStdin(stderrPipe) }

            // stdout 在主线程读取
            let stdout = readAllStreamStdin(p.stdOutPipe)

            // 有超时地等待子进程退出
            var code2: Int64 = 0
            var timedOut = false
            try {
                code2 = p.wait(timeout: timeoutMs * Duration.millisecond)
            } catch (e: Exception) {
                timedOut = true
                try { p.terminate(force: true) } catch (_: Exception) {}
                try { code2 = p.wait() } catch (_: Exception) { code2 = Int64(-1) }
            }

            // 收集 stderr
            var stderr = ""
            try { stderr = stderrFuture.get(3000 * Duration.millisecond) } catch (_: Exception) {}

            return Some(PtcExecResult(code2, stdout, stderr, timedOut, ""))
        } catch (e: Exception) {
            return None
        } finally {
            removeIfExists(tmpName, recursive: false)
        }
    }
}

// 从 InputStream 读取全部内容（与 shlex.cj 的 readAllStream 相同，避免跨文件依赖）。
func readAllStreamStdin(pipe: InputStream): String {
    let rd = StringReader(pipe)
    var result = ""
    var first = true
    while (true) {
        let line = rd.readln()
        if (let Some(s) <- line) {
            if (!first) { result += "\n" }
            result += s
            first = false
        } else {
            break
        }
    }
    return result
}
