package core
import std.collection.*
import std.fs.*
import std.unittest.*

// 浏览器使用上游契约（M8）：`ctx.browserUse.navigate(url)` / `click(selector)` /
// `type(selector, text)` 等页面动作。本切片以 log-only `browser-use/action`
// 事件承载 `<verb>::<target>`；verb 白名单在 navigate/click/type/scroll 四选一。

@Test
func browserUseRecordsNavigateAndClick() {
    let root = "core-bu-happy"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let bu = BrowserUseLedger(log)
    bu.perform("navigate", "https://example.com")
    bu.perform("click", "#submit")
    let list = bu.entries()
    @Expect(list.size, Int64(2))
    @Expect(list[0], "navigate::https://example.com")
    @Expect(list[1], "click::#submit")
    removeIfExists(root, recursive: true)
}

@Test
func browserUseRejectsUnknownVerb() {
    let root = "core-bu-verb"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let bu = BrowserUseLedger(log)
    var threw = false
    try {
        bu.perform("explode", "x")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    @Expect(bu.entries().size, Int64(0))
    removeIfExists(root, recursive: true)
}

@Test
func browserUseRejectsEmptyTarget() {
    let root = "core-bu-empty"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let bu = BrowserUseLedger(log)
    var threw = false
    try {
        bu.perform("click", "")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    removeIfExists(root, recursive: true)
}

@Test
func browserUseEventIsLogOnlyAcrossReplay() {
    let root = "core-bu-replay"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let bu = BrowserUseLedger(log)
    log.append("user/message", "开工")
    bu.perform("navigate", "https://example.com")
    @Expect(log.flush(), true)
    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    @Expect(fresh.deriveMessages().size, Int64(1))
    @Expect(BrowserUseLedger(fresh).entries().size, Int64(1))
    removeIfExists(root, recursive: true)
}

@Test
func testBrowserLedgerAcceptsNewVerbs(): Unit {
    let root = "core-bu-newverbs"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let ledger = BrowserUseLedger(log)
    ledger.perform("navigate", "https://example.com")
    ledger.perform("click", "tab-42")
    ledger.perform("fill", "tab-42::ref-3")
    ledger.perform("evaluate", "tab-42")
    ledger.perform("screenshot", "tab-42")
    ledger.perform("snapshot", "tab-42")
    ledger.perform("tabs.list", "chrome:Default")
    ledger.perform("tabs.finalize", "tab-42")
    let entries = ledger.entries()
    @Expect(entries.size, Int64(8))
    removeIfExists(root, recursive: true)
}

@Test
func testBrowserLedgerRejectsUnknownVerb(): Unit {
    let root = "core-bu-badverb"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let ledger = BrowserUseLedger(log)
    var threw = false
    try {
        ledger.perform("delete-everything", "tab-42")
    } catch (_: Exception) {
        threw = true
    }
    @Expect(threw, true)
    removeIfExists(root, recursive: true)
}
