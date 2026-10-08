# Browser Use 核心基础实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在仓颉核心中注册浏览器工具声明、provider 客户端和执行器，使 `ModelToolRuntime` 能声明浏览器工具、`ToolRuntime.pipeline()` 能分发浏览器工具调用，为后续 Node provider / Native Host / Chrome 扩展提供核心侧接口。

**Architecture:** 新增 `browser_tool.cj`（工具声明）、`browser_provider.cj`（ExtProcess 包装的 NDJSON 客户端）、`browser_executor.cj`（审批→provider→审计）。修改 `model_tool_runtime.cj` 新增 `browser!` 参数、`agent.cj` 注册执行器、`bu.cj` 扩展 verb 白名单。全部可用 `cjpm test` 独立验证。

**Tech Stack:** 仓颉 1.1.3（core）、`cjpm test`、无外部依赖。

**Spec:** `docs/superpowers/specs/2026-10-08-browser-use-design.md`

## Global Constraints

- 仓颉 `cjc`/`cjpm` 1.1.3，target `x86_64-w64-mingw32`。
- `apps/host/cjpm.toml` 中 stdx 路径硬编码为本机，换机器必须改。
- 注释、文档、commit 一律中文；commit 形如 `feat(core,browser): 描述`。
- 会话日志是唯一真源；`append` 只在实例内可见，`flush` 才跨进程持久。
- 审批 fail-closed：查不到的工具一律视为需要审批。
- 不提交构建产物：`target/` 已在 `.gitignore`。
- 测试文件为 `*_test.cj`，由 `cjpm test` 自动发现。
- `node --test` 不要写成 `node --test test/`——本机 Node 会把目录当模块解析。
- 共享 Temp 让两套测试假红：cjpm test 用唯一 TMP 或 `--target-dir`。

---

## 文件结构

| 文件 | 职责 | 动作 |
| --- | --- | --- |
| `core/src/browser_tool.cj` | 浏览器工具声明（ToolSpec 列表） | 新建 |
| `core/src/browser_tool_test.cj` | 工具声明测试 | 新建 |
| `core/src/browser_provider.cj` | ExtProcess 包装：NDJSON 驱动 Node provider | 新建 |
| `core/src/browser_provider_test.cj` | provider 客户端测试 | 新建 |
| `core/src/browser_executor.cj` | 审批→provider→审计的执行器 | 新建 |
| `core/src/browser_executor_test.cj` | 执行器测试 | 新建 |
| `core/src/model_tool_runtime.cj` | 新增 `browser!` 参数 | 修改 |
| `core/src/agent.cj` | `registerBuiltinExecutors` + `browserStep` | 修改 |
| `core/src/bu.cj` | `BrowserUseLedger` 扩展 verb 白名单 | 修改 |

---

## Task 1: 浏览器工具声明

**Files:**
- Create: `core/src/browser_tool.cj`
- Create: `core/src/browser_tool_test.cj`
- Modify: `core/src/model_tool_runtime.cj:11-49`

**Interfaces:**
- Consumes: `ToolSpec(name: String, description: String, params: String, needsApproval: Bool)` from `core/src/ext.cj:13`
- Produces: `browserToolSpecs(): Array<ToolSpec>` — 返回 12 个浏览器工具声明

- [ ] **Step 1: Write the failing test**

创建 `core/src/browser_tool_test.cj`：

