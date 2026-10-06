package core

import std.collection.*
import std.process.*
import std.time.MonoTime

// SSH 真实驱动（H/W70）：上游 `ctx.ssh.exec(host, command)` 的真子进程实现。
//
// 与 `ssh.cj` 的分工：`SshRegistry` 是**权限面**（目标注册表 + `ssh/target` 事件），
// 本执行器是**执行面**——真正拉起 `ssh` 子进程跑远端命令。两条面合成一个闭环：
//   1. 权限：执行前必须 `registry.status(host) == "connected"`，未注册或已断开
//      一律不发起连接，也**不落任何审计事件**；
//   2. 审计：真正发起过的执行（成功或失败）落 `ssh/exec` 事件 `<host>::<exitCode>`，
//      于是日志能答出「这台机器连过几次、各次结局如何」；
//   3. 取消：`TurnToken` 在三个检查点生效——发起前、等待期间每步轮询、进程收束后。
//      取消路径强制终止子进程，绝不留孤儿 `ssh`；
//   4. 超时：等待循环用真实单调钟算 deadline，超时即 `terminate(force: true)`，
//      区分 `timedOut` 与 `cancelled` 两种非正常收束；
//   5. fail-closed：ssh 不存在、参数为空、管道异常都归一成结构化结果，不抛。
//
// 为什么不套 SandboxRuntime：沙箱档位（read-only / workspace-write）约束的是
// 「能不能写工作区」，而 SSH 的本质是**出站到一台外部机器**，不在沙箱模型里。
// 它的权限门就是上面的目标注册表——必须先登记这台 host 才能连它。

// SSH 执行结果：一律结构化返回（不抛），ok=false 时 failureKind 指名原因。
public class SshExecResult {
    public let ok: Bool
    public let exitCode: Int64
    public let stdout: String
    public let stderr: String
    public let timedOut: Bool
    public let cancelled: Bool
    public let failureKind: String   // "" | not-registered | bad-args | spawn-failed | transport
    public let message: String
    public let elapsedMs: Int64

    public init(ok: Bool, exitCode: Int64, stdout: String, stderr: String,
                timedOut: Bool, cancelled: Bool, failureKind: String, message: String,
                elapsedMs: Int64) {
        this.ok = ok
        this.exitCode = exitCode
        this.stdout = stdout
        this.stderr = stderr
        this.timedOut = timedOut
        this.cancelled = cancelled
        this.failureKind = failureKind
        this.message = message
        this.elapsedMs = elapsedMs
    }
}

// 单步轮询粒度：足够细能让「取消」在 200ms 内被看见，又不至于把 syscall 打成空转。
let pollStepMs: Int64 = 200

// 拼 argv。抽成纯函数是为了让测试能逐字符核对命令行，不必真连一次网络。
// 形态：ssh <options> [-p <port>] <user>@<host> <command>
public func sshArgv(host: String, user: String, command: String,
                    options: Array<String>, port: Int64, connectTimeoutSec: Int64): Array<String> {
    let out = ArrayList<String>()
    // BatchMode：绝不弹交互提示（密码/指纹确认），配合下面的 StrictHostKeyChecking
    // 让「连不上」在有限时间内得到确定的拒绝，而不是挂死等人输入。
    out.add("-o")
    out.add("BatchMode=yes")
    out.add("-o")
    out.add("ConnectTimeout=${connectTimeoutSec}")
    out.add("-o")
    out.add("StrictHostKeyChecking=no")
    out.add("-o")
    out.add("UserKnownHostsFile=/dev/null")
    for (o in options) {
        out.add(o)
    }
    if (port > 0) {
        out.add("-p")
        out.add("${port}")
    }
    let target = if (user.size > 0) { "${user}@${host}" } else { host }
    out.add(target)
    out.add(command)
    return out.toArray()
}

// 真实 SSH 执行器。binary 可注入（测试可指到别处），默认取 PATH 上的 ssh。
public class SshExecutor {
    let registry: SshRegistry
    let log: SessionLog
    let binary: String
    let maxOutputBytes: Int64

    public init(registry: SshRegistry, log: SessionLog,
                binary!: String = "ssh", maxOutputBytes!: Int64 = 1048576) {
        this.registry = registry
        this.log = log
        this.binary = binary
        this.maxOutputBytes = maxOutputBytes
    }

