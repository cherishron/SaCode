package core

import std.fs.*
import std.io.*
import std.process.*
import std.unittest.*

// Web 真实驱动测试（H/W70）：不起假 provider，起真 HTTP 服务器（node 单行脚本），
// 用 WebExecutor 真发 HTTPS/HTTP 请求，验证权限门、审计事件、超时、取消与体上限。
//
// 测试拓扑：每个用例自起自停一个 node 服务器（端口 18937），
// READY 握手后才发起请求——不靠 sleep 赌时序。

let serverPort: Int64 = 18937

func serverScript() {
    return "const http = require('http');" +
        "const s = http.createServer((q, r) => {" +
        "  const u = q.url || '/';" +
        "  if (u === '/cap') { r.writeHead(200, { 'content-type': 'text/plain' }); r.end('A'.repeat(100000)); return; }" +
        "  if (u === '/slow') { r.writeHead(200, { 'content-type': 'text/plain' }); for (let i = 0; i < 40; i++) { setTimeout(() => { r.write('B'.repeat(500)); if (i === 39) { r.end(); } }, i * 60); } return; }" +
        "  if (u === '/notfound') { r.writeHead(404, { 'content-type': 'text/plain' }); r.end('nope'); return; }" +
        "  r.writeHead(200, { 'content-type': 'text/plain' }); r.end('hello-' + u);" +
        "});" +
        "s.listen(18937, () => { process.stdout.write('READY\\n'); });"
}

func serverScriptPath() {
    return "core-webexec-server.js"
}

func startServer(): SubProcess {
    let script = serverScriptPath()
    File.writeTo(script, serverScript().toArray())
    let p = launch("node", [script], stdIn: ProcessRedirect.Discard,
        stdOut: ProcessRedirect.Pipe, stdErr: ProcessRedirect.Pipe)
    waitForReady(p)
    return p
}

func waitForReady(p: SubProcess): Bool {
    let f = spawn { =>
        let rd = StringReader(p.stdOutPipe)
        var i: Int64 = 0
        while (i < 500) {
            let line = rd.readln()
            if (let Some(s) <- line) {
                if (s.contains("READY")) {
                    return true
                }
            } else {
                return false
            }
            i = i + 1
        }
        return false
    }
    var ok = false
    try { ok = f.get(10 * Duration.second) } catch (_: Exception) {}
    return ok
}

func stopServer(p: SubProcess) {
    try { p.terminate(force: true) } catch (_: Exception) {}
    try { p.wait() } catch (_: Exception) {}
    removeIfExists(serverScriptPath(), recursive: false)
}

func newLog(tag: String): (String, SessionLog) {
    let root = "core-webexec-${tag}"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    return (root, log)
}

func cleanup(root: String) {
    removeIfExists(root, recursive: true)
}

// 真实 HTTP 成功路径：真发请求、真拿字节、真核对状态码与正文。
@Test
func webExecFetchesRealHttpServer() {
    let p = startServer()
    let (root, log) = newLog("ok")
    let web = WebClient(log)
    web.allow("127.0.0.1")
    let exec = WebExecutor(web)
    let r = exec.fetch("http://127.0.0.1:18937/ping", "GET")
    @Expect(r.ok, true)
    @Expect(r.status, Int64(200))
    @Expect(r.method, "GET")
    @Expect(r.body.contains("hello-/ping"), true)
    @Expect(r.failureKind, "")
    @Expect(web.fetchCount(), Int64(1))
    cleanup(root)
    stopServer(p)
}

// 权限门：host 不在允许集 → 连请求都不发（审计事件 0 条），failureKind=not-allowed。
@Test
func webExecRejectsHostNotInAllowlist() {
    let p = startServer()
    let (root, log) = newLog("deny")
    let web = WebClient(log)
    // 故意只允许另一个 host
    web.allow("example.com")
    let exec = WebExecutor(web)
    let r = exec.fetch("http://127.0.0.1:18937/ping", "GET")
    @Expect(r.ok, false)
    @Expect(r.failureKind, "not-allowed")
    @Expect(r.message, "web-host-not-allowed")
    @Expect(r.body, "")
    // 关键断言：未授权的 host 没有留下任何审计事件
    @Expect(web.fetchCount(), Int64(0))
    cleanup(root)
    stopServer(p)
}

