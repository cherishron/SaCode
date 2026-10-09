package core

import std.collection.*
import std.fs.*
import std.io.*
import std.process.*

// Shell 执行结果：退出码、stdout、stderr、是否超时。
// exitCode 为 -1 表示执行失败（命令不存在、沙箱拒绝等）。
public class ShellResult {
    public let exitCode: Int64
    public let stdout: String
    public let stderr: String
    public let timedOut: Bool
    public let error: String
    public var outputComplete: Bool = true
    public var cancelled: Bool = false
    public var stdoutTruncated: Bool = false
    public var stderrTruncated: Bool = false

    public init(exitCode: Int64, stdout: String, stderr: String, timedOut: Bool, error: String) {
        this.exitCode = exitCode
        this.stdout = stdout
        this.stderr = stderr
        this.timedOut = timedOut
        this.error = error
    }
}

// 从 InputStream 读取全部内容（逐行读取直到 EOF，行间用换行连接）。
func readAllStream(pipe: InputStream): String {
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

// Shell 执行器：通过子进程运行命令，捕获 stdout/stderr/退出码，支持沙箱策略检查与超时。
// 沙箱策略 fail-closed：confined 模式（read-only / workspace-write）才放行，
// danger-full-access 或未知模式一律拒绝；后端不可用时也拒绝，绝不静默裸跑。
public class ShellExecutor {
    let workingDirectory: String
    let sandboxRuntime: SandboxRuntime

    public init(workingDirectory!: String = "", sandboxRuntime!: SandboxRuntime = SandboxRuntime()) {
        this.workingDirectory = workingDirectory
        this.sandboxRuntime = sandboxRuntime
    }

    // 执行命令并返回结果。
    // command: 可执行文件路径；args: 命令行参数；cwd: 工作目录（空串用构造时的值）。
    // timeoutMs: 等待子进程退出的超时毫秒数；sandboxMode: 沙箱策略档位。
    // 返回 None 表示执行失败（命令不存在、沙箱拒绝、管道错误）。
    public func run(command: String, args: Array<String>, cwd!: String = "",
                    timeoutMs!: Int64 = 30000, sandboxMode!: String = "workspace-write"): Option<ShellResult> {
        // 沙箱策略检查：confined 模式才放行
        let fullArgs = ArrayList<String>()
        fullArgs.add(command)
        for (a in args) { fullArgs.add(a) }
        try {
            sandboxRuntime.confine(fullArgs.toArray(), sandboxMode)
        } catch (e: Exception) {
            return None
        }

        let resolvedCwd = if (cwd.size > 0) { cwd } else { workingDirectory }
        var wdOpt: Option<Path> = None
        if (resolvedCwd.size > 0) { wdOpt = Some(Path(resolvedCwd)) }

        try {
            let p = launch(command, args, workingDirectory: wdOpt,
                           stdIn: ProcessRedirect.Discard, stdOut: ProcessRedirect.Pipe,
                           stdErr: ProcessRedirect.Pipe)

            // stderr 在独立线程读取，避免管道写满导致子进程阻塞
            let stderrPipe = p.stdErrPipe
            let stderrFuture = spawn { => readAllStream(stderrPipe) }

            // stdout 在主线程读取
            let stdout = readAllStream(p.stdOutPipe)

            // 有超时地等待子进程退出
            var code: Int64 = 0
            var timedOut = false
            try {
                code = p.wait(timeout: timeoutMs * Duration.millisecond)
            } catch (e: Exception) {
                timedOut = true
                try { p.terminate(force: true) } catch (_: Exception) {}
                try { code = p.wait() } catch (_: Exception) { code = Int64(-1) }
            }

            // 收集 stderr
            var stderr = ""
            try { stderr = stderrFuture.get(3000 * Duration.millisecond) } catch (_: Exception) {}

            return Some(ShellResult(code, stdout, stderr, timedOut, ""))
        } catch (e: Exception) {
            return None
        }
    }

    // 执行 shell 命令字符串（经 shell 包装）。
    // shellCmd: shell 可执行文件（如 "bash" / "cmd"）；shellArgs: shell 参数（如 ["-c"]）。
    // commandStr: 要执行的命令字符串，作为 shell 的参数。
    public func runShellCommand(shellCmd: String, shellArgs: Array<String>,
                                commandStr: String, cwd!: String = "",
                                timeoutMs!: Int64 = 30000,
                                sandboxMode!: String = "workspace-write"): Option<ShellResult> {
        let args = ArrayList<String>()
        for (a in shellArgs) { args.add(a) }
        args.add(commandStr)
        return run(shellCmd, args.toArray(), cwd: cwd, timeoutMs: timeoutMs, sandboxMode: sandboxMode)
    }
}
