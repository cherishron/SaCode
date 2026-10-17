package core
import std.collection.*
import std.fs.*
import std.unittest.*

// 不变量：把方案 §4 的 18 条冻结口径登记成可运行快照。`register(id, description)`
// 落 log-only `invariant/register` 事件；`check(id, ok)` 落 `invariant/check`；
// `status(id)` 从事件流回放取最近一次 check 结果；未登记 id check 抛。

@Test
func invariantsRegisterAndCheck() {
    let root = "core-inv-happy"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let inv = InvariantRegistry(log)
    inv.register("inv-01", "会话日志是唯一真源")
    inv.check("inv-01", true)
    @Expect(inv.status("inv-01"), "pass")
    inv.check("inv-01", false)
    @Expect(inv.status("inv-01"), "fail")
    removeIfExists(root, recursive: true)
}

@Test
func invariantsCheckUnknownRejected() {
    let root = "core-inv-unknown"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let inv = InvariantRegistry(log)
    var threw = false
    try {
        inv.check("ghost", true)
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    removeIfExists(root, recursive: true)
}

@Test
func invariantsEmptyIdOrDescRejected() {
    let root = "core-inv-empty"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let inv = InvariantRegistry(log)
    var threwId = false
    try {
        inv.register("", "x")
    } catch (e: Exception) {
        threwId = true
    }
    @Expect(threwId, true)
    var threwDesc = false
    try {
        inv.register("inv-01", "")
    } catch (e: Exception) {
        threwDesc = true
    }
    @Expect(threwDesc, true)
    removeIfExists(root, recursive: true)
}

@Test
func invariantsEventsAreLogOnlyAcrossReplay() {
    let root = "core-inv-replay"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let inv = InvariantRegistry(log)
    log.append("user/message", "开工")
    inv.register("inv-01", "会话日志是唯一真源")
    inv.check("inv-01", true)
    @Expect(log.flush(), true)
    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    @Expect(fresh.deriveMessages().size, Int64(1))
    @Expect(InvariantRegistry(fresh).status("inv-01"), "pass")
    removeIfExists(root, recursive: true)
}
