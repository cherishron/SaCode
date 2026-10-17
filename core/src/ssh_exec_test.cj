package core

import std.fs.*
import std.unittest.*

// SSH 真实驱动测试（H/W70）：不起假 provider，用真 `ssh` 二进制真连真机器。
//
// 环境事实（2026-10-06 实测）：本机装有 OpenSSH_for_Windows_9.5p2，且 127.0.0.1:22
// 有 sshd 在听。所以这里能测到三种真结果——连不上的端口、连得上但认证被拒、
// 以及完全没连出去就被权限门拦下的情形。

func sshExecRoot(tag: String): String {
    return "core-sshexec-${tag}"
}

func sshExecSetup(tag: String): (String, SessionLog, SshRegistry) {
    let root = sshExecRoot(tag)
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    return (root, log, SshRegistry(log))
}

func sshExecAuditCount(log: SessionLog, host: String): Int64 {
    var n: Int64 = 0
    for (event in log.snapshotEvents()) {
        if (event.eventType == "ssh/exec" && event.data.startsWith("${host}::")) {
            n = n + 1
        }
    }
    return n
}

func joinWith(items: Array<String>, sep: String): String {
    var out = ""
    var first = true
    for (s in items) {
        if (!first) {
            out += sep
        }
        out += s
        first = false
    }
    return out
}

// argv 形状：安全旗标齐、user@host、命令在末位。抽成纯函数以便逐字符核对。
@Test
func sshArgvShape() {
    let args = sshArgv("prod.example", "deploy", "ls -la", [], Int64(-1), Int64(10))
    let joined = joinWith(args, " ")
    @Expect(joined.contains("BatchMode=yes"), true)
    @Expect(joined.contains("ConnectTimeout=10"), true)
    @Expect(joined.contains("StrictHostKeyChecking=no"), true)
    @Expect(joined.contains("deploy@prod.example"), true)
    @Expect(args[args.size - 1], "ls -la")

    let withPort = sshArgv("prod.example", "", "uptime", ["-v"], Int64(2222), Int64(5))
    let j2 = joinWith(withPort, " ")
    @Expect(j2.contains(" -p 2222 "), true)
    @Expect(j2.contains("prod.example uptime"), true)
    @Expect(withPort[withPort.size - 1], "uptime")
}

// 权限门：未登记的 host 一个字节都不发，也不落审计事件。
@Test
func sshExecRejectsUnregisteredHost() {
    let (root, log, reg) = sshExecSetup("unreg")
    let exec = SshExecutor(reg, log)
    let r = exec.run("never-seen.example", "echo hi")
    @Expect(r.ok, false)
    @Expect(r.failureKind, "not-registered")
    @Expect(r.message, "ssh-unknown-host")
    @Expect(r.stdout, "")
    @Expect(r.stderr, "")
    @Expect(sshExecAuditCount(log, "never-seen.example"), Int64(0))
    removeIfExists(root, recursive: true)
}

// 权限门：曾登记但已断开 → 同样不放行。
@Test
func sshExecRejectsDisconnectedHost() {
    let (root, log, reg) = sshExecSetup("dropped")
    reg.connect("prod.example")
    reg.disconnect("prod.example")
    let exec = SshExecutor(reg, log)
    let r = exec.run("prod.example", "echo hi")
    @Expect(r.ok, false)
    @Expect(r.failureKind, "not-registered")
    @Expect(r.message, "ssh-target-disconnected")
    @Expect(sshExecAuditCount(log, "prod.example"), Int64(0))
    removeIfExists(root, recursive: true)
}

// 参数校验：空 host 与空命令各自拒，发生在任何子进程之前。
@Test
func sshExecRejectsBadArgs() {
    let (root, log, reg) = sshExecSetup("badargs")
    reg.connect("prod.example")
    let exec = SshExecutor(reg, log)
    let r1 = exec.run("", "echo hi")
    @Expect(r1.ok, false)
    @Expect(r1.failureKind, "bad-args")
    let r2 = exec.run("prod.example", "")
    @Expect(r2.ok, false)
    @Expect(r2.failureKind, "bad-args")
    @Expect(sshExecAuditCount(log, "prod.example"), Int64(0))
    removeIfExists(root, recursive: true)
}

// 二进制不存在 → spawn-failed，绝不抛出。
@Test
func sshExecReportsMissingBinary() {
    let (root, log, reg) = sshExecSetup("nobb")
    reg.connect("prod.example")
    let exec = SshExecutor(reg, log, binary: "definitely-not-a-real-binary-xyz")
    let r = exec.run("prod.example", "echo hi", timeoutMs: 5000)
    @Expect(r.ok, false)
    @Expect(r.failureKind, "spawn-failed")
    @Expect(r.message, "ssh-binary-not-found")
    @Expect(sshExecAuditCount(log, "prod.example"), Int64(0))
    removeIfExists(root, recursive: true)
}