// deny 覆盖 allow：改判之后同样不发请求。
@Test
func webExecDenyOverridesAllow() {
    let p = startServer()
    let (root, log) = newLog("override")
    let web = WebClient(log)
    web.allow("127.0.0.1")
    web.deny("127.0.0.1")
    let exec = WebExecutor(web)
    let r = exec.fetch("http://127.0.0.1:18937/ping", "GET")
    @Expect(r.ok, false)
    @Expect(r.failureKind, "not-allowed")
    @Expect(r.message, "web-host-not-allowed")
    @Expect(web.fetchCount(), Int64(0))
    cleanup(root)
    stopServer(p)
}

// 只读方法闭集：写方法不放行，且发生在连网之前。
@Test
func webExecRejectsWriteMethod() {
    let p = startServer()
    let (root, log) = newLog("method")
    let web = WebClient(log)
    web.allow("127.0.0.1")
    let exec = WebExecutor(web)
    let r = exec.fetch("http://127.0.0.1:18937/ping", "POST")
    @Expect(r.ok, false)
    @Expect(r.failureKind, "not-allowed")
    @Expect(r.message, "web-method-not-allowed")
    @Expect(r.method, "POST")
    @Expect(web.fetchCount(), Int64(0))
    cleanup(root)
    stopServer(p)
}

// 取消闭环①：令牌已取消 → 一个字节都不发。
@Test
func webExecCancelledTokenShortCircuits() {
    let p = startServer()
    let (root, log) = newLog("cancelled")
    let web = WebClient(log)
    web.allow("127.0.0.1")
    let exec = WebExecutor(web)
    let token = TurnToken()
    token.cancel()
    let r = exec.fetch("http://127.0.0.1:18937/ping", "GET", token: token)
    @Expect(r.ok, false)
    @Expect(r.failureKind, "cancelled")
    @Expect(r.message, "web-cancelled")
    @Expect(web.fetchCount(), Int64(0))
    cleanup(root)
    stopServer(p)
}

// 取消闭环②：下载中途打断 → 在下一个读取检查点收束，failureKind=cancelled。
@Test
func webExecCancelsMidDownload() {
    let p = startServer()
    let (root, log) = newLog("midcancel")
    let web = WebClient(log)
    web.allow("127.0.0.1")
    let exec = WebExecutor(web, maxBodyBytes: 2000000)
    let token = TurnToken()
    let fut = spawn { =>
        exec.fetch("http://127.0.0.1:18937/slow", "GET", token: token)
    }
    // 服务器每 60ms 吐 500 字节，共 20KB；150ms 后取消
    sleep(150 * Duration.millisecond)
    token.cancel()
    var result: WebFetchResult
    try { result = fut.get(15 * Duration.second) } catch (_: Exception) {
        result = WebFetchResult(false, Int64(0), "GET", "", "", "", Int64(0), false, Int64(0), "transport", "no-result")
    }
    @Expect(result.ok, false)
    @Expect(result.failureKind, "cancelled")
    @Expect(result.message, "web-cancelled")
    // 审计事件已落（请求真的发出并放行了），只是正文没拿完
    @Expect(web.fetchCount(), Int64(1))
    cleanup(root)
    stopServer(p)
}

// 超时：连一个没有监听的端口 → transport/timeout 分类，绝不返回假 200。
@Test
func webExecClassifiesUnreachable() {
    let (root, log) = newLog("unreachable")
    let web = WebClient(log)
    web.allow("127.0.0.1")
    let exec = WebExecutor(web)
    let r = exec.fetch("http://127.0.0.1:9/ping", "GET", timeoutMs: 3000)
    @Expect(r.ok, false)
    @Expect(r.body, "")
    @Expect(r.failureKind == "transport" || r.failureKind == "timeout", true)
    cleanup(root)
}

