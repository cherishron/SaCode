package core

import std.collection.ArrayList
import std.env.*
import std.fs.*
import std.io.InputStream
import std.process.*
import std.sync.AtomicBool
import std.time.MonoTime
import std.unittest.*
import stdx.encoding.base64.*

// 安全前置与本地合成子进程测试，不依赖个人账户、真实网络或本机 sshd。
func sshExecSetup(tag: String): (String, SessionLog, SshRegistry) {
    if (!exists("target/tmp")) { Directory.create("target/tmp", recursive: true) }
    let root = canonicalize(Directory.createTemp(Path("target/tmp"))).toString()
    let log = SessionLog("${root}/session-${tag}.log")
    return (root, log, SshRegistry(log))
}

func sshTestKey(value: Byte): String {
    let blob = ArrayList<Byte>()
    let prefix: Array<Byte> = [0, 0, 0, 11, 115, 115, 104, 45, 101, 100, 50, 53, 53, 49, 57, 0, 0, 0, 32]
    for (b in prefix) { blob.add(b) }
    for (_ in 0..32) { blob.add(value) }
    return "ssh-ed25519 " + toBase64String(blob.toArray())
}

func sshExecAuditCount(log: SessionLog): Int64 {
    var count: Int64 = 0
    for (event in log.snapshotEvents()) {
        if (event.eventType == "ssh/exec") { count += 1 }
    }
    return count
}

func sshTestChild(windows: String, posix: String): SubProcess {
    let onWindows = (getVariable("OS") ?? "") == "Windows_NT"
    return launch(if (onWindows) { "powershell.exe" } else { "/bin/sh" },
        if (onWindows) { ["-NoProfile", "-NonInteractive", "-Command", windows] } else { ["-c", posix] },
        stdIn: ProcessRedirect.Discard, stdOut: ProcessRedirect.Pipe, stdErr: ProcessRedirect.Pipe)
}

class SshTestStream <: InputStream {
    let bytes: Array<Byte>
    let broken: Bool
    var offset: Int64 = 0
    init(bytes: Array<Byte>, broken!: Bool = false) { this.bytes = bytes; this.broken = broken }
    public func read(out: Array<Byte>): Int64 {
        if (broken) { throw Exception("fixture-read-failed") }
        let count = min(out.size, bytes.size - offset)
        for (i in 0..count) { out[i] = bytes[offset + i] }
        offset += count
        return count
    }
}

@Test
func sshArgvUsesOnlyStrictManagedTrust() {
    let args = sshArgv("prod.example", "deploy", "echo hi", [], 2222, 5,
        knownHostsFile: "C:/private trust/known_hosts")
    @Expect(args[0], "-F")
    @Expect(args[1], "none")
    for (flag in ["StrictHostKeyChecking=yes", "GlobalKnownHostsFile=none", "KnownHostsCommand=none",
        "UpdateHostKeys=no", "VerifyHostKeyDNS=no", "ProxyCommand=none", "ProxyJump=none",
        "ControlPath=none", "ForwardAgent=no", "ClearAllForwardings=yes",
        "UserKnownHostsFile=\"C:/private trust/known_hosts\""]) {
        var found = false
        for (arg in args) { if (arg == flag) { found = true } }
        @Expect(found, true)
    }
    @Expect(args[args.size - 2], "deploy@prod.example")
    @Expect(args[args.size - 1], "echo hi")
}

@Test
func sshArgvRejectsOptionsAndTargetInjection() {
    for ((host, user, options) in [("prod.example", "", ["-oProxyCommand=evil"]),
        ("-oProxyCommand=evil", "", []), ("prod.example\nother", "", []),
        ("prod.example", "evil@other", [])]) {
        var rejected = false
        try { sshArgv(host, user, "echo hi", options, 22, 5, knownHostsFile: "/private/known_hosts") }
        catch (_: Exception) { rejected = true }
        @Expect(rejected, true)
    }
}

