package core
import std.collection.*
import std.fs.*
import std.unittest.*

// 浏览器工具在 ToolRuntime 中的注册与延迟注入测试。

func makeTestLog2(prefix: String): SessionLog {
    let root = "${prefix}-ab"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    return SessionLog("${root}/session.log")
}

@Test
func testBrowserToolsRegisteredInRuntime(): Unit {
    let log = makeTestLog2("core-ab-reg")
    let runtime = ModelToolRuntime(log, false, browser: true)
    let specs = runtime.specs()
    var found = false
    for (s in specs) {
        if (s.name == "browser.navigate") { found = true }
    }
    @Expect(found, true)
}

@Test
func testBrowserStepWithoutInjectionFails(): Unit {
    let log = makeTestLog2("core-ab-inj")
    let runtime = ModelToolRuntime(log, false, browser: true)
    let toolRuntime = ToolRuntime(log, runtime.registry, workingDirectory: "",
        agentOwned: true, todoAllowParallel: false, modelProtocol: true)
    // 用只读工具 browser.tabs.list（免审批）+ allowedByGuard=true，跳过审批/guard 直达执行器
    let outcome = toolRuntime.executeWithApproval("browser.tabs.list", "{}", Int64(0), true, ApprovalDesk(log))
    @Expect(outcome.allowed, false)
    @Expect(outcome.why.contains("browser-provider-not-injected"), true)
}