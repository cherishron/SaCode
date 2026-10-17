package core

import std.fs.*
import std.io.*
import std.process.*
import std.unittest.*

// 浏览器真实驱动测试（H/W70）：spawn 真 Chrome headless，加载真 HTTP 服务器
// 提供的页面，抓回渲染后的 DOM。拒绝测试（bad-verb / bad-url / 不支持的动作）
// 不起浏览器，秒回。
//
// Chrome headless 启动约 5-10 秒，所以只有一条用例真起浏览器；其余都是权限门
// 拦下的快路径。

let buServerScript: String = "core-bu-server.js"
let buServerPort: Int64 = 18938

func buServerBody(): String {
    return joinStrings([
        "const http = require('http');",
        "const s = http.createServer((q, r) => {",
        "  r.writeHead(200, { 'content-type': 'text/html' });",
        "  r.end('<html><head></head><body><h1>hello-from-browser-test</h1></body></html>');",
        "});",
        "s.listen(18938, () => { process.stdout.write('READY\\n'); });",
    ], "\n")
}

func buWriteServer(): Unit {
    File.writeTo(buServerScript, buServerBody().toArray())
}

func buDeleteServer(): Unit {
    removeIfExists(buServerScript, recursive: false)
}

func buStartServer(): SubProcess {
    buWriteServer()
    let p = launch("node", [buServerScript], stdIn: ProcessRedirect.Discard,
        stdOut: ProcessRedirect.Pipe, stdErr: ProcessRedirect.Pipe)
    buWaitReady(p)
    return p
}

func buWaitReady(p: SubProcess): Bool {
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

func buStopServer(p: SubProcess): Unit {
    try { p.terminate(force: true) } catch (_: Exception) {}
    try { p.wait() } catch (_: Exception) {}
    buDeleteServer()
}

func buSetup(tag: String): (String, SessionLog, BrowserUseLedger) {
    let root = "core-buexec-${tag}"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    return (root, log, BrowserUseLedger(log))
}

func buCleanup(root: String): Unit {
    removeIfExists(root, recursive: true)
}

func buExecCount(log: SessionLog, kind: String): Int64 {
    var n: Int64 = 0
    for (event in log.snapshotEvents()) {
        if (event.eventType == kind) {
            n = n + 1
        }
    }
    return n
}

// 真导航：Chrome headless 加载真 HTTP 服务器，DOM 抓回且包含预期文本。
@Test
func browserNavigatesRealUrl() {
    let (root, log, ledger) = buSetup("nav")
    let srv = buStartServer()
    let exec = BrowserExecutor(ledger)
    let r = exec.perform("navigate", "http://127.0.0.1:18938/", timeoutMs: 30000)
    println("BROWSER-NAV: ok=${r.ok} code=${r.exitCode} kind=${r.failureKind} msg=${r.message} dom.len=${r.dom.size}")
    @Expect(r.ok, true)
    @Expect(r.verb, "navigate")
    @Expect(r.dom.contains("hello-from-browser-test"), true)
    @Expect(r.dom.contains("<html"), true)
    @Expect(buExecCount(log, "browser-use/action"), Int64(1))
    @Expect(buExecCount(log, "browser/exec"), Int64(1))
    buStopServer(srv)
    buCleanup(root)
}

// headless --dump-dom 只能 navigate：click/type/scroll 如实报不支持。
@Test
func browserRejectsUnsupportedAction() {
    let (root, log, ledger) = buSetup("click")
    let exec = BrowserExecutor(ledger)
    let r = exec.perform("click", "button#submit")
    @Expect(r.ok, false)
    @Expect(r.failureKind, "action-not-supported")
    @Expect(r.message, "browser-headless-dump-dom-only-navigate")
    // 权限面已落账（verb 合法），但执行面没起浏览器
    @Expect(buExecCount(log, "browser-use/action"), Int64(1))
    @Expect(buExecCount(log, "browser/exec"), Int64(0))
    buCleanup(root)
}

// 非 white-list 动词：不落账、不起浏览器。
@Test
func browserRejectsBadVerb() {
    let (root, log, ledger) = buSetup("badverb")
    let exec = BrowserExecutor(ledger)
    let r = exec.perform("delete", "table")
    @Expect(r.ok, false)
    @Expect(r.failureKind, "bad-verb")
    @Expect(buExecCount(log, "browser-use/action"), Int64(0))
    @Expect(buExecCount(log, "browser/exec"), Int64(0))
    buCleanup(root)
}

// 空 target：不落账。
@Test
func browserRejectsEmptyTarget() {
    let (root, log, ledger) = buSetup("empty")
    let exec = BrowserExecutor(ledger)
    let r = exec.perform("navigate", "")
    @Expect(r.ok, false)
    @Expect(r.failureKind, "bad-target")
    @Expect(buExecCount(log, "browser-use/action"), Int64(0))
    buCleanup(root)
}

// URL 协议必须 http/https：file:// 和 javascript: 都挡。
@Test
func browserRejectsBadUrlScheme() {
    let (root, log, ledger) = buSetup("badurl")
    let exec = BrowserExecutor(ledger)
    let r = exec.perform("navigate", "file:///etc/passwd")
    @Expect(r.ok, false)
    @Expect(r.failureKind, "bad-url")
    @Expect(r.message, "browser-url-must-be-http-or-https")
    // verb 合法、target 非空 → 已落 browser-use/action，但 URL 不合规没起浏览器
    @Expect(buExecCount(log, "browser-use/action"), Int64(1))
    @Expect(buExecCount(log, "browser/exec"), Int64(0))
    buCleanup(root)
}

// 浏览器不存在 → browser-not-found，绝不抛。
@Test
func browserReportsMissingBinary() {
    let (root, log, ledger) = buSetup("nobb")
    let exec = BrowserExecutor(ledger, binary: "definitely-not-a-real-browser-xyz")
    let r = exec.perform("navigate", "http://example.com/", timeoutMs: 5000)
    @Expect(r.ok, false)
    @Expect(r.failureKind, "browser-not-found")
    @Expect(r.message, "browser-binary-not-found")
    @Expect(buExecCount(log, "browser/exec"), Int64(0))
    buCleanup(root)
}

// 取消闭环：令牌已取消 → 不起浏览器、不落 browser/exec。
@Test
func browserCancelledTokenShortCircuits() {
    let (root, log, ledger) = buSetup("cancelled")
    let exec = BrowserExecutor(ledger)
    let token = TurnToken()
    token.cancel()
    let r = exec.perform("navigate", "http://example.com/", token: token, timeoutMs: 5000)
    @Expect(r.ok, false)
    @Expect(r.cancelled, true)
    @Expect(r.failureKind, "cancelled")
    @Expect(buExecCount(log, "browser/exec"), Int64(0))
    buCleanup(root)
}

// 审计对账：一次真导航 + 一次被拦 = browser/exec 恰为 1。
@Test
func browserAuditMatchesRealRuns() {
    let (root, log, ledger) = buSetup("audit")
    let srv = buStartServer()
    let exec = BrowserExecutor(ledger)
    exec.perform("navigate", "http://127.0.0.1:18938/", timeoutMs: 30000)
    exec.perform("click", "button")
    exec.perform("delete", "table")
    @Expect(buExecCount(log, "browser-use/action"), Int64(2))  // navigate + click
    @Expect(buExecCount(log, "browser/exec"), Int64(1))       // 只有 navigate 真起
    buStopServer(srv)
    buCleanup(root)
}