```cangjie
package core

import std.collection.ArrayList

func testBrowserToolSpecsCoverCoreVerbs(): Unit {
    let specs = ArrayList<ToolSpec>(browserToolSpecs())
    let names = ArrayList<String>()
    for (s in specs) {
        names.add(s.name)
    }
    @Assert(names.contains("browser.tabs.list"))
    @Assert(names.contains("browser.tabs.get"))
    @Assert(names.contains("browser.screenshot"))
    @Assert(names.contains("browser.snapshot"))
    @Assert(names.contains("browser.navigate"))
    @Assert(names.contains("browser.click"))
    @Assert(names.contains("browser.fill"))
    @Assert(names.contains("browser.press_key"))
    @Assert(names.contains("browser.scroll"))
    @Assert(names.contains("browser.evaluate"))
    @Assert(names.contains("browser.tabs.new"))
    @Assert(names.contains("browser.tabs.finalize"))
}

func testBrowserWriteToolsRequireApproval(): Unit {
    let specs = browserToolSpecs()
    for (s in specs) {
        if (s.name == "browser.navigate" || s.name == "browser.click" ||
            s.name == "browser.fill" || s.name == "browser.press_key" ||
            s.name == "browser.scroll" || s.name == "browser.evaluate" ||
            s.name == "browser.tabs.new" || s.name == "browser.tabs.finalize") {
            @Assert(s.needsApproval)
        }
        if (s.name == "browser.tabs.list" || s.name == "browser.tabs.get" ||
            s.name == "browser.screenshot" || s.name == "browser.snapshot") {
            @Assert(!s.needsApproval)
        }
    }
}

func testBrowserToolSpecCountIs12(): Unit {
    let specs = browserToolSpecs()
    @Assert(specs.size == 12)
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd core && cjpm test 2>&1 | tail -30
```
Expected: 编译错误 `undeclared identifier 'browserToolSpecs'`

- [ ] **Step 3: Write minimal implementation**

创建 `core/src/browser_tool.cj`：

