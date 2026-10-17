package core
import std.collection.*
import std.fs.*
import std.unittest.*

// Shell 上游契约（M4）：`ctx.shell.exec(argv, opts)` 派生 shell 子进程；
// `ShellSession { id, argv, cwd }`；本切片以 log-only `shell/exec` 事件承载
// `<id>::<argvJoinedBySpace>::<cwd>`。空 id/argv/cwd 抛；`list()` 从事件流回放。

@Test
func shellRecordsAndListsBack() {
    let root = "core-shell-list"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let sh = ShellLedger(log)
    sh.record("s1", "ls -la", "/tmp")
    sh.record("s2", "pwd", "/var")
    let list = sh.entries()
    @Expect(list.size, Int64(2))
    @Expect(list[0], "s1::ls -la::/tmp")
    removeIfExists(root, recursive: true)
}

@Test
func shellRejectsEmptyIdOrArgvOrCwd() {
    let root = "core-shell-empty"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let sh = ShellLedger(log)
    var threwId = false
    try {
        sh.record("", "ls", "/tmp")
    } catch (e: Exception) {
        threwId = true
    }
    @Expect(threwId, true)
    var threwArgv = false
    try {
        sh.record("s1", "", "/tmp")
    } catch (e: Exception) {
        threwArgv = true
    }
    @Expect(threwArgv, true)
    var threwCwd = false
    try {
        sh.record("s1", "ls", "")
    } catch (e: Exception) {
        threwCwd = true
    }
    @Expect(threwCwd, true)
    @Expect(sh.entries().size, Int64(0))
    removeIfExists(root, recursive: true)
}

@Test
func shellEventIsLogOnlyAcrossReplay() {
    let root = "core-shell-replay"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let sh = ShellLedger(log)
    log.append("user/message", "开工")
    sh.record("s1", "ls", "/tmp")
    @Expect(log.flush(), true)
    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    @Expect(fresh.deriveMessages().size, Int64(1))
    @Expect(ShellLedger(fresh).entries().size, Int64(1))
    removeIfExists(root, recursive: true)
}
