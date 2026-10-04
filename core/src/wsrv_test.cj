package core
import std.collection.*
import std.fs.*
import std.unittest.*

// Web 服务器上游契约（M5/M6）：`ctx.webServer.route(method, path, kind)` 注册
// exact/prefix 两种匹配。本切片只做路由注册表，宿主仍是 stdio NDJSON。
// log-only `webserver/route` 事件承载 `<method>::<path>::<kind>`；kind 走
// exact/prefix 白名单。

@Test
func webServerRegistersAndLists() {
    let root = "core-ws-happy"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let ws = WebServerRegistry(log)
    ws.route("GET", "/api/v1/sessions", "exact")
    ws.route("POST", "/api/v1/chat", "prefix")
    let list = ws.entries()
    @Expect(list.size, Int64(2))
    @Expect(list[0], "GET::/api/v1/sessions::exact")
    removeIfExists(root, recursive: true)
}

@Test
func webServerRejectsUnknownKind() {
    let root = "core-ws-kind"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let ws = WebServerRegistry(log)
    var threw = false
    try {
        ws.route("GET", "/x", "regex")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    @Expect(ws.entries().size, Int64(0))
    removeIfExists(root, recursive: true)
}

@Test
func webServerRejectsEmptyFields() {
    let root = "core-ws-empty"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let ws = WebServerRegistry(log)
    var threw = false
    try {
        ws.route("", "/x", "exact")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    removeIfExists(root, recursive: true)
}

@Test
func webServerEventIsLogOnlyAcrossReplay() {
    let root = "core-ws-replay"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let ws = WebServerRegistry(log)
    log.append("user/message", "开工")
    ws.route("GET", "/x", "exact")
    @Expect(log.flush(), true)
    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    @Expect(fresh.deriveMessages().size, Int64(1))
    @Expect(WebServerRegistry(fresh).entries().size, Int64(1))
    removeIfExists(root, recursive: true)
}