@Test
func sshFirstFingerprintRequiresSeparateConfirmation() {
    let (root, log, reg) = sshExecSetup("first-trust")
    try {
        reg.connect("prod.example")
        let trust = SshHostTrust(root + "/trust")
        let exec = SshExecutor(reg, log, binary: "missing-ssh-fixture", trust: Some(trust))
        let candidate = trust.prepare("prod.example", 22, sshTestKey(1))
        @Expect(candidate.fingerprint.startsWith("SHA256:"), true)
        @Expect(exec.run("prod.example", "echo hi").failureKind, "host-key-unconfirmed")
        var rejected = false
        try { trust.confirm(candidate, "SHA256:wrong") } catch (_: Exception) { rejected = true }
        @Expect(rejected, true)
        @Expect(exec.run("prod.example", "echo hi").failureKind, "host-key-unconfirmed")
        trust.confirm(candidate, candidate.fingerprint)
        @Expect(exec.run("prod.example", "echo hi").failureKind, "spawn-failed")
        @Expect(sshExecAuditCount(log), Int64(0))
        let reloaded = SshHostTrust(root + "/trust")
        @Expect(reloaded.prepare("prod.example", 22, sshTestKey(1)).fingerprint, candidate.fingerprint)
        @Expect(SshExecutor(reg, log, binary: "missing-ssh-fixture", trust: Some(reloaded))
            .run("prod.example", "echo hi", port: 2222).failureKind, "host-key-unconfirmed")
    } finally { removeIfExists(root, recursive: true) }
}

@Test
func sshHostKeyChangeCannotOverwriteExistingPin() {
    let (root, _, _) = sshExecSetup("changed")
    try {
        let trust = SshHostTrust(root + "/trust")
        let first = trust.prepare("prod.example", 2222, sshTestKey(1))
        let changed = trust.prepare("prod.example", 2222, sshTestKey(2))
        trust.confirm(first, first.fingerprint)
        var prepareRejected = false
        var confirmRejected = false
        try { trust.prepare("prod.example", 2222, sshTestKey(2)) }
        catch (_: Exception) { prepareRejected = true }
        try { trust.confirm(changed, changed.fingerprint) }
        catch (_: Exception) { confirmRejected = true }
        @Expect(prepareRejected, true)
        @Expect(confirmRejected, true)
        @Expect(trust.prepare("prod.example", 2222, sshTestKey(1)).fingerprint, first.fingerprint)
        let path = trust.knownHosts("prod.example", 2222)
        @Expect(String.fromUtf8(File.readFrom(path)), "[prod.example]:2222 ${first.publicKey}\n")
    } finally { removeIfExists(root, recursive: true) }
}

@Test
func sshRejectsMalformedKeyAndCorruptTrustFile() {
    let (root, log, reg) = sshExecSetup("bad-pin")
    try {
        reg.connect("prod.example")
        let trust = SshHostTrust(root + "/trust")
        for (key in ["ssh-rsa AAAA", "ssh-ed25519 AAAA", sshTestKey(1) + "\n@cert-authority * bad"]) {
            var rejected = false
            try { trust.prepare("prod.example", 22, key) } catch (_: Exception) { rejected = true }
            @Expect(rejected, true)
        }
        let candidate = trust.prepare("prod.example", 22, sshTestKey(1))
        trust.confirm(candidate, candidate.fingerprint)
        let path = trust.knownHosts("prod.example", 22)
        @Expect(String.fromUtf8(File.readFrom(path)), "prod.example ${candidate.publicKey}\n")
        File.writeTo(path, "@cert-authority * invalid\n".toArray())
        let result = SshExecutor(reg, log, trust: Some(trust)).run("prod.example", "echo hi")
        @Expect(result.failureKind, "host-key-unconfirmed")
        @Expect(sshExecAuditCount(log), Int64(0))
    } finally { removeIfExists(root, recursive: true) }
}

@Test
func sshExecRejectsUnregisteredDisconnectedAndInvalidArguments() {
    let (root, log, reg) = sshExecSetup("gates")
    try {
        let exec = SshExecutor(reg, log)
        @Expect(exec.run("prod.example", "echo hi").failureKind, "not-registered")
        reg.connect("prod.example"); reg.disconnect("prod.example")
        @Expect(exec.run("prod.example", "echo hi").failureKind, "not-registered")
        reg.connect("prod.example")
        @Expect(exec.run("prod.example", "echo hi").failureKind, "host-key-unconfirmed")
        @Expect(exec.run("", "echo hi").failureKind, "bad-args")
        @Expect(exec.run("prod.example", "").failureKind, "bad-args")
        @Expect(exec.run("prod.example", "echo hi", options: ["-v"]).failureKind, "bad-args")
        @Expect(exec.run("prod.example", "echo hi", port: 0).failureKind, "bad-args")
        @Expect(exec.run("prod.example", "echo hi", timeoutMs: 0).failureKind, "bad-args")
        @Expect(SshExecutor(reg, log, maxOutputBytes: 0).run("prod.example", "echo hi").failureKind, "bad-args")
        let token = TurnToken(); token.cancel()
        @Expect(exec.run("", "", token: token, timeoutMs: 0).failureKind, "cancelled")
        @Expect(sshExecAuditCount(log), Int64(0))
    } finally { removeIfExists(root, recursive: true) }
}

