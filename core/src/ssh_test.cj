package core
import std.collection.*
import std.fs.*
import std.unittest.*

// SSH 上游契约（M8）：`ctx.ssh.connect(host)` 建立远端；`disconnect(host)`；
// `status(host)` 返回 connected/disconnected。本切片以 log-only `ssh/target`
// 事件承载 `connect::<host>` / `disconnect::<host>`；投影读侧重建状态。

@Test
func sshConnectAndStatus() {
    let root = "core-ssh-connect"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let ssh = SshRegistry(log)
    ssh.connect("prod.example")
    @Expect(ssh.status("prod.example"), "connected")
    removeIfExists(root, recursive: true)
}

@Test
func sshDisconnectFlipsStatus() {
    let root = "core-ssh-drop"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let ssh = SshRegistry(log)
    ssh.connect("prod.example")
    ssh.disconnect("prod.example")
    @Expect(ssh.status("prod.example"), "disconnected")
    removeIfExists(root, recursive: true)
}

@Test
func sshStatusUnknownHostRejected() {
    let root = "core-ssh-unknown"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let ssh = SshRegistry(log)
    var threw = false
    try {
        ssh.status("ghost")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    removeIfExists(root, recursive: true)
}

@Test
func sshEventsAreLogOnlyAcrossReplay() {
    let root = "core-ssh-replay"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let ssh = SshRegistry(log)
    log.append("user/message", "开工")
    ssh.connect("prod.example")
    @Expect(log.flush(), true)
    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    @Expect(fresh.deriveMessages().size, Int64(1))
    @Expect(SshRegistry(fresh).status("prod.example"), "connected")
    removeIfExists(root, recursive: true)
}