```cangjie
package core

import std.collection.ArrayList

// 浏览器工具声明：模型可见的工具名、Schema 和审批标记。
// 只读操作（list/get/screenshot/snapshot）免审批；写操作一律需审批。
// evaluate 不伪装只读：即使参数是纯查询也需审批，防止页面副作用。

let BROWSER_TABS_LIST_SCHEMA = "{\"type\":\"object\",\"additionalProperties\":false,\"properties\":{\"browserId\":{\"type\":\"string\"}}}"
let BROWSER_TABS_GET_SCHEMA = "{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"browserId\",\"tabId\"],\"properties\":{\"browserId\":{\"type\":\"string\"},\"tabId\":{\"type\":\"integer\"}}}"
let BROWSER_TABS_NEW_SCHEMA = "{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"url\"],\"properties\":{\"browserId\":{\"type\":\"string\"},\"url\":{\"type\":\"string\"}}}"
let BROWSER_TABS_FINALIZE_SCHEMA = "{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"keep\"],\"properties\":{\"browserId\":{\"type\":\"string\"},\"keep\":{\"type\":\"array\",\"items\":{\"type\":\"integer\"}}}}"
let BROWSER_NAVIGATE_SCHEMA = "{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"tabId\",\"url\"],\"properties\":{\"tabId\":{\"type\":\"integer\"},\"url\":{\"type\":\"string\"}}}"
let BROWSER_SCREENSHOT_SCHEMA = "{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"tabId\"],\"properties\":{\"tabId\":{\"type\":\"integer\"},\"clip\":{\"type\":\"object\",\"properties\":{\"x\":{\"type\":\"number\"},\"y\":{\"type\":\"number\"},\"width\":{\"type\":\"number\"},\"height\":{\"type\":\"number\"}}},\"fullPage\":{\"type\":\"boolean\"}}}"
let BROWSER_SNAPSHOT_SCHEMA = "{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"tabId\"],\"properties\":{\"tabId\":{\"type\":\"integer\"}}}"
let BROWSER_CLICK_SCHEMA = "{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"tabId\"],\"properties\":{\"tabId\":{\"type\":\"integer\"},\"ref\":{\"type\":\"string\"},\"x\":{\"type\":\"number\"},\"y\":{\"type\":\"number\"}}}"
let BROWSER_FILL_SCHEMA = "{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"tabId\",\"ref\",\"text\"],\"properties\":{\"tabId\":{\"type\":\"integer\"},\"ref\":{\"type\":\"string\"},\"text\":{\"type\":\"string\"}}}"
let BROWSER_PRESS_KEY_SCHEMA = "{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"tabId\",\"key\"],\"properties\":{\"tabId\":{\"type\":\"integer\"},\"key\":{\"type\":\"string\"}}}"
let BROWSER_SCROLL_SCHEMA = "{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"tabId\"],\"properties\":{\"tabId\":{\"type\":\"integer\"},\"x\":{\"type\":\"number\"},\"y\":{\"type\":\"number\"}}}"
let BROWSER_EVALUATE_SCHEMA = "{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"tabId\",\"script\"],\"properties\":{\"tabId\":{\"type\":\"integer\"},\"script\":{\"type\":\"string\"}}}"

public func browserToolSpecs(): Array<ToolSpec> {
    let specs = ArrayList<ToolSpec>()
    specs.add(ToolSpec("browser.tabs.list", "列出当前 profile 中已打开的 HTTP(S) 标签页。", BROWSER_TABS_LIST_SCHEMA, false))
    specs.add(ToolSpec("browser.tabs.get", "获取指定标签页的标题、URL 和状态。", BROWSER_TABS_GET_SCHEMA, false))
    specs.add(ToolSpec("browser.tabs.new", "在用户浏览器中打开新标签页并导航到指定 URL。", BROWSER_TABS_NEW_SCHEMA, true))
    specs.add(ToolSpec("browser.tabs.finalize", "结束本轮操作：关闭未列入 keep 的 Agent 创建标签页，释放未列入的认领标签页。", BROWSER_TABS_FINALIZE_SCHEMA, true))
    specs.add(ToolSpec("browser.navigate", "将已认领的标签页导航到指定 URL。", BROWSER_NAVIGATE_SCHEMA, true))
    specs.add(ToolSpec("browser.screenshot", "截取标签页当前视口的 JPEG 图像。", BROWSER_SCREENSHOT_SCHEMA, false))
    specs.add(ToolSpec("browser.snapshot", "获取标签页的 AI 无障碍快照，用于语义定位元素。", BROWSER_SNAPSHOT_SCHEMA, false))
    specs.add(ToolSpec("browser.click", "点击标签页中的元素（按 ref 或坐标）。", BROWSER_CLICK_SCHEMA, true))
    specs.add(ToolSpec("browser.fill", "在标签页的输入框中填写文本。", BROWSER_FILL_SCHEMA, true))
    specs.add(ToolSpec("browser.press_key", "在标签页中按下键盘键。", BROWSER_PRESS_KEY_SCHEMA, true))
    specs.add(ToolSpec("browser.scroll", "在标签页中滚动页面。", BROWSER_SCROLL_SCHEMA, true))
    specs.add(ToolSpec("browser.evaluate", "在标签页中执行 JavaScript。需审批，即使脚本看起来是只读的。", BROWSER_EVALUATE_SCHEMA, true))
    return specs.toArray()
}
```

- [ ] **Step 4: Modify `model_tool_runtime.cj`**

在 `init` 签名（第 11 行）的 `files!: Bool = false` 后新增 `browser!: Bool = false`：

```cangjie
public init(log: SessionLog, allowParallel: Bool,
    files!: Bool = false, browser!: Bool = false, workingDirectory!: String = "",
    desk!: ApprovalDesk = ApprovalDesk(log), approval!: (ModelToolCall) -> Int64 = { _ => Int64(0) },
    guard!: (String, String) -> Bool = { _, _ => true },
    lspRouter!: LspRouter = LspRouters.sharedRouter(), lspSession!: String = "", lspToken!: TurnToken = TurnToken()) {
    this.registry = ToolRegistry()
    registry.register(TodoTool(log, allowParallel).spec())
    registry.register(goalUpdateToolSpec())
    if (files) {
        // ... existing file tools unchanged ...
    }
    if (browser) {
        for (spec in browserToolSpecs()) {
            registry.register(spec)
        }
    }
    // ... rest of init unchanged ...
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd core && cjpm test 2>&1 | tail -30
```
Expected: 全部 PASS，新增 3 条用例