    // 在已登记的 host 上执行远端命令。
    // user 空串表示用系统默认用户名；options 是原样追加的 ssh 选项；port<=0 用默认 22；
    // timeoutMs 是子进程总等待预算；connectTimeoutSec 是 ssh 自己的连接超时。
    public func run(host: String, command: String, user!: String = "",
                    options!: Array<String> = [], port!: Int64 = -1,
                    token!: TurnToken = TurnToken(), timeoutMs!: Int64 = 30000,
                    connectTimeoutSec!: Int64 = 10): SshExecResult {
        let started = MonoTime.now()

        if (token.cancelled()) {
            return cancelledResult(started)
        }
        if (host.size == 0 || command.size == 0) {
            return failResult(started, "bad-args", "ssh-empty-arg")
        }

        // 权限门：host 必须已登记且处于 connected
        let state: String
        try {
            state = registry.status(host)
        } catch (_: Exception) {
            return failResult(started, "not-registered", "ssh-unknown-host")
        }
        if (state != "connected") {
            return failResult(started, "not-registered", "ssh-target-disconnected")
        }

        let args = sshArgv(host, user, command, options, port, connectTimeoutSec)
        let argsList = ArrayList<String>()
        for (a in args) {
            argsList.add(a)
        }

        let procOpt = launchProcess(binary, argsList.toArray())
        if (procOpt.isNone()) {
            return failResult(started, "spawn-failed", "ssh-binary-not-found")
        }
        let p = procOpt.getOrThrow()

        // stderr 独立线程读，避免管道写满把远端命令卡死
        let stderrPipe = p.stdErrPipe
        let stderrFuture = spawn { => readAllStream(stderrPipe) }

        var stdout = ""
        var stderr = ""
        var code: Int64 = -1
        var timedOut = false
        var cancelled = false
        try {
            stdout = readAllStream(p.stdOutPipe)
        } catch (_: Exception) {
            stdout = ""
        }

        let deadline = MonoTime.now() + Duration.millisecond * timeoutMs
        while (true) {
            if (token.cancelled()) {
                cancelled = true
                break
            }
            let remaining = (deadline - MonoTime.now()).toMilliseconds()
            if (remaining <= 0) {
                timedOut = true
                break
            }
            let step = if (remaining < pollStepMs) { remaining } else { pollStepMs }
            try {
                code = p.wait(timeout: step * Duration.millisecond)
                break
            } catch (_: Exception) {
                // 本步没等到退出，继续下一轮
            }
        }

        if (cancelled || timedOut) {
            try { p.terminate(force: true) } catch (_: Exception) {}
            try { code = p.wait() } catch (_: Exception) { code = Int64(-1) }
        }

        try {
            stderr = stderrFuture.get(3000 * Duration.millisecond)
        } catch (_: Exception) {}

        let elapsed = elapsedOf(started)
        // 审计：真正发起过的执行都落盘（成功、失败、超时、取消都一样）
        log.append("ssh/exec", "${host}::${code}")

        if (cancelled) {
            return SshExecResult(false, code, stdout, stderr, false, true, "", "ssh-cancelled", elapsed)
        }
        if (timedOut) {
            return SshExecResult(false, code, stdout, stderr, true, false, "", "ssh-timeout", elapsed)
        }
        if (code == 0) {
            return SshExecResult(true, code, stdout, stderr, false, false, "", "", elapsed)
        }
        return SshExecResult(false, code, stdout, stderr, false, false, "transport",
            "ssh-exit-${code}", elapsed)
    }

    func launchProcess(cmd: String, args: Array<String>): Option<SubProcess> {
        try {
            let p = launch(cmd, args, stdIn: ProcessRedirect.Discard,
                stdOut: ProcessRedirect.Pipe, stdErr: ProcessRedirect.Pipe)
            return Some(p)
        } catch (_: Exception) {
            return None
        }
    }

    func cancelledResult(started: MonoTime): SshExecResult {
        return SshExecResult(false, Int64(0), "", "", false, true, "", "ssh-cancelled",
            elapsedOf(started))
    }

    func failResult(started: MonoTime, kind: String, message: String): SshExecResult {
        return SshExecResult(false, Int64(-1), "", "", false, false, kind, message,
            elapsedOf(started))
    }

    func elapsedOf(started: MonoTime): Int64 {
        return (MonoTime.now() - started).toMilliseconds()
    }
}
