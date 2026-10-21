package core

import std.collection.*
import std.fs.*
import std.io.InputStream
import std.process.*
import std.sync.{AtomicBool, Mutex}
import std.time.MonoTime
import stdx.encoding.base64.*

// registry 仅为连接登记投影，不代表主机信任或远端命令授权。
// 信任接口只供可信调用方接线；不得直接暴露给模型，确认必须来自独立用户操作。
public class SshHostKeyCandidate {
    public let host: String
    public let port: Int64
    public let publicKey: String
    public let fingerprint: String
    init(host: String, port: Int64, publicKey: String, fingerprint: String) {
        this.host = host; this.port = port
        this.publicKey = publicKey; this.fingerprint = fingerprint
    }
}

func sshSafeHost(host: String): Bool {
    if (host.size == 0 || host.startsWith("-")) { return false }
    for (b in host.toArray()) {
        if (!((b >= 97 && b <= 122) || (b >= 48 && b <= 57) ||
            b == 45 || b == 46 || b == 58)) { return false }
    }
    return true
}

func sshSafeUser(user: String): Bool {
    for (b in user.toArray()) {
        if (!((b >= 65 && b <= 90) || (b >= 97 && b <= 122) ||
            (b >= 48 && b <= 57) || b == 45 || b == 95 || b == 46)) { return false }
    }
    return !user.startsWith("-")
}

func sshEffectivePort(port: Int64): Int64 { return if (port == -1) { 22 } else { port } }

// 只接收规范 ed25519 公钥，防止 known_hosts 注入通配符、CA、额外行与算法混淆。
func sshCandidate(host: String, port: Int64, key: String): SshHostKeyCandidate {
    let actualPort = sshEffectivePort(port)
    if (!sshSafeHost(host) || actualPort < 1 || actualPort > 65535 || key.size > 128) {
        throw Exception("ssh-invalid-host-key")
    }
    let parts = key.split(" ")
    if (parts.size != 2 || parts[0] != "ssh-ed25519") { throw Exception("ssh-unsupported-host-key") }
    let bytes = fromBase64String(parts[1]).getOrThrow()
    let prefix: Array<Byte> = [0, 0, 0, 11, 115, 115, 104, 45, 101, 100, 50, 53, 53, 49, 57, 0, 0, 0, 32]
    if (bytes.size != 51 || toBase64String(bytes) != parts[1]) { throw Exception("ssh-invalid-host-key") }
    for (i in 0..prefix.size) {
        if (bytes[i] != prefix[i]) { throw Exception("ssh-invalid-host-key") }
    }
    let fingerprint = "SHA256:" + toBase64String(sha256Digest(bytes)).replace("=", "")
    return SshHostKeyCandidate(host, actualPort, key, fingerprint)
}

// root 必须是 SaCode 私有受管绝对目录，不得指向用户 ~/.ssh。
// 每个目标首次确认时独占创建目录；并发确认或中途失败均不覆盖已有 pin。
// 不自动扫描、自动确认、轮换或删除 pin。目录权限由可信装配方保证。
public class SshHostTrust {
    let root: String
    let mutex = Mutex()
    public init(root: String) {
        let path = root.replace("\\", "/")
        let bytes = path.toArray()
        let drive = bytes.size > 2 && bytes[1] == 58 && bytes[2] == 47
        if (!(path.startsWith("/") || drive) || path.contains("..")) { throw Exception("ssh-invalid-trust-root") }
        for (b in bytes) {
            if (!((b >= 65 && b <= 90) || (b >= 97 && b <= 122) ||
                (b >= 48 && b <= 57) || b == 47 || b == 58 || b == 45 || b == 95 || b == 46 || b == 32)) {
                throw Exception("ssh-invalid-trust-root")
            }
        }
        this.root = path
    }

    func targetDir(host: String, port: Int64): String {
        return root + "/" + sha256Hex("[${host}]:${port}".toArray())
    }

    func hostPattern(host: String, port: Int64): String {
        return if (port == 22) { host } else { "[${host}]:${port}" }
    }