- [ ] **Step 6: Commit**

```bash
git add core/src/browser_tool.cj core/src/browser_tool_test.cj core/src/model_tool_runtime.cj
git commit -m "feat(core,browser): 浏览器工具声明与 ModelToolRuntime 注册"
```

---

## Task 2: BrowserUseLedger 扩展 verb 白名单

**Files:**
- Modify: `core/src/bu.cj:36-50`（`allowed` 函数）
- Modify: `core/src/bu_test.cj`（新增用例）

**Interfaces:**
- Consumes: `BrowserUseLedger(log: SessionLog)` from `core/src/bu.cj:12`，`perform(verb, target): Unit` from `:16`
- Produces: `perform` 接受 `navigate|click|type|scroll|fill|press_key|evaluate|screenshot|snapshot|tabs.list|tabs.get|tabs.new|tabs.finalize`

- [ ] **Step 1: Write the failing test**

在 `core/src/bu_test.cj` 末尾新增：

```cangjie
func testBrowserLedgerAcceptsNewVerbs(): Unit {
    let log = SessionLog.createInMemory()
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
    @Assert(entries.size() >= 8)
}

func testBrowserLedgerRejectsUnknownVerb(): Unit {
    let log = SessionLog.createInMemory()
    let ledger = BrowserUseLedger(log)
    var threw = false
    try {
        ledger.perform("delete-everything", "tab-42")
    } catch (_: Exception) {
        threw = true
    }
    @Assert(threw)
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd core && cjpm test 2>&1 | tail -30
```
Expected: `fill`/`evaluate`/`screenshot` 等新 verb 被拒绝（抛 `browser-use-bad-verb`）

- [ ] **Step 3: Modify `bu.cj`**

修改 `allowed` 函数（第 36 行），在 `scroll` 分支后新增：

```cangjie
    private func allowed(verb: String): Bool {
        if (verb == "navigate") { return true }
        if (verb == "click") { return true }
        if (verb == "type") { return true }
        if (verb == "scroll") { return true }
        if (verb == "fill") { return true }
        if (verb == "press_key") { return true }
        if (verb == "evaluate") { return true }
        if (verb == "screenshot") { return true }
        if (verb == "snapshot") { return true }
        if (verb == "tabs.list") { return true }
        if (verb == "tabs.get") { return true }
        if (verb == "tabs.new") { return true }
        if (verb == "tabs.finalize") { return true }
        return false
    }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd core && cjpm test 2>&1 | tail -30
```
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add core/src/bu.cj core/src/bu_test.cj
git commit -m "feat(core,browser): BrowserUseLedger 扩展 verb 白名单覆盖完整操作集"
```

---

## Task 3: BrowserProviderClient（NDJSON 驱动 Node provider）

**Files:**
- Create: `core/src/browser_provider.cj`
- Create: `core/src/browser_provider_test.cj`

**Interfaces:**
- Consumes: `ExtProcess` from `core/src/extproc.cj:92` — `start(): Bool`, `request(id: Int64, method: String, params: String, timeoutMs!: Int64): Option<String>`, `close(): Int64`, `alive: Bool`
- Produces: `BrowserProviderResult` 类（`ok`, `verb`, `content`, `exitCode`, `failureKind`, `message`）、`BrowserProviderClient` 类（`start()`, `invoke(verb, args, token, timeoutMs): BrowserProviderResult`, `close()`）

- [ ] **Step 1: Write the failing test**

```cangjie
package core

func testBrowserProviderResultOkFields(): Unit {
    let r = BrowserProviderResult(true, "navigate", "{\"url\":\"https://example.com\"}", Int64(0), "", "")
    @Assert(r.ok)
    @Assert(r.verb == "navigate")
    @Assert(r.failureKind == "")
}

