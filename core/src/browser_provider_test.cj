package core
import std.collection.*
import std.fs.*
import std.unittest.*

// BrowserProviderClient 测试：覆盖 BrowserProviderResult 字段与未启动/取消两条错误路径。

@Test
func testBrowserProviderResultOkFields(): Unit {
    let r = BrowserProviderResult(true, "navigate", "{\"url\":\"https://example.com\"}", Int64(0), "", "")
    @Expect(r.ok, true)
    @Expect(r.verb, "navigate")
    @Expect(r.failureKind, "")
}

@Test
func testBrowserProviderResultErrorFields(): Unit {
    let r = BrowserProviderResult(false, "click", "", Int64(-1), "TAB_OWNERSHIP_CONFLICT", "Chrome tab is owned by another session")
    @Expect(r.ok, false)
    @Expect(r.failureKind, "TAB_OWNERSHIP_CONFLICT")
    @Expect(r.message.contains("owned by another"), true)
}

@Test
func testBrowserProviderClientNotStartedReturnsError(): Unit {
    let client = BrowserProviderClient("nonexistent-binary", Array<String>(), workingDirectory: Path("."))
    let r = client.invoke("tabs.list", "{}", token: TurnToken(), timeoutMs: 500)
    @Expect(r.ok, false)
    @Expect(r.failureKind, "provider-not-alive")
}

@Test
func testBrowserProviderClientCancelledReturnsError(): Unit {
    let client = BrowserProviderClient("echo", Array<String>(), workingDirectory: Path("."))
    let token = TurnToken()
    token.cancel()
    let r = client.invoke("tabs.list", "{}", token: token, timeoutMs: 500)
    @Expect(r.ok, false)
    @Expect(r.failureKind, "cancelled")
}