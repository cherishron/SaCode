package core

import std.collection.*
import std.fs.*
import std.io.*
import std.process.*
import std.time.MonoTime
@When[os == "Windows"]
let shellWindows = true
@When[os != "Windows"]
let shellWindows = false

// Windows PowerShell 的 EncodedCommand 规定 UTF-16LE + Base64。
// 只编码正文，不重写用户引号；补充字符转换为 UTF-16 代理对。
func shellEncodedCommand(text: String): String {
    let utf8 = text.toArray()
    let bytes = ArrayList<Byte>()
    var i: Int64 = 0
    while (i < utf8.size) {
        let lead = Int64(utf8[i])
        var code = lead
        var width: Int64 = 1
        if (lead >= 240) { code = lead % 8; width = 4 }
        else if (lead >= 224) { code = lead % 16; width = 3 }
        else if (lead >= 192) { code = lead % 32; width = 2 }
        for (j in 1..width) { code = code * 64 + Int64(utf8[i + j]) % 64 }
        i += width
        if (code >= 65536) {
            let high = 55296 + (code - 65536) / 1024
            let low = 56320 + (code - 65536) % 1024
            bytes.add(UInt8(high % 256)); bytes.add(UInt8(high / 256))
            bytes.add(UInt8(low % 256)); bytes.add(UInt8(low / 256))
        } else { bytes.add(UInt8(code % 256)); bytes.add(UInt8(code / 256)) }
    }
    let alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".toArray()
    let encoded = ArrayList<Byte>()
    i = 0
    while (i < bytes.size) {
        let a = Int64(bytes[i])
        let b = if (i + 1 < bytes.size) { Int64(bytes[i + 1]) } else { 0 }
        let c = if (i + 2 < bytes.size) { Int64(bytes[i + 2]) } else { 0 }
        encoded.add(alphabet[a / 4]); encoded.add(alphabet[(a % 4) * 16 + b / 16])
        encoded.add(if (i + 1 < bytes.size) { alphabet[(b % 16) * 4 + c / 64] } else { UInt8(61) })
        encoded.add(if (i + 2 < bytes.size) { alphabet[c % 64] } else { UInt8(61) })
        i += 3
    }
    return String.fromUtf8(encoded.toArray())
}

// Shell 执行结果：退出码、stdout、stderr、是否超时。
// exitCode 为 -1 表示执行失败（命令不存在、沙箱拒绝等）。
public class ShellResult {
    public let exitObserved: Bool
    public let exitCode: Int64
    public let stdout: String
    public let stderr: String
    public let timedOut: Bool
    public let error: String
    public let cancelled: Bool
    public let stdoutTruncated: Bool
    public let stderrTruncated: Bool
    public let outputComplete: Bool