func testBrowserProviderResultErrorFields(): Unit {
    let r = BrowserProviderResult(false, "click", "", Int64(-1), "TAB_OWNERSHIP_CONFLICT", "Chrome tab is owned by another session")
    @Assert(!r.ok)
    @Assert(r.failureKind == "TAB_OWNERSHIP_CONFLICT")
    @Assert(r.message.contains("owned by another"))
}

func testBrowserProviderClientNotStartedReturnsError(): Unit {
    let client = BrowserProviderClient("nonexistent-binary", String[] {}, workingDirectory: Path("."))
    let r = client.invoke("tabs.list", "{}", TurnToken(), timeoutMs: 500)
    @Assert(!r.ok)
    @Assert(r.failureKind == "provider-not-alive")
}

func testBrowserProviderClientCancelledReturnsError(): Unit {
    let client = BrowserProviderClient("echo", String[] {}, workingDirectory: Path("."))
    let token = TurnToken()
    token.cancel()
    let r = client.invoke("tabs.list", "{}", token, timeoutMs: 500)
    @Assert(!r.ok)
    @Assert(r.failureKind == "cancelled")
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd core && cjpm test 2>&1 | tail -30
```
Expected: 编译错误 `undeclared identifier 'BrowserProviderResult'`

- [ ] **Step 3: Write minimal implementation**

创建 `core/src/browser_provider.cj`：

```cangjie
package core

import std.sync.*

// 浏览器 provider 子进程的 NDJSON JSON-RPC 客户端。
// 复用 ExtProcess 的 spawn/帧读写模式，驱动 Node 浏览器 provider。
// 核心不持有 Playwright 对象，只经 NDJSON 请求/响应与 provider 通信。

public class BrowserProviderResult {
    public let ok: Bool
    public let verb: String
    public let content: String
    public let exitCode: Int64
    public let failureKind: String
    public let message: String

    public init(ok: Bool, verb: String, content: String, exitCode: Int64,
                failureKind: String, message: String) {
        this.ok = ok
        this.verb = verb
        this.content = content
        this.exitCode = exitCode
        this.failureKind = failureKind
        this.message = message
    }
}

public class BrowserProviderClient {
    let proc: ExtProcess
    let idCounter = AtomicInt64(0)
    var started = false

    public init(command: String, arguments: Array<String>, workingDirectory: Path) {
        this.proc = ExtProcess(command, arguments, workingDirectory: workingDirectory)
    }

    public func start(): Bool {
        started = proc.start()
        return started
    }

    public func invoke(verb: String, args: String,
                       token!: TurnToken = TurnToken(), timeoutMs!: Int64 = 30000): BrowserProviderResult {
        if (!started || !proc.alive) {
            return BrowserProviderResult(false, verb, "", Int64(-1), "provider-not-alive", "browser-provider-not-started")
        }
        if (token.cancelled()) {
            return BrowserProviderResult(false, verb, "", Int64(-1), "cancelled", "browser-cancelled")
        }
        let id = idCounter.fetchAdd(1) + Int64(1)
        let params = "{\"verb\":\"${verb}\",\"args\":${args}}"
        let reply = proc.request(id, "browser/invoke", params, timeoutMs: timeoutMs)
        if (let Some(body) <- reply) {
            let ok = body.contains("\"ok\":true")
            if (ok) {
                return BrowserProviderResult(true, verb, body, Int64(0), "", "")
            } else {
                return BrowserProviderResult(false, verb, body, Int64(-1), "provider-error", body)
            }
        }
        return BrowserProviderResult(false, verb, "", Int64(-1), "timeout", "browser-provider-timeout")
    }

    public func close(): Int64 {
        return proc.close()
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd core && cjpm test 2>&1 | tail -30
```
Expected: 全部 PASS，新增 4 条用例

- [ ] **Step 5: Commit**

```bash
git add core/src/browser_provider.cj core/src/browser_provider_test.cj
git commit -m "feat(core,browser): BrowserProviderClient NDJSON 驱动 Node provider"
```

---

## Task 4: BrowserExecutor（审批→provider→审计）

**Files:**
- Create: `core/src/browser_executor.cj`
- Create: `core/src/browser_executor_test.cj`

**Interfaces:**
- Consumes: `BrowserProviderClient.invoke(verb, args, token, timeoutMs): BrowserProviderResult` (Task 3)、`BrowserUseLedger.perform(verb, target): Unit` (Task 2)、`TurnToken`
- Produces: `BrowserExecutor(ledger, client)` — `perform(verb, args, token, timeoutMs): BrowserProviderResult`

- [ ] **Step 1: Write the failing test**

```cangjie
package core

func testBrowserExecutorRejectsCancelledBeforeAudit(): Unit {
    let log = SessionLog.createInMemory()
    let ledger = BrowserUseLedger(log)
    let client = BrowserProviderClient("echo", String[] {}, workingDirectory: Path("."))
    let exec = BrowserExecutor(ledger, client)
    let token = TurnToken()
    token.cancel()
    let r = exec.perform("navigate", "{\"tabId\":1,\"url\":\"https://example.com\"}", token)
    @Assert(!r.ok)
    @Assert(r.failureKind == "cancelled")
}

func testBrowserExecutorAuditsBeforeInvoke(): Unit {
    let log = SessionLog.createInMemory()
    let ledger = BrowserUseLedger(log)
    let client = BrowserProviderClient("nonexistent-binary", String[] {}, workingDirectory: Path("."))
    let exec = BrowserExecutor(ledger, client)
    let r = exec.perform("navigate", "{\"tabId\":1,\"url\":\"https://example.com\"}", TurnToken(), timeoutMs: 500)
    // provider 不 alive，但审计应已落盘
    let entries = ledger.entries()
    @Assert(entries.size() >= 1)
    // 执行失败也应落 browser/exec
    @Assert(!r.ok)
}

func testBrowserExecutorRejectsUnknownVerb(): Unit {
    let log = SessionLog.createInMemory()
    let ledger = BrowserUseLedger(log)
    let client = BrowserProviderClient("echo", String[] {}, workingDirectory: Path("."))
    let exec = BrowserExecutor(ledger, client)
    let r = exec.perform("delete-everything", "{}", TurnToken(), timeoutMs: 500)
    @Assert(!r.ok)
    @Assert(r.failureKind == "bad-verb")
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd core && cjpm test 2>&1 | tail -30
```
Expected: 编译错误 `undeclared identifier 'BrowserExecutor'`

- [ ] **Step 3: Write minimal implementation**

创建 `core/src/browser_executor.cj`：

```cangjie
package core

// 浏览器执行器：审批面(BrowserUseLedger) + 执行面(BrowserProviderClient) + 取消(TurnToken)。
// 与 bu_exec.cj 的 BrowserExecutor（headless DOM）不同：本执行器驱动真实浏览器 provider。
// 职责：先落审计事件，再委托 provider 子进程执行，取消在每步检查。

public class BrowserExecutor {
    let ledger: BrowserUseLedger
    let client: BrowserProviderClient

    public init(ledger: BrowserUseLedger, client: BrowserProviderClient) {
        this.ledger = ledger
        this.client = client
    }

    public func perform(verb: String, args: String,
                        token!: TurnToken = TurnToken(), timeoutMs!: Int64 = 30000): BrowserProviderResult {
        if (token.cancelled()) {
            return BrowserProviderResult(false, verb, "", Int64(-1), "cancelled", "browser-cancelled")
        }
        // 审计：先落 browser-use/action
        try {
            ledger.perform(verb, args)
        } catch (e: Exception) {
            return BrowserProviderResult(false, verb, "", Int64(-1), "bad-verb", e.message)
        }
        if (token.cancelled()) {
            return BrowserProviderResult(false, verb, "", Int64(-1), "cancelled", "browser-cancelled-after-audit")
        }
        let result = client.invoke(verb, args, token: token, timeoutMs: timeoutMs)
        // 审计：执行结果
        if (result.ok) {
            ledger.log.append("browser/exec", "${verb}::0")
        } else {
            ledger.log.append("browser/exec", "${verb}::-1")
        }
        return result
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd core && cjpm test 2>&1 | tail -30
```
Expected: 全部 PASS，新增 3 条用例

- [ ] **Step 5: Commit**

```bash
git add core/src/browser_executor.cj core/src/browser_executor_test.cj
git commit -m "feat(core,browser): BrowserExecutor 审批→provider→审计执行器"
```

---

## Task 5: Agent 执行器注册与延迟注入

**Files:**
- Modify: `core/src/agent.cj:122`（新增 `browserExecutor` 字段）、`:151-171`（`registerBuiltinExecutors` 新增 12 条）、新增 `browserStep` 与 `setBrowserExecutor`
- Create: `core/src/agent_browser_test.cj`

**Interfaces:**
- Consumes: `BrowserExecutor.perform(verb, args, token, timeoutMs): BrowserProviderResult` (Task 4)
- Produces: `ToolRuntime.setBrowserExecutor(exec)` — 上层入口注入后 `browser.*` 工具名可经 `pipeline()` 分发

- [ ] **Step 1: Write the failing test**

```cangjie
package core

func testBrowserToolsRegisteredInRuntime(): Unit {
    let log = SessionLog.createInMemory()
    let runtime = ModelToolRuntime(log, false, browser: true)
    let specs = runtime.specs()
    var found = false
    for (s in specs) {
        if (s.name == "browser.navigate") { found = true }
    }
    @Assert(found)
}

func testBrowserStepWithoutInjectionFails(): Unit {
    let log = SessionLog.createInMemory()
    let runtime = ModelToolRuntime(log, false, browser: true)
    let toolRuntime = ToolRuntime(log, runtime.registry, workingDirectory: "",
        agentOwned: true, todoAllowParallel: false, modelProtocol: true)
    // 不注入 browserExecutor，调用应返回 browser-provider-not-injected
    let outcome = toolRuntime.executeWithApproval("browser.navigate", "{\"tabId\":1,\"url\":\"https://example.com\"}", Int64(0), false, ApprovalDesk(log))
    @Assert(!outcome.ok)
    @Assert(outcome.error.contains("browser-provider-not-injected"))
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd core && cjpm test 2>&1 | tail -30
```
Expected: 编译错误或 `browser.navigate` 在 specs 中找不到（Task 1 已修改 `model_tool_runtime.cj`，但 `ToolRuntime` 尚未注册执行器）

- [ ] **Step 3: Modify `agent.cj`**

在 `ToolRuntime` 类中新增字段（`executors` 声明之后，第 122 行后）：

```cangjie
    var browserExecutor: Option<BrowserExecutor> = Option<BrowserExecutor>.None
```

在 `registerBuiltinExecutors` 末尾（第 170 行后）新增：

```cangjie
        // 浏览器工具：执行器由上层入口注入 browserExecutor 后才可用。
        // 声明了却未注入执行器的 browser.* 工具名照旧归一成 unknown-tool。
        executors.add("browser.tabs.list", { _, a => browserStep("tabs.list", a) })
        executors.add("browser.tabs.get", { _, a => browserStep("tabs.get", a) })
        executors.add("browser.tabs.new", { _, a => browserStep("tabs.new", a) })
        executors.add("browser.tabs.finalize", { _, a => browserStep("tabs.finalize", a) })
        executors.add("browser.navigate", { _, a => browserStep("navigate", a) })
        executors.add("browser.screenshot", { _, a => browserStep("screenshot", a) })
        executors.add("browser.snapshot", { _, a => browserStep("snapshot", a) })
        executors.add("browser.click", { _, a => browserStep("click", a) })
        executors.add("browser.fill", { _, a => browserStep("fill", a) })
        executors.add("browser.press_key", { _, a => browserStep("press_key", a) })
        executors.add("browser.scroll", { _, a => browserStep("scroll", a) })
        executors.add("browser.evaluate", { _, a => browserStep("evaluate", a) })
```

新增方法（`registerBuiltinExecutors` 之后）：

```cangjie
    private func browserStep(verb: String, args: String): ApprovalOutcome {
        match (browserExecutor) {
            case Some(exec) =>
                let result = exec.perform(verb, args, token: lspToken)
                if (result.ok) {
                    return ApprovalOutcome(true, result.content)
                } else {
                    return ApprovalOutcome(false, "browser-${result.failureKind}::${result.message}")
                }
            case None =>
                return ApprovalOutcome(false, "browser-provider-not-injected")
        }
    }

    public func setBrowserExecutor(exec: BrowserExecutor): Unit {
        browserExecutor = Some(exec)
    }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd core && cjpm test 2>&1 | tail -30
```
Expected: 全部 PASS，新增 2 条用例

- [ ] **Step 5: Commit**

```bash
git add core/src/agent.cj core/src/agent_browser_test.cj
git commit -m "feat(core,browser): ToolRuntime 注册浏览器执行器与延迟注入接口"
```

---

## Self-Review

### 1. Spec coverage

| Spec 要求 | 对应 Task |
| --- | --- |
| §5.2 操作集（12 个工具） | Task 1 |
| §6.1 工具注册（`browser!` 参数） | Task 1 |
| §6.2 执行管线 | Task 3+4+5 |
| §6.3 审计（`browser-use/action` + `browser/exec`） | Task 2+4 |
| §6.4 取消（TurnToken） | Task 3+4 |
| §7.3 写操作需审批 | Task 1（`needsApproval` 标记） |
| §7.1 evaluate 不伪装只读 | Task 1（`evaluate` needsApproval=true） |
| §2.3 与现有 `bu.cj` 的关系 | Task 2（扩展白名单） |
| §2.3 与现有 `bu_exec.cj` 的关系 | 不修改（保留为 headless DOM provider） |
| §2.3 与现有 `extproc.cj` 的关系 | Task 3（复用 ExtProcess） |
| §2.3 与现有 `mcp_client.cj` 的关系 | 不修改（不经 MCP client） |

**未覆盖（后续计划）：**
- §3 协议设计（帧格式、发现、握手）→ Node provider / Native Host 计划
- §4 扩展设计（manifest、service worker、CDP）→ Chrome 扩展计划
- §5.3 结果格式（截图多模态）→ Node provider 计划
- §7.2 本地 IPC 认证 → Native Host 计划
- §8 平台策略（安装器）→ Native Host 计划
- §9 阶段 S1-S6 集成测试 → 集成测试计划
- §10 交付物清单中 `packages/*` 部分 → 各子计划

### 2. Placeholder scan

无 TBD/TODO。所有步骤均含实际代码。

### 3. Type consistency

- `BrowserProviderResult` 在 Task 3 定义，Task 4 中通过 `client.invoke()` 返回值消费——字段 `ok`/`verb`/`content`/`exitCode`/`failureKind`/`message` 一致。
- `BrowserExecutor` 在 Task 4 定义，Task 5 中通过 `exec.perform(verb, args, token: token)` 调用——参数名 `verb`/`args`/`token`/`timeoutMs` 一致。
- `browserStep` 在 Task 5 中提取 verb（去掉 `browser.` 前缀），与 Task 1 注册的工具名 `browser.navigate` → verb `navigate` 一致。
- `setBrowserExecutor` 注入 `BrowserExecutor`，与 Task 4 构造函数 `BrowserExecutor(ledger, client)` 一致。
