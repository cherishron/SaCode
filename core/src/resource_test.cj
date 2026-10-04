package core
import std.collection.*
import std.fs.*
import std.unittest.*

// 客户端资源上游契约（M5/M6）：`dsh-resource://<kind>/<id>` 形式的 URI 命名空间。
// 本切片以 log-only `resource/register` 事件承载 `<uri>::<mimeType>`；`lookup(uri)`
// 取 mime，未登记返空串；`list()` 枚举所有已登记 uri。

@Test
func resourceRegisterThenLookupAndList() {
    let root = "core-rest-happy"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let res = ResourceRegistry(log)
    res.register("dsh-resource://panel/help", "text/html")
    res.register("dsh-resource://icon/pdf", "image/svg+xml")
    @Expect(res.lookup("dsh-resource://panel/help"), "text/html")
    @Expect(res.list().size, Int64(2))
    removeIfExists(root, recursive: true)
}

@Test
func resourceRejectsEmptyUriOrMime() {
    let root = "core-rest-empty"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let res = ResourceRegistry(log)
    var threwUri = false
    try {
        res.register("", "text/html")
    } catch (e: Exception) {
        threwUri = true
    }
    @Expect(threwUri, true)
    var threwMime = false
    try {
        res.register("dsh-resource://x/y", "")
    } catch (e: Exception) {
        threwMime = true
    }
    @Expect(threwMime, true)
    @Expect(res.list().size, Int64(0))
    removeIfExists(root, recursive: true)
}

@Test
func resourceUnknownLookupEmpty() {
    let root = "core-rest-unknown"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let res = ResourceRegistry(log)
    @Expect(res.lookup("ghost"), "")
    removeIfExists(root, recursive: true)
}

@Test
func resourceEventsAreLogOnlyAcrossReplay() {
    let root = "core-rest-replay"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let res = ResourceRegistry(log)
    log.append("user/message", "开工")
    res.register("dsh-resource://panel/help", "text/html")
    @Expect(log.flush(), true)
    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    @Expect(fresh.deriveMessages().size, Int64(1))
    @Expect(ResourceRegistry(fresh).lookup("dsh-resource://panel/help"), "text/html")
    removeIfExists(root, recursive: true)
}