// 体上限：服务器回 100KB，cap 设为 2048 → 截断且字节数精确等于 cap。
@Test
func webExecCapsResponseBody() {
    let p = startServer()
    let (root, log) = newLog("cap")
    let web = WebClient(log)
    web.allow("127.0.0.1")
    let exec = WebExecutor(web)
    let r = exec.fetch("http://127.0.0.1:18937/cap", "GET", capBytes: 2048)
    @Expect(r.ok, true)
    @Expect(r.status, Int64(200))
    @Expect(r.truncated, true)
    @Expect(r.bodyBytes, Int64(2048))
    @Expect(r.failureKind, "")
    cleanup(root)
    stopServer(p)
}

// 非 2xx 分类：404 不是成功，failureKind=http-status。
@Test
func webExecClassifiesHttpError() {
    let p = startServer()
    let (root, log) = newLog("httperr")
    let web = WebClient(log)
    web.allow("127.0.0.1")
    let exec = WebExecutor(web)
    let r = exec.fetch("http://127.0.0.1:18937/notfound", "GET")
    @Expect(r.ok, false)
    @Expect(r.status, Int64(404))
    @Expect(r.failureKind, "http-status")
    @Expect(r.message, "http-status:404")
    @Expect(web.fetchCount(), Int64(1))
    cleanup(root)
    stopServer(p)
}

// 空 URL 与非法形态：不发请求也不落审计事件。
@Test
func webExecRejectsEmptyUrl() {
    let (root, log) = newLog("emptyurl")
    let web = WebClient(log)
    web.allow("127.0.0.1")
    let exec = WebExecutor(web)
    let r = exec.fetch("", "GET")
    @Expect(r.ok, false)
    @Expect(r.failureKind, "bad-url")
    @Expect(r.message, "web-empty-url")
    @Expect(web.fetchCount(), Int64(0))
    cleanup(root)
}

// 内容编码降级：二进制正文不抛异常，bodyBytes 与真实字节对账。
@Test
func webExecHandlesNonUtf8Body() {
    let p = startServer()
    let (root, log) = newLog("binary")
    let web = WebClient(log)
    web.allow("127.0.0.1")
    let exec = WebExecutor(web)
    // 用 /cap 拿 100KB 的 'A'；再单独测 bytesToText 的降级路径
    let raw = bytesToText([UInt8(65), UInt8(10), UInt8(255), UInt8(1), UInt8(32)])
    @Expect(raw, "A\\n\\xff\\x01 \\x01")
    let printable = bytesToText("ok".toArray())
    @Expect(printable, "ok")
    let r = exec.fetch("http://127.0.0.1:18937/cap", "GET", capBytes: 16)
    @Expect(r.ok, true)
    @Expect(r.truncated, true)
    @Expect(r.bodyBytes, Int64(16))
    cleanup(root)
    stopServer(p)
}

// 审计对账：放行 N 次请求，web/fetch 事件恰为 N 条，一条不多一条不少。
@Test
func webExecAuditMatchesRealRequests() {
    let p = startServer()
    let (root, log) = newLog("audit")
    let web = WebClient(log)
    web.allow("127.0.0.1")
    let exec = WebExecutor(web)
    exec.fetch("http://127.0.0.1:18937/a", "GET")
    exec.fetch("http://127.0.0.1:18937/b", "GET")
    exec.fetch("http://127.0.0.1:18937/c", "GET")
    exec.fetch("http://evil.example/x", "GET")   // 被权限门拦下
    exec.fetch("http://127.0.0.1:18937/d", "POST") // 被方法闭集拦下
    @Expect(web.fetchCount(), Int64(3))
    @Expect(log.flush(), true)
    cleanup(root)
    stopServer(p)
}