    func line(candidate: SshHostKeyCandidate): String {
        return "${hostPattern(candidate.host, candidate.port)} ${candidate.publicKey}\n"
    }

    func readPin(path: String): String {
        var result = ""
        try (file = File(path, OpenMode.Read)) {
            let exceeded = AtomicBool(false)
            let captured = sshReadBounded(file, 512, exceeded)
            if (captured.failed || exceeded.load()) { throw Exception("ssh-invalid-trust-file") }
            result = String.fromUtf8(captured.bytes)
        }
        return result
    }

    // 公钥可由不可信扫描或独立渠道提供；返回候选本身绝不建立信任。
    public func prepare(host: String, port: Int64, publicKey: String): SshHostKeyCandidate {
        let candidate = sshCandidate(host, port, publicKey)
        synchronized(mutex) {
            let dir = targetDir(candidate.host, candidate.port)
            if (exists(dir)) {
                if (readPin(dir + "/known_hosts") != line(candidate)) {
                    throw Exception("ssh-host-key-changed")
                }
            }
        }
        return candidate
    }

    // 调用方须单独展示目标、指纹及 TOFU 风险，接收用户重新确认的完整指纹。
    // 这不是远端命令批准；失败不回退为自动信任，已有目标永不覆盖。
    public func confirm(candidate: SshHostKeyCandidate, fingerprint: String): Unit {
        let checked = sshCandidate(candidate.host, candidate.port, candidate.publicKey)
        if (fingerprint != checked.fingerprint || fingerprint != candidate.fingerprint) {
            throw Exception("ssh-fingerprint-mismatch")
        }
        synchronized(mutex) {
            let dir = targetDir(checked.host, checked.port)
            if (exists(dir)) {
                if (readPin(dir + "/known_hosts") != line(checked)) {
                    throw Exception("ssh-host-key-changed")
                }
            } else {
                if (!exists(root)) { Directory.create(root, recursive: true) }
                Directory.create(dir)
                File.writeTo(dir + "/known_hosts", line(checked).toArray())
            }
        }
    }

    func knownHosts(host: String, port: Int64): String {
        let path = targetDir(host, port) + "/known_hosts"
        // 有界读取，且只接受一条规范 pin；损坏与缺失均阻断，不触发学习。
        try (file = File(path, OpenMode.Read)) {
            let exceeded = AtomicBool(false)
            let captured = sshReadBounded(file, 512, exceeded)
            if (captured.failed || exceeded.load()) { throw Exception("ssh-invalid-trust-file") }
            let text = String.fromUtf8(captured.bytes)
            let prefix = hostPattern(host, port) + " "
            if (!text.startsWith(prefix) || !text.endsWith("\n")) { throw Exception("ssh-invalid-trust-file") }
            let raw = text.toArray()
            let key = String.fromUtf8(raw[prefix.size..raw.size - 1])
            let candidate = sshCandidate(host, port, key)
            if (text != line(candidate)) { throw Exception("ssh-invalid-trust-file") }
        }
        return path
    }
}

public class SshExecResult {
    public let ok: Bool
    public let exitCode: Int64
    public let stdout: String
    public let stderr: String
    public let timedOut: Bool
    public let cancelled: Bool
    public let failureKind: String
    public let message: String
    public let elapsedMs: Int64
    public init(ok: Bool, exitCode: Int64, stdout: String, stderr: String,
                timedOut: Bool, cancelled: Bool, failureKind: String, message: String, elapsedMs: Int64) {
        this.ok = ok; this.exitCode = exitCode; this.stdout = stdout; this.stderr = stderr
        this.timedOut = timedOut; this.cancelled = cancelled; this.failureKind = failureKind
        this.message = message; this.elapsedMs = elapsedMs
    }
}

