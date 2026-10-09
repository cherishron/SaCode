package core
import std.collection.*
import std.fs.*
import std.unittest.*

// BrowserToolExecutor 测试：审批→provider→审计执行器。
// 注意：类名用 BrowserToolExecutor（不是 bu_exec.cj 里的 BrowserExecutor）。

func makeTestLog(prefix: String): SessionLog {
    let root = "${prefix}-be"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    return SessionLog("${root}/session.log")
}

@Test
func testBrowserExecutorRejectsCancelledBeforeAudit(): Unit {
    let log = makeTestLog("core-be-cancel")
    let ledger = BrowserUseLedger(log)
    let client = BrowserProviderClient("echo", Array<String>(), workingDirectory: Path("."))
    let exec = BrowserToolExecutor(ledger, client)
    let token = TurnToken()
    token.cancel()
    let r = exec.perform("navigate", "{\"tabId\":1,\"url\":\"https://example.com\"}", token: token)
    @Expect(r.ok, false)
    @Expect(r.failureKind, "cancelled")
}

@Test
func testBrowserExecutorAuditsBeforeInvoke(): Unit {
    let log = makeTestLog("core-be-audit")
    let ledger = BrowserUseLedger(log)
    let client = BrowserProviderClient("nonexistent-binary", Array<String>(), workingDirectory: Path("."))
    let exec = BrowserToolExecutor(ledger, client)
    let r = exec.perform("navigate", "{\"tabId\":1,\"url\":\"https://example.com\"}", token: TurnToken(), timeoutMs: 500)
    let entries = ledger.entries()
    @Expect(entries.size >= 1, true)
    @Expect(r.ok, false)
}

@Test
func testBrowserExecutorRejectsUnknownVerb(): Unit {
    let log = makeTestLog("core-be-verb")
    let ledger = BrowserUseLedger(log)
    let client = BrowserProviderClient("echo", Array<String>(), workingDirectory: Path("."))
    let exec = BrowserToolExecutor(ledger, client)
    let r = exec.perform("delete-everything", "{}", token: TurnToken(), timeoutMs: 500)
    @Expect(r.ok, false)
    @Expect(r.failureKind, "bad-verb")
}