    public init(exitCode: Int64, stdout: String, stderr: String, timedOut: Bool, error: String, cancelled!: Bool = false, stdoutTruncated!: Bool = false, stderrTruncated!: Bool = false, outputComplete!: Bool = true, exitObserved!: Bool = true) {
        this.exitObserved = exitObserved
        this.exitCode = exitCode
        this.stdout = stdout
        this.stderr = stderr
        this.timedOut = timedOut
        this.error = error
        this.cancelled = cancelled
        this.stdoutTruncated = stdoutTruncated
        this.stderrTruncated = stderrTruncated
        this.outputComplete = outputComplete
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

// 输出读取帮助类；只负责限额和编码，不提供沙箱隔离。
class ShellCapture {
    let text: String
    let truncated: Bool
    let complete: Bool
    init(text: String, truncated: Bool, complete: Bool) { this.text = text; this.truncated = truncated; this.complete = complete }
}

// 所有命令先包装成启动动作；执行任务可让 TurnToken 把该动作与取消串行化。
class OwnedProcessStart <: CancellationStartAction {
    let command: String
    let args: Array<String>
    let workingDirectory: ?Path
    var child: ?SubProcess = None
    init(command: String, args: Array<String>, workingDirectory: ?Path) {
        this.command = command
        this.args = args
        this.workingDirectory = workingDirectory
    }
    public func start(): Bool {
        child = Some(launch(command, args, workingDirectory: workingDirectory,
            stdIn: ProcessRedirect.Discard, stdOut: ProcessRedirect.Pipe, stdErr: ProcessRedirect.Pipe))
        return true
    }
    func take(): SubProcess {
        return child.getOrThrow()
    }
}

// 每路保留 64 KiB 后继续排空，避免限额导致子进程被管道反压挂住。
func readShellBounded(pipe: InputStream, limit!: Int64 = 65536): ShellCapture {
    let kept = ArrayList<Byte>()
    let buffer = Array<Byte>(4096, repeat: 0)
    var truncated = false
    while (true) {
        let count = pipe.read(buffer)
        if (count == 0) { break }
        for (i in 0..count) { if (kept.size < limit) { kept.add(buffer[i]) } else { truncated = true } }
    }
    let bytes = kept.toArray()
    var end = bytes.size
    if (truncated && end > 0) {
        var start = end - 1
        while (start > 0 && bytes[start] >= 128 && bytes[start] < 192) { start -= 1 }
        let lead = bytes[start]
        let width = if (lead < 128) { 1 } else if (lead < 224) { 2 } else if (lead < 240) { 3 } else { 4 }
        if (end - start < width) { end = start }
    }
    try { return ShellCapture(String.fromUtf8(bytes[0..end]), truncated, true) }
    catch (_: Exception) { return ShellCapture("", truncated, false) }
}

// 执行器校验模式名称，但当前 SandboxRuntime 不提供操作系统隔离。
// 未知模式和显式缺后端拒绝；产品入口仍需独立授权与真实能力探针。
public class ShellExecutor {
    let workingDirectory: String
    let sandboxRuntime: SandboxRuntime

    public init(workingDirectory!: String = "", sandboxRuntime!: SandboxRuntime = platformSandbox(workingDirectory)) {
        this.workingDirectory = workingDirectory
        this.sandboxRuntime = sandboxRuntime
    }

    // 执行命令并返回结果。
    // command: 可执行文件路径；args: 命令行参数；cwd: 工作目录（空串用构造时的值）。
    // timeoutMs: 等待子进程退出的超时毫秒数；sandboxMode: 沙箱策略档位。
    // 返回 None 表示执行失败（命令不存在、沙箱拒绝、管道错误）。
    public func run(command: String, args: Array<String>, cwd!: String = "",
                    timeoutMs!: Int64 = 30000, sandboxMode!: String = "workspace-write", cancelled!: () -> Bool = { => false },
                    onStarted!: (Int64) -> Unit = { _ => }, outputLimit!: Int64 = 65536,
                    startToken!: ?TurnToken = None, onCreated!: (Int64) -> Unit = { _ => }): Option<ShellResult> {
        if (timeoutMs < 1 || timeoutMs > 300000 || outputLimit < 1 || outputLimit > 65536 || cancelled()) { return None }
        // 这里只验证策略名称；现有 SandboxRuntime 不提供操作系统隔离。
        let fullArgs = ArrayList<String>()
        fullArgs.add(command)
        for (a in args) { fullArgs.add(a) }
        var confined = Array<String>()
        try {
            confined = sandboxRuntime.confine(fullArgs.toArray(), sandboxMode)
        } catch (e: Exception) {
            return None
        }

        let resolvedCwd = if (cwd.size > 0) { cwd } else { workingDirectory }
        var wdOpt: Option<Path> = None
        if (resolvedCwd.size > 0) { wdOpt = Some(Path(resolvedCwd)) }
        return runOwnedProcess(confined[0], confined[1..], wdOpt, timeoutMs, outputLimit, cancelled, onStarted,
            startToken: startToken, onCreated: onCreated)
    }

    // 执行 shell 命令字符串（经 shell 包装）。
    // shellCmd: shell 可执行文件（如 "bash" / "cmd"）；shellArgs: shell 参数（如 ["-c"]）。
    // commandStr: 要执行的命令字符串，作为 shell 的参数。
    public func runShellCommand(shellCmd: String, shellArgs: Array<String>,
                                commandStr: String, cwd!: String = "",
                                timeoutMs!: Int64 = 30000,
                                sandboxMode!: String = "workspace-write", cancelled!: () -> Bool = { => false }): Option<ShellResult> {
        if (timeoutMs < 1 || timeoutMs > 300000 || cancelled()) { return None }
        let shell = shellCmd.toAsciiLower()
        let cmd = shell == "cmd" || shell == "cmd.exe" || shell.endsWith("/cmd.exe") || shell.endsWith("\\cmd.exe")
        let powershell = shell == "powershell" || shell == "powershell.exe" || shell.endsWith("/powershell.exe") || shell.endsWith("\\powershell.exe")
        if (shellWindows && (cmd || powershell)) {
            let supported = shellArgs.size == 1 && ((cmd && shellArgs[0].toAsciiLower() == "/c") || (powershell && shellArgs[0].toAsciiLower() == "-command"))
            if (!supported) { return Some(ShellResult(-1, "", "", false, "unsupported-shell-arguments")) }
            if (commandStr.contains("\u{0}")) { return None }
            if (cmd && commandStr.size > 7500) { return Some(ShellResult(-1, "", "", false, "shell-command-too-large")) }
            var script = "$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);$OutputEncoding=[Console]::OutputEncoding;" + commandStr
            var transport = shellCmd
            if (cmd) {
                let raw = ("/d /s /c \"" + commandStr + "\"").replace("'", "''")
                script = "$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';$p=[System.Diagnostics.Process]::new();"
                script += "$p.StartInfo.FileName='${shellCmd.replace("'", "''")}';$p.StartInfo.Arguments='${raw}';"
                script += "$p.StartInfo.UseShellExecute=$false;$p.StartInfo.CreateNoWindow=$true;"
                script += "$p.StartInfo.RedirectStandardOutput=$true;$p.StartInfo.RedirectStandardError=$true;$p.StartInfo.RedirectStandardInput=$true;"
                script += "$p.StartInfo.WorkingDirectory=[Environment]::CurrentDirectory;"
                script += "[void]$p.Start();$p.StandardInput.Close();"
                script += "$out=$p.StandardOutput.BaseStream.CopyToAsync([Console]::OpenStandardOutput());"
                script += "$err=$p.StandardError.BaseStream.CopyToAsync([Console]::OpenStandardError());"
                script += "$p.WaitForExit();[void]$out.GetAwaiter().GetResult();[void]$err.GetAwaiter().GetResult();exit $p.ExitCode;"
                transport = "powershell.exe"
            }
            let encoded = shellEncodedCommand(script)
            if (encoded.size > 28000) { return Some(ShellResult(-1, "", "", false, "shell-command-too-large")) }
            return run(transport, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
                cwd: cwd, timeoutMs: timeoutMs, sandboxMode: sandboxMode, cancelled: cancelled)
        }
        let args = ArrayList<String>()
        for (a in shellArgs) { args.add(a) }
        args.add(commandStr)
        return run(shellCmd, args.toArray(), cwd: cwd, timeoutMs: timeoutMs, sandboxMode: sandboxMode, cancelled: cancelled)
    }
}

// 包内的实际进程监督原语；不对模型或协议开放裸执行入口。
// 调用前必须已有 enforcing argv，或是测试指定的无副作用固定命令。
func runOwnedProcess(command: String, args: Array<String>, wdOpt: ?Path, timeoutMs: Int64,
    outputLimit: Int64, cancelled: () -> Bool, onStarted: (Int64) -> Unit,
    startToken!: ?TurnToken = None, onCreated!: (Int64) -> Unit = { _ => }): ?ShellResult {
        if (timeoutMs < 1 || timeoutMs > 300000 || outputLimit < 1 || outputLimit > 65536 || cancelled()) { return None }
        try {
            let launchRequest = OwnedProcessStart(command, args, wdOpt)
            if (let Some(token) <- startToken) {
                if (!token.runStartIfNotCancelled(launchRequest)) { return None }
            } else {
                launchRequest.start()
            }
            let p = launchRequest.take()
            try { onCreated(p.pid) }
            catch (e: Exception) {
                try { p.terminate(force: true); p.wait(timeout: 3000 * Duration.millisecond) } catch (_: Exception) {}
                throw e
            }
            let started = MonoTime.now()

            // 两路读取都离开等待线程，不关闭管道不能绕过超时检查。
            let stdoutFuture = spawn { => readShellBounded(p.stdOutPipe, limit: outputLimit) }
            let stderrFuture = spawn { => readShellBounded(p.stdErrPipe, limit: outputLimit) }
            try { onStarted(p.pid) }
            catch (e: Exception) {
                try { p.terminate(force: true); p.wait(timeout: 3000 * Duration.millisecond) } catch (_: Exception) {}
                throw e
            }
            var code: Int64 = -1
            var timedOut = false
            var wasCancelled = false
            var failure = ""
            var observed = false
            while (true) {
                wasCancelled = cancelled()
                timedOut = !wasCancelled && (MonoTime.now() - started).toMilliseconds() >= timeoutMs
                if (wasCancelled || timedOut) {
                    try { p.terminate(force: true); code = p.wait(timeout: 3000 * Duration.millisecond); observed = true }
                    catch (_: Exception) { failure = "process-termination-unconfirmed" }
                    break
                }
                try { code = p.wait(timeout: 50 * Duration.millisecond); observed = true; break }
                catch (_: Exception) {}
            }
            var stdout = ShellCapture("", false, false)
            var stderr = ShellCapture("", false, false)
            try { stdout = stdoutFuture.get(1000 * Duration.millisecond) } catch (_: Exception) {}
            try { stderr = stderrFuture.get(1000 * Duration.millisecond) } catch (_: Exception) {}
            let complete = stdout.complete && stderr.complete
            if (!complete && failure.size == 0) { failure = "output-incomplete" }
            return Some(ShellResult(code, stdout.text, stderr.text, timedOut, failure,
                cancelled: wasCancelled, stdoutTruncated: stdout.truncated,
                stderrTruncated: stderr.truncated, outputComplete: complete, exitObserved: observed))
        } catch (e: Exception) {
            return None
        }
    }