// 不读取用户配置，不开放任意 options；严格握手只使用受管 pin，不允许全局 CA 扩权。
public func sshArgv(host: String, user: String, command: String, options: Array<String>,
                    port: Int64, connectTimeoutSec: Int64, knownHostsFile!: String = ""): Array<String> {
    if (!sshSafeHost(host) || !sshSafeUser(user) || options.size != 0 || knownHostsFile.size == 0 ||
        knownHostsFile.contains("\"") || knownHostsFile.contains("\n") || knownHostsFile.contains("\r") ||
        knownHostsFile.contains("%") || connectTimeoutSec <= 0 ||
        sshEffectivePort(port) < 1 || sshEffectivePort(port) > 65535) { throw Exception("ssh-invalid-args") }
    let out = ArrayList<String>()
    out.add("-F"); out.add("none")
    for (option in ["BatchMode=yes", "ConnectTimeout=${connectTimeoutSec}", "StrictHostKeyChecking=yes",
        "UserKnownHostsFile=\"${knownHostsFile}\"", "GlobalKnownHostsFile=none", "KnownHostsCommand=none",
        "VerifyHostKeyDNS=no", "UpdateHostKeys=no", "HostKeyAlgorithms=ssh-ed25519", "CheckHostIP=no",
        "ProxyCommand=none", "ProxyJump=none", "PermitLocalCommand=no", "ClearAllForwardings=yes",
        "ForwardAgent=no", "ForwardX11=no", "ControlMaster=no", "ControlPath=none", "RequestTTY=no"]) {
        out.add("-o"); out.add(option)
    }
    out.add("-p"); out.add("${sshEffectivePort(port)}")
    out.add(if (user.size > 0) { "${user}@${host}" } else { host })
    out.add(command)
    return out.toArray()
}

class SshCapture {
    let bytes: Array<Byte>
    let failed: Bool
    init(bytes: Array<Byte>, failed: Bool) { this.bytes = bytes; this.failed = failed }
}

func sshReadBounded(pipe: InputStream, limit: Int64, exceeded: AtomicBool): SshCapture {
    let kept = ArrayList<Byte>()
    let buffer = Array<Byte>(4096, repeat: 0)
    var failed = false
    var overflow = false
    try {
        while (true) {
            let count = pipe.read(buffer)
            if (count == 0) { break }
            if (count > limit - kept.size) { overflow = true; break }
            for (i in 0..count) { kept.add(buffer[i]) }
        }
    } catch (_: Exception) { failed = true }
    if (overflow) { exceeded.store(true) }
    if (failed || overflow) { return SshCapture([], failed) }
    return SshCapture(kept.toArray(), false)
}

public class SshExecutor {
    let registry: SshRegistry
    let log: SessionLog
    let binary: String
    let maxOutputBytes: Int64
    let trust: Option<SshHostTrust>
    public init(registry: SshRegistry, log: SessionLog, binary!: String = "ssh",
                maxOutputBytes!: Int64 = 1048576, trust!: Option<SshHostTrust> = None) {
        this.registry = registry; this.log = log; this.binary = binary
        this.maxOutputBytes = maxOutputBytes; this.trust = trust
    }

    public func run(host: String, command: String, user!: String = "", options!: Array<String> = [],
                    port!: Int64 = -1, token!: TurnToken = TurnToken(), timeoutMs!: Int64 = 30000,
                    connectTimeoutSec!: Int64 = 10): SshExecResult {
        let started = MonoTime.now()
        if (token.cancelled()) { return result(started, -1, "cancelled") }
        let actualPort = sshEffectivePort(port)
        if (!sshSafeHost(host) || !sshSafeUser(user) || command.size == 0 || options.size != 0 ||
            actualPort < 1 || actualPort > 65535 || timeoutMs <= 0 || connectTimeoutSec <= 0 || maxOutputBytes <= 0) {
            return result(started, -1, "bad-args")
        }
        try {
            if (registry.status(host) != "connected") { return result(started, -1, "not-registered") }
        } catch (_: Exception) { return result(started, -1, "not-registered") }
        if (trust.isNone()) { return result(started, -1, "host-key-unconfirmed") }
        var knownHosts = ""
        try { knownHosts = trust.getOrThrow().knownHosts(host, actualPort) }
        catch (_: Exception) { return result(started, -1, "host-key-unconfirmed") }
        let args = sshArgv(host, user, command, options, port, connectTimeoutSec, knownHostsFile: knownHosts)
        if (token.cancelled()) { return result(started, -1, "cancelled") }
        if (elapsedOf(started) >= timeoutMs) { return result(started, -1, "timeout") }
        let launched = launchProcess(binary, args)
        if (launched.isNone()) { return result(started, -1, "spawn-failed") }
        return collect(launched.getOrThrow(), host, token, timeoutMs, started)
    }