// 取消闭环：令牌已取消 → 连 ssh 都不启动，也不落审计事件。
@Test
func sshExecCancelledTokenShortCircuits() {
    let (root, log, reg) = sshExecSetup("cancelled")
    reg.connect("prod.example")
    let exec = SshExecutor(reg, log)
    let token = TurnToken()
    token.cancel()
    let r = exec.run("prod.example", "echo hi", token: token, timeoutMs: 5000)
    @Expect(r.ok, false)
    @Expect(r.cancelled, true)
    @Expect(r.message, "ssh-cancelled")
    @Expect(sshExecAuditCount(log, "prod.example"), Int64(0))
    removeIfExists(root, recursive: true)
}

// 真子进程 + 真网络：连一个没有监听的端口 → ssh 真实返回 255，stderr 是它自己的
// 真实报错文本，审计事件记下 host::255。这一条证明整条链路是真跑通的，不是 mock。
@Test
func sshExecRunsRealSshAgainstUnreachablePort() {
    let (root, log, reg) = sshExecSetup("real-refused")
    reg.connect("127.0.0.1")
    let exec = SshExecutor(reg, log)
    let r = exec.run("127.0.0.1", "echo hi", port: 9, timeoutMs: 15000,
        connectTimeoutSec: 4)
    @Expect(r.ok, false)
    @Expect(r.exitCode, Int64(255))
    @Expect(r.failureKind, "transport")
    @Expect(r.message, "ssh-exit-255")
    @Expect(r.stderr.size > 0, true)
    @Expect(sshExecAuditCount(log, "127.0.0.1"), Int64(1))
    removeIfExists(root, recursive: true)
}

// 真子进程 + 真握手：本机 22 端口有 sshd。BatchMode 下认证被拒也是真结果——
// 关键是证明 ssh 真的做完了协议握手而不是我们自己编的假报错。
@Test
func sshExecRunsRealSshAgainstLiveSshd() {
    let (root, log, reg) = sshExecSetup("real-auth")
    reg.connect("127.0.0.1")
    let exec = SshExecutor(reg, log)
    let r = exec.run("127.0.0.1", "echo HELLO", user: "jingg", timeoutMs: 20000,
        connectTimeoutSec: 5)
    @Expect(r.ok, false)
    @Expect(r.exitCode != 0, true)
    @Expect(r.failureKind, "transport")
    @Expect(r.stderr.size > 0, true)
    // 认证阶段的真实文本；本机 sshd 要求凭据，BatchMode 下必然是拒绝
    @Expect(r.stderr.contains("Permission denied"), true)
    @Expect(sshExecAuditCount(log, "127.0.0.1"), Int64(1))
    removeIfExists(root, recursive: true)
}

// 审计对账：发起 N 次执行，ssh/exec 事件恰为 N 条；被拦下的不计数。
@Test
func sshExecAuditMatchesExecutions() {
    let (root, log, reg) = sshExecSetup("audit")
    reg.connect("127.0.0.1")
    let exec = SshExecutor(reg, log)
    exec.run("127.0.0.1", "echo a", port: 9, timeoutMs: 15000, connectTimeoutSec: 3)
    exec.run("127.0.0.1", "echo b", port: 9, timeoutMs: 15000, connectTimeoutSec: 3)
    exec.run("not-registered.example", "echo c", timeoutMs: 15000)
    let token = TurnToken()
    token.cancel()
    exec.run("127.0.0.1", "echo d", token: token, timeoutMs: 15000)
    @Expect(sshExecAuditCount(log, "127.0.0.1"), Int64(2))
    @Expect(sshExecAuditCount(log, "not-registered.example"), Int64(0))
    removeIfExists(root, recursive: true)
}

// 超时：ssh 的 ConnectTimeout 与我们的总预算一致时，超时判定要走 timedOut 分支
// 而不是 transport。用 1 毫秒预算强制触发。
@Test
func sshExecReportsTimeout() {
    let (root, log, reg) = sshExecSetup("timeout")
    reg.connect("127.0.0.1")
    let exec = SshExecutor(reg, log)
    let r = exec.run("127.0.0.1", "echo hi", timeoutMs: 1, connectTimeoutSec: 5)
    @Expect(r.ok, false)
    @Expect(r.timedOut, true)
    @Expect(r.cancelled, false)
    @Expect(sshExecAuditCount(log, "127.0.0.1"), Int64(1))
    removeIfExists(root, recursive: true)
}
