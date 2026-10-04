package core
import std.collection.*
import std.fs.*
import std.unittest.*

// Web 上游契约（M4）：`ctx.web.fetch(url, method)` 发起 HTTP 请求；本仓暂无
// HTTP 客户端，窄化为 URL 白名单 + 请求 marker。`allow(host)` 落 `web/allow`
// 事件；`deny(host)` 落 `web/deny` 覆盖前态；`fetch(url, method)` 记 marker，
// 若 url 的 host 不在允许集则抛 `web-host-not-allowed`。

@Test
func webAllowsHostAndRecordsFetch() {
    let root = "core-web-happy"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let web = WebClient(log)
    web.allow("api.example.com")
    web.fetch("https://api.example.com/v1", "GET")
    @Expect(web.fetchCount(), Int64(1))
    removeIfExists(root, recursive: true)
}

@Test
func webRejectsDisallowedHost() {
    let root = "core-web-deny"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let web = WebClient(log)
    var threw = false
    try {
        web.fetch("https://evil.example/x", "GET")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    @Expect(web.fetchCount(), Int64(0))
    removeIfExists(root, recursive: true)
}

@Test
func webDenyOverridesPriorAllow() {
    let root = "core-web-override"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let web = WebClient(log)
    web.allow("api.example.com")
    web.deny("api.example.com")
    var threw = false
    try {
        web.fetch("https://api.example.com/x", "GET")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    removeIfExists(root, recursive: true)
}

@Test
func webEventsAreLogOnlyAcrossReplay() {
    let root = "core-web-replay"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let web = WebClient(log)
    log.append("user/message", "开工")
    web.allow("api.example.com")
    web.fetch("https://api.example.com/v1", "GET")
    @Expect(log.flush(), true)
    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    @Expect(fresh.deriveMessages().size, Int64(1))
    let replayed = WebClient(fresh)
    replayed.fetch("https://api.example.com/v2", "GET")
    @Expect(replayed.fetchCount(), Int64(2))
    removeIfExists(root, recursive: true)
}