    // 每路独立限额；主线程不读管道，退出后仍监督继承管道未关闭的情况。
    func collect(proc: SubProcess, host: String, token: TurnToken, timeoutMs: Int64, started: MonoTime): SshExecResult {
        let exceeded = AtomicBool(false)
        let outPipe = proc.stdOutPipe
        let errPipe = proc.stdErrPipe
        let stdout = spawn { => sshReadBounded(outPipe, maxOutputBytes, exceeded) }
        let stderr = spawn { => sshReadBounded(errPipe, maxOutputBytes, exceeded) }
        var code: Int64 = -1
        var exited = false
        var failure = ""
        var out: Option<SshCapture> = None
        var err: Option<SshCapture> = None
        while (true) {
            if (token.cancelled()) { failure = "cancelled"; break }
            let remaining = timeoutMs - elapsedOf(started)
            if (remaining <= 0) { failure = "timeout"; break }
            if (exceeded.load()) { failure = "output-limit"; break }
            out = stdout.tryGet(); err = stderr.tryGet()
            if (let Some(capture) <- out) {
                if (capture.failed) { failure = "io-error"; break }
            }
            if (let Some(capture) <- err) {
                if (capture.failed) { failure = "io-error"; break }
            }
            if (exceeded.load()) { failure = "output-limit"; break }
            if (exited && out.isSome() && err.isSome()) { break }
            let interval = min(Int64(50), remaining) * Duration.millisecond
            if (exited) { sleep(interval) }
            else {
                try { code = proc.wait(timeout: interval); exited = true }
                catch (_: Exception) {}
            }
        }
        if (failure.size > 0) {
            // 只终止本地进程，不宣称远端命令或所有持管道后代已经停止。
            try { proc.terminate(force: true) } catch (_: Exception) {}
            if (!exited) {
                try { code = proc.wait(timeout: Duration.second) } catch (_: Exception) {}
            }
            try { stdout.get(50 * Duration.millisecond) } catch (_: Exception) {}
            try { stderr.get(50 * Duration.millisecond) } catch (_: Exception) {}
        }
        var outText = ""
        var errText = ""
        if (failure.size == 0) {
            try {
                outText = String.fromUtf8(out.getOrThrow().bytes)
                errText = String.fromUtf8(err.getOrThrow().bytes)
            } catch (_: Exception) { failure = "io-error"; outText = ""; errText = "" }
        }
        // append 只是记账；持久化仍由上层 checkpoint/flush 负责。
        log.append("ssh/exec", "${host}::${code}")
        if (failure.size > 0) { return result(started, code, failure) }
        if (code != 0) { return result(started, code, "transport", stdout: outText, stderr: errText) }
        return result(started, code, "", stdout: outText, stderr: errText)
    }

    func launchProcess(cmd: String, args: Array<String>): Option<SubProcess> {
        try {
            return Some(launch(cmd, args, stdIn: ProcessRedirect.Discard,
                stdOut: ProcessRedirect.Pipe, stdErr: ProcessRedirect.Pipe))
        } catch (_: Exception) { return None }
    }
    func result(started: MonoTime, code: Int64, kind: String, stdout!: String = "", stderr!: String = ""): SshExecResult {
        return SshExecResult(kind.size == 0, code, stdout, stderr, kind == "timeout", kind == "cancelled",
            kind, if (kind.size == 0) { "" } else { "ssh-${kind}" }, elapsedOf(started))
    }
    func elapsedOf(started: MonoTime): Int64 { return (MonoTime.now() - started).toMilliseconds() }
}