@Test
func sshBoundedReaderUsesBytesAndRejectsOverflowAndReadFailure() {
    let exact = AtomicBool(false)
    let data = "中文\n".toArray()
    let captured = sshReadBounded(SshTestStream(data), data.size, exact)
    @Expect(String.fromUtf8(captured.bytes), "中文\n")
    @Expect(exact.load(), false)
    let exceeded = AtomicBool(false)
    @Expect(sshReadBounded(SshTestStream(Array<Byte>(16384, repeat: 120)), 16, exceeded).bytes.size, Int64(0))
    @Expect(exceeded.load(), true)
    @Expect(sshReadBounded(SshTestStream([], broken: true), 16, AtomicBool(false)).failed, true)
}

@Test
func sshTimeoutSupervisesSilentOpenStdout() {
    let (root, log, reg) = sshExecSetup("timeout")
    try {
        let proc = sshTestChild("Start-Sleep -Seconds 8", "exec sleep 8")
        let r = SshExecutor(reg, log).collect(proc, "fixture", TurnToken(), 200, MonoTime.now())
        @Expect(r.failureKind, "timeout")
        @Expect(r.timedOut, true)
        @Expect(r.elapsedMs < 4000, true)
        @Expect(sshExecAuditCount(log), Int64(1))
    } finally { removeIfExists(root, recursive: true) }
}

@Test
func sshCancellationSupervisesPartialOutputBeforeEof() {
    let (root, log, reg) = sshExecSetup("cancel")
    try {
        let proc = sshTestChild("[Console]::Out.Write('partial'); Start-Sleep -Seconds 8", "printf partial; exec sleep 8")
        let token = TurnToken()
        let cancel = spawn { => sleep(200 * Duration.millisecond); token.cancel() }
        let r = SshExecutor(reg, log).collect(proc, "fixture", token, 10000, MonoTime.now())
        cancel.get(Duration.second)
        @Expect(r.failureKind, "cancelled")
        @Expect(r.cancelled, true)
        @Expect(r.elapsedMs < 4000, true)
    } finally { removeIfExists(root, recursive: true) }
}

@Test
func sshEachOutputPipeHasIndependentLimit() {
    let (root, log, reg) = sshExecSetup("output-limit")
    try {
        for ((windows, posix) in [
            ("[Console]::Out.Write(('x' * 8192)); Start-Sleep -Seconds 8", "printf '%8192s' x; exec sleep 8"),
            ("[Console]::Out.Write('ok'); [Console]::Error.Write(('x' * 8192)); Start-Sleep -Seconds 8", "printf ok; printf '%8192s' x >&2; exec sleep 8")]) {
            let r = SshExecutor(reg, log, maxOutputBytes: 64).collect(
                sshTestChild(windows, posix), "fixture", TurnToken(), 10000, MonoTime.now())
            @Expect(r.failureKind, "output-limit")
            @Expect(r.stdout, "")
            @Expect(r.stderr, "")
            @Expect(r.elapsedMs < 4000, true)
        }
        @Expect(sshExecAuditCount(log), Int64(2))
    } finally { removeIfExists(root, recursive: true) }
}

@Test
func sshCollectPreservesBothPipesAndExitStatus() {
    let (root, log, reg) = sshExecSetup("exit")
    try {
        for (code in [Int64(0), 7]) {
            let proc = sshTestChild("[Console]::Out.Write('out'); [Console]::Error.Write('err'); exit ${code}",
                "printf out; printf err >&2; exit ${code}")
            let r = SshExecutor(reg, log, maxOutputBytes: 3).collect(proc, "fixture", TurnToken(), 10000, MonoTime.now())
            @Expect(r.ok, code == 0)
            @Expect(r.exitCode, code)
            @Expect(r.stdout, "out")
            @Expect(r.stderr, "err")
        }
        @Expect(sshExecAuditCount(log), Int64(2))
    } finally { removeIfExists(root, recursive: true) }
}

@Test
func sshCancellationHasPriorityOverExpiredBudget() {
    let (root, log, reg) = sshExecSetup("priority")
    try {
        let proc = sshTestChild("Start-Sleep -Seconds 8", "exec sleep 8")
        let token = TurnToken(); token.cancel()
        let r = SshExecutor(reg, log).collect(proc, "fixture", token, 0, MonoTime.now())
        @Expect(r.failureKind, "cancelled")
        @Expect(r.timedOut, false)
    } finally { removeIfExists(root, recursive: true) }
}
