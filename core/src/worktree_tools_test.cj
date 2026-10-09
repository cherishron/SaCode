package core

import std.collection.ArrayList
import std.fs.*
import std.env.*
import std.process.*
import std.unittest.*
import std.unittest.testmacro.*
import stdx.encoding.json.*

// T3 模型工具面（enter_worktree / exit_worktree）的行为契约测试。
// 口径来自 docs/superpowers/plans/2026-10-08-session-worktree.md 的「冻结契约」：
// 工具名与参数、退出动作只有 keep|remove、describe() 恰好八个字段、remove 必须审批、
// 进入/退出后同一会话内后续工具的真实工作目录必须跟着变。
//
// 夹具是真实临时 Git 仓库 + 真实 SessionWorktree，不拿桩冒充实测；每个用例各占一份
// 私有 TMP 目录，并发会话之间不共享 .sacode/worktrees 与归属判定。

// ---------- 夹具 ----------

func wtToolsGit(root: String, args: Array<String>): String {
    let (rc, out, err) = executeWithOutput("git", args, workingDirectory: Some(Path(root)))
    if (rc != 0) { throw Exception("git-${args[0]} 失败:${String.fromUtf8(err)}") }
    return String.fromUtf8(out).trimAscii()
}

// 一份最小可用的真实仓库：一个已提交的文件、一个 gitignore 的 .sacode、一个只存在于
// 原始检出的未跟踪文件——「后续工具落在哪」靠这三样才分得出来。
func wtToolsRepo(): String {
    let base = getVariable("TMP") ?? (getVariable("TEMP") ?? ".")
    let root = Directory.createTemp(Path(base)).toString()
    wtToolsGit(root, ["init", "-b", "main"])
    File.writeTo(Path(root).join("seed"), "shared-seed".toArray())
    File.writeTo(Path(root).join("sample.ts"), "function alpha() {\n  return 1\n}\n".toArray())
    File.writeTo(Path(root).join(".gitignore"), ".sacode/\n".toArray())
    wtToolsGit(root, ["add", "."])
    wtToolsGit(root, ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "worktree 工具夹具"])
    return canonicalize(root).toString()
}

func wtToolsCall(name: String, args: String): ModelToolCall {
    let call = ModelToolCall(0)
    call.id = "wt-tools-call"
    call.name = name
    call.args = args
    return call
}

// 每次调用现发一张绑定「工具名 + 原始参数」的一次性工单并立刻批准：走的仍是 ApprovalDesk
// 的消费制度，不是绕过审批的捷径。
func wtToolsGrant(desk: ApprovalDesk, name: String, args: String): Int64 {
    let id = desk.askForCall(name, args)
    if (!desk.answer(id, "allowed-once")) { throw Exception("worktree 夹具没能发出可用工单") }
    return id
}

func wtToolsRuntime(log: SessionLog, tree: SessionWorktree, root: String,
    router!: LspRouter = LspRouters.sharedRouter()): ModelToolRuntime {
    let desk = ApprovalDesk(log)
    return ModelToolRuntime(log, false, files: true, workingDirectory: root, worktree: Some(tree),
        desk: desk, approval: { call => wtToolsGrant(desk, call.name, call.args) },
        lspRouter: router, lspSession: "wt-tools")
}

class WtToolsHarness {
    let root: String
    let log: SessionLog
    let tree: SessionWorktree
    let runtime: ModelToolRuntime
    init(root: String, log: SessionLog, tree: SessionWorktree, runtime: ModelToolRuntime) {
        this.root = root
        this.log = log
        this.tree = tree
        this.runtime = runtime
    }
    func enter(name: String): ApprovalOutcome {
        return runtime.execute(wtToolsCall("enter_worktree", "{\"name\":\"${name}\"}"))
    }
    func enterAuto(): ApprovalOutcome {
        return runtime.execute(wtToolsCall("enter_worktree", "{}"))
    }
    func exit(name: String, action: String, discardChanges!: Bool = false): ApprovalOutcome {
        var args = "{\"name\":\"${name}\",\"action\":\"${action}\"}"
        if (discardChanges) { args = "{\"name\":\"${name}\",\"action\":\"${action}\",\"discard_changes\":true}" }
        return runtime.execute(wtToolsCall("exit_worktree", args))
    }
    func call(name: String, args: String): ApprovalOutcome { return runtime.execute(wtToolsCall(name, args)) }
    // 会话有效目录：后续所有文件与 shell 工具的基准，就是它。
    func bound(): String { return SessionWorkspace(log).effectiveDirectory() }
    func eventDirectory(): String {
        var value = ""
        for (event in log.snapshotEvents()) { if (event.eventType == "workspace/directory") { value = event.data } }
        return value
    }
    func count(eventType: String): Int64 {
        var n: Int64 = 0
        for (event in log.snapshotEvents()) { if (event.eventType == eventType) { n += 1 } }
        return n
    }
}

func wtToolsHarness(): WtToolsHarness {
    let root = wtToolsRepo()
    File.writeTo(Path(root).join("outside.txt"), "only-in-original-checkout".toArray())
    let log = SessionLog(Path(root).join("session.log").toString())
    let tree = SessionWorktree(log, fallback: root)
    return WtToolsHarness(root, log, tree, wtToolsRuntime(log, tree, root))
}

func wtToolsSlashes(path: String): String { return path.replace("\\", "/") }

func wtToolsSpec(runtime: ModelToolRuntime, name: String): ToolSpec {
    for (spec in runtime.specs()) { if (spec.name == name) { return spec } }
    throw Exception("模型声明面缺少工具:${name}")
}

func wtToolsObject(text: String): JsonObject { return JsonValue.fromStr(text).asObject() }

func wtToolsField(payload: String, field: String): String {
    return wtToolsObject(payload).get(field).getOrThrow().asString().getValue()
}

// describe() 的八字段是冻结契约，模型侧载荷也照它，任何一面不得增删或改名。
func wtToolsAssertDescribeShape(payload: String): JsonObject {
    let obj = wtToolsObject(payload)
    @Expect(obj.size(), Int64(8))
    for (field in ["active", "name", "directory", "originalDirectory", "branch", "dirty", "uncommittedCount", "uniqueCommits"]) {
        @Expect(obj.get(field).isSome(), true)
    }
    return obj
}

func wtToolsJsonNames(array: JsonArray): ArrayList<String> {
    let names = ArrayList<String>()
    for (i in 0..array.size()) { names.add(array.get(i).getOrThrow().asString().getValue()) }
    return names
}

func wtToolsHasAll(array: JsonArray, values: Array<String>): Bool {
    var ok = array.size() == Int64(values.size)
    for (value in values) {
        var hit = false
        for (i in 0..array.size()) { if (array.get(i).getOrThrow().asString().getValue() == value) { hit = true } }
        if (!hit) { ok = false }
    }
    return ok
}

// LSP 的基准目录是否真的跟着会话走，只能靠探针读请求里的 workspaceRoot——
// 它不碰真实 language server，形状与 lsp_contract 的内存夹具一致。
class WtToolsLspProbe <: LspServer {
    var lastRequest: LspRequest = LspRequest()
    var calls: Int64 = 0
    public init() {}
    public func serverId(): String { return "wt-tools-probe" }
    public func supports(verb: String): Bool { return verb == "lookup" }
    public func execute(req: LspRequest): LspResponse {
        calls += 1
        lastRequest = req
        let resp = LspResponse()
        resp.serverId = serverId()
        resp.documentVersion = req.documentVersion
        resp.hoverMarkdown = "**wt-tools-probe**"
        return resp
    }
}

// ---------- 声明面 ----------

// 用例 1：没绑定执行入口就不登记；绑定了才恰好两条。
@Test
func worktreeModelToolsAppearOnlyWhenSessionWorktreeIsBound() {
    let log = SessionLog("wt-tools-unbound.log")
    let unbound = ModelToolRuntime(log, false, files: true)
    @Expect(unbound.registry.has("enter_worktree"), false)
    @Expect(unbound.registry.has("exit_worktree"), false)
    var worktreeNamed: Int64 = 0
    for (spec in unbound.specs()) { if (spec.name.contains("worktree")) { worktreeNamed += 1 } }
    @Expect(worktreeNamed, Int64(0))
    let root = wtToolsRepo()
    let boundLog = SessionLog(Path(root).join("session.log"))
    let runtime = wtToolsRuntime(boundLog, SessionWorktree(boundLog, fallback: root), root)
    @Expect(runtime.registry.has("enter_worktree"), true)
    @Expect(runtime.registry.has("exit_worktree"), true)
    var bound: Int64 = 0
    for (spec in runtime.specs()) { if (spec.name.contains("worktree")) { bound += 1 } }
    @Expect(bound, Int64(2))
    removeIfExists(root, recursive: true)
}

// 用例 2：schema 与冻结契约逐字段对齐——enter 只有可选 name，exit 是 name+action 必填、
// action 闭集 keep|remove、discard_changes 可选布尔，两面都 additionalProperties:false。
@Test
func worktreeToolSchemasMatchFrozenContractExactly() {
    let h = wtToolsHarness()
    let enter = wtToolsObject(wtToolsSpec(h.runtime, "enter_worktree").params)
    @Expect(enter.get("type").getOrThrow().asString().getValue(), "object")
    @Expect(enter.get("additionalProperties").getOrThrow().asBool().getValue(), false)
    @Expect(enter.get("required").isNone(), true)
    let enterProps = enter.get("properties").getOrThrow().asObject()
    @Expect(enterProps.size(), Int64(1))
    @Expect(enterProps.get("name").getOrThrow().asObject().get("type").getOrThrow().asString().getValue(), "string")
    let exit = wtToolsObject(wtToolsSpec(h.runtime, "exit_worktree").params)
    @Expect(exit.get("additionalProperties").getOrThrow().asBool().getValue(), false)
    @Expect(wtToolsHasAll(exit.get("required").getOrThrow().asArray(), ["name", "action"]), true)
    let props = exit.get("properties").getOrThrow().asObject()
    @Expect(props.size(), Int64(3))
    @Expect(props.get("name").getOrThrow().asObject().get("type").getOrThrow().asString().getValue(), "string")
    @Expect(props.get("discard_changes").getOrThrow().asObject().get("type").getOrThrow().asString().getValue(), "boolean")
    let actions = props.get("action").getOrThrow().asObject().get("enum").getOrThrow().asArray()
    @Expect(wtToolsHasAll(actions, ["keep", "remove"]), true)
    // 草稿里的 delete 不是合法取值，枚举里也不许出现
    @Expect(wtToolsJsonNames(actions).contains("delete"), false)
    removeIfExists(h.root, recursive: true)
}

// 用例 3：审批旗标——enter 免审批，exit 整条要审批（remove 因此不可能自动获批）。
@Test
func worktreeToolApprovalFlagsMatchFrozenContract() {
    let h = wtToolsHarness()
    @Expect(h.runtime.registry.requiresApproval("enter_worktree"), false)
    @Expect(h.runtime.registry.requiresApproval("exit_worktree"), true)
    @Expect(wtToolsSpec(h.runtime, "enter_worktree").needsApproval, false)
    @Expect(wtToolsSpec(h.runtime, "exit_worktree").needsApproval, true)
    removeIfExists(h.root, recursive: true)
}

// 用例 4：描述文案是模型唯一读得到的触发约束，且经注册表投影进系统提示。
@Test
func worktreeToolDescriptionsRequireExplicitUserRequest() {
    let h = wtToolsHarness()
    for (name in ["enter_worktree", "exit_worktree"]) {
        let text = wtToolsSpec(h.runtime, name).description
        @Expect(text.contains("显式"), true)
        @Expect(text.contains("worktree"), true)
        @Expect(text.contains("修 bug"), true)
        @Expect(text.contains("建分支"), true)
    }
    @Expect(wtToolsSpec(h.runtime, "exit_worktree").description.contains("审批"), true)
    let prompt = SystemPromptBuilder(h.runtime.registry).build()
    @Expect(prompt.contains("enter_worktree:"), true)
    @Expect(prompt.contains("exit_worktree:"), true)
    @Expect(prompt.contains("显式"), true)
    removeIfExists(h.root, recursive: true)
}

// 用例 5（纪律 5）：SubagentLedger 只是账本——代理隔离没有真实执行入口，模型侧不登记、
// 描述里也不吹。
@Test
func worktreeAgentIsolationStaysOffTheModelSurface() {
    let h = wtToolsHarness()
    for (absent in ["worktree_agent_prepare", "worktree_agent_finish", "worktree_prepare_agent",
        "worktree_cleanup", "worktree/agent-prepare", "worktree/agent-finish"]) {
        @Expect(h.runtime.registry.has(absent), false)
    }
    @Expect(h.runtime.registry.has("enter_worktree"), true)
    @Expect(h.runtime.registry.has("exit_worktree"), true)
    for (spec in h.runtime.specs()) {
        if (spec.name.contains("worktree")) {
            @Expect(spec.description.contains("isolation"), false)
            @Expect(spec.description.contains("子代理"), false)
        }
    }
    // 账本本身不宣称任何隔离能力（它只有 spawn/settle/cancel 三态）
    let ledger = SubagentLedger(h.log)
    @Expect(ledger.count(), Int64(0))
    removeIfExists(h.root, recursive: true)
}

// ---------- 进入：会话有效目录与后续工具 ----------

// 用例 6：enter 走完整管线后会话有效目录真的换了，载荷就是八字段的 describe()，
// 参数没被改写，结果落进会话日志。
@Test
func enterWorktreeThroughModelPipelineSwitchesSessionDirectory() {
    let h = wtToolsHarness()
    @Expect(h.eventDirectory(), "")
    @Expect(h.tree.active(), false)
    let out = h.enter("tools-enter")
    @Expect(out.allowed, true)
    let shape = wtToolsAssertDescribeShape(out.why)
    @Expect(shape.get("active").getOrThrow().asBool().getValue(), true)
    @Expect(wtToolsField(out.why, "name"), "tools-enter")
    let dir = wtToolsField(out.why, "directory")
    @Expect(wtToolsSlashes(dir).contains("/.sacode/worktrees/tools-enter"), true)
    @Expect(h.bound(), dir)
    @Expect(h.tree.active(), true)
    @Expect(h.runtime.runtime.lastDetail.stage, "ran")
    @Expect(h.runtime.runtime.lastDetail.verified, true)
    @Expect(h.runtime.runtime.lastDetail.preRewrote, false)
    // 目录变更只走会话日志这一条路（append 即实例内可见，跨进程要 flush）
    @Expect(h.count("workspace/directory") > 0, true)
    @Expect(h.count("tool/runtime/call"), Int64(1))
    @Expect(h.count("tool/runtime/result"), Int64(1))
    // 跨进程可见要靠 flush，append 只是实例内可见
    @Expect(h.log.flush(), true)
    let replay = SessionLog(Path(h.root).join("session.log").toString())
    @Expect(replay.load(), true)
    @Expect(SessionWorktree(replay, fallback: h.root).active(), true)
    removeIfExists(h.root, recursive: true)
}

// 用例 7：不给 name 时由核心生成随机名，仍然落在固定目录。
@Test
func enterWorktreeWithoutNameGeneratesBinding() {
    let h = wtToolsHarness()
    let out = h.enterAuto()
    @Expect(out.allowed, true)
    let generated = wtToolsField(out.why, "name")
    @Expect(generated.size > 0, true)
    @Expect(generated.size <= 64, true)
    @Expect(wtToolsSlashes(wtToolsField(out.why, "directory")).contains("/.sacode/worktrees/${generated}"), true)
    @Expect(h.bound(), wtToolsField(out.why, "directory"))
    removeIfExists(h.root, recursive: true)
}

// 用例 8：glob / grep 的基准目录跟着换到 worktree——原始检出里的独有文件再也看不见。
@Test
func globAndGrepAfterEnterLookInsideTheWorktree() {
    let h = wtToolsHarness()
    let beforeGlob = h.call("glob", "{\"pattern\":\"*.txt\"}")
    @Expect(beforeGlob.allowed, true)
    @Expect(beforeGlob.why.contains("outside.txt"), true)
    @Expect(h.call("enter_worktree", "{\"name\":\"tools-glob\"}").allowed, true)
    let afterGlob = h.call("glob", "{\"pattern\":\"*.txt\"}")
    @Expect(afterGlob.allowed, true)
    @Expect(afterGlob.why.contains("outside.txt"), false)
    let afterGrep = h.call("grep", "{\"pattern\":\"only-in-original-checkout\"}")
    @Expect(afterGrep.allowed, true)
    @Expect(afterGrep.why.contains("outside.txt"), false)
    removeIfExists(h.root, recursive: true)
}

// 用例 9：write 落到 worktree，不污染原始检出。
@Test
func writeAfterEnterLandsInsideWorktreeNotOriginalCheckout() {
    let h = wtToolsHarness()
    @Expect(h.enter("tools-write").allowed, true)
    let dir = h.bound()
    let written = h.call("write", "{\"path\":\"wt-inside.txt\",\"content\":\"inside\"}")
    @Expect(written.allowed, true)
    @Expect(exists(Path(dir).join("wt-inside.txt")), true)
    @Expect(exists(Path(h.root).join("wt-inside.txt")), false)
    removeIfExists(h.root, recursive: true)
}

// 用例 10：read 的相对路径以 worktree 为基准——原始检出的同名文件读不到。
@Test
func readAfterEnterResolvesAgainstWorktreeDirectory() {
    let h = wtToolsHarness()
    // 先以原始检出为基准读一次，证明 outside.txt 本来在基准目录下可读
    @Expect(h.call("read", "{\"path\":\"outside.txt\"}").why, "only-in-original-checkout")
    @Expect(h.enter("tools-read").allowed, true)
    let missing = h.call("read", "{\"path\":\"outside.txt\"}")
    @Expect(missing.allowed, false)
    @Expect(missing.why.contains("not-found"), true)
    removeIfExists(h.root, recursive: true)
}

// 用例 11：edit 落在 worktree 里那份同名文件，原始检出那份逐字节不动。
@Test
func editAfterEnterTouchesWorktreeCopyOnly() {
    let h = wtToolsHarness()
    @Expect(h.enter("tools-edit").allowed, true)
    let dir = h.bound()
    @Expect(h.call("write", "{\"path\":\"dual.txt\",\"content\":\"worktree copy\"}").allowed, true)
    @Expect(h.call("read", "{\"path\":\"dual.txt\"}").why, "worktree copy")
    @Expect(h.call("edit", "{\"path\":\"dual.txt\",\"old_string\":\"worktree\",\"new_string\":\"isolated\"}").allowed, true)
    @Expect(String.fromUtf8(File.readFrom(Path(dir).join("dual.txt"))), "isolated copy")
    @Expect(exists(Path(h.root).join("dual.txt")), false)
    removeIfExists(h.root, recursive: true)
}

// 用例 12：bash 的真实工作目录跟着变（命令写的相对文件落在 worktree）。
@Test
func bashAfterEnterRunsInsideWorktreeDirectory() {
    let h = wtToolsHarness()
    @Expect(h.enter("tools-bash").allowed, true)
    let dir = h.bound()
    let ran = h.call("bash", "{\"command\":\"echo hi> wt-bash-marker.txt\"}")
    @Expect(ran.allowed, true)
    @Expect(exists(Path(dir).join("wt-bash-marker.txt")), true)
    @Expect(exists(Path(h.root).join("wt-bash-marker.txt")), false)
    removeIfExists(h.root, recursive: true)
}

// 用例 13：pwsh 同上，走的是另一条 shell 传输链，不能只验一条。
@Test
func pwshAfterEnterRunsInsideWorktreeDirectory() {
    let h = wtToolsHarness()
    @Expect(h.enter("tools-pwsh").allowed, true)
    let dir = h.bound()
    let ran = h.call("pwsh", "{\"command\":\"Set-Content -Path wt-pwsh-marker.txt -Value hi\"}")
    @Expect(ran.allowed, true)
    @Expect(exists(Path(dir).join("wt-pwsh-marker.txt")), true)
    @Expect(exists(Path(h.root).join("wt-pwsh-marker.txt")), false)
    removeIfExists(h.root, recursive: true)
}

// 用例 14：run_code 的基准目录跟随——这条钉的是「执行器在构造期冻结 cwd」那个真缺陷，
// 把 PtcExecutor 的目录改回构造值它必须变红。
@Test
func runCodeAfterEnterRunsInsideWorktreeDirectory() {
    let h = wtToolsHarness()
    @Expect(h.enter("tools-run").allowed, true)
    let dir = h.bound()
    let ran = h.call("run_code", "{\"code\":\"require('fs').writeFileSync('wt-node-marker.txt','x')\"}")
    @Expect(ran.allowed, true)
    @Expect(exists(Path(dir).join("wt-node-marker.txt")), true)
    @Expect(exists(Path(h.root).join("wt-node-marker.txt")), false)
    removeIfExists(h.root, recursive: true)
}

// 用例 15：LSP 的 workspaceRoot 取自会话有效目录，不是入口构造时那份。
@Test
func lspToolsTakeSessionDirectoryAsWorkspaceRootAfterEnter() {
    let h = wtToolsHarness()
    let router = LspRouter()
    let probe = WtToolsLspProbe()
    @Expect(router.register(probe, ["ts"]).ok, true)
    let runtime = wtToolsRuntime(h.log, h.tree, h.root, router: router)
    let lookup = "{\"path\":\"sample.ts\",\"line\":0,\"character\":0}"
    let before = runtime.execute(wtToolsCall("lsp_lookup", lookup))
    @Expect(before.allowed, true)
    @Expect(probe.lastRequest.workspaceRoot, h.root)
    let entered = runtime.execute(wtToolsCall("enter_worktree", "{\"name\":\"tools-lsp\"}"))
    @Expect(entered.allowed, true)
    let after = runtime.execute(wtToolsCall("lsp_lookup", lookup))
    @Expect(after.allowed, true)
    @Expect(probe.lastRequest.workspaceRoot, SessionWorkspace(h.log).effectiveDirectory())
    @Expect(probe.lastRequest.workspaceRoot == h.root, false)
    @Expect(probe.calls, Int64(2))
    removeIfExists(h.root, recursive: true)
}

// 用例 16：同一个相对名在 worktree 与原始检出是两份文件——观察键按目录隔离。
@Test
func sameRelativeNameIsSeparateFileAcrossWorktreeBoundary() {
    let h = wtToolsHarness()
    @Expect(h.enter("tools-dual").allowed, true)
    let dir = h.bound()
    @Expect(h.call("write", "{\"path\":\"dual-name.txt\",\"content\":\"inside\"}").allowed, true)
    let name = wtToolsField(h.tree.describe(), "name")
    @Expect(h.exit(name, "keep").allowed, true)
    @Expect(h.bound(), h.root)
    // 原始检出里没有这个名字：不能因为 worktree 里写过就被判成陈旧版本
    let outside = h.call("write", "{\"path\":\"dual-name.txt\",\"content\":\"outside\"}")
    @Expect(outside.allowed, true)
    @Expect(String.fromUtf8(File.readFrom(Path(dir).join("dual-name.txt"))), "inside")
    @Expect(String.fromUtf8(File.readFrom(Path(h.root).join("dual-name.txt"))), "outside")
    removeIfExists(h.root, recursive: true)
}

// ---------- 退出：审批、动作与副作用 ----------

// 用例 17：免审批档（入口不发工单）下 exit_worktree 整条被拒，keep 与 remove 都不例外，
// 且审批段之前就停下——worktree 目录与会话基准目录都没动。
@Test
func exitWorktreeIsRefusedForEveryActionWithoutATicket() {
    let root = wtToolsRepo()
    let log = SessionLog(Path(root).join("session.log"))
    let tree = SessionWorktree(log, fallback: root)
    let bound = wtToolsRuntime(log, tree, root)
    @Expect(bound.execute(wtToolsCall("enter_worktree", "{\"name\":\"tools-no-ticket\"}")).allowed, true)
    let dir = SessionWorkspace(log).effectiveDirectory()
    // 另起一个「没有审批回调」的运行时：core 里的免审批档就是这个形状（工单号恒为 0）
    let autoTier = ModelToolRuntime(log, false, files: true, workingDirectory: root, worktree: Some(tree))
    for (action in ["keep", "remove"]) {
        let out = autoTier.execute(wtToolsCall("exit_worktree", "{\"name\":\"tools-no-ticket\",\"action\":\"${action}\"}"))
        @Expect(out.allowed, false)
        @Expect(out.why, "approval-not-granted:unknown")
        @Expect(autoTier.runtime.lastDetail.stage, "approval-denied")
    }
    @Expect(tree.active(), true)
    @Expect(exists(Path(dir)), true)
    @Expect(SessionWorkspace(log).effectiveDirectory(), dir)
    removeIfExists(root, recursive: true)
}

// 用例 18：批给 keep 的那张票不能拿去放行 remove——票绑工具名也绑原始参数。
@Test
func keepTicketCannotAuthorizeRemove() {
    let h = wtToolsHarness()
    @Expect(h.enter("tools-steal").allowed, true)
    let dir = h.bound()
    let desk = ApprovalDesk(h.log)
    let keepArgs = "{\"name\":\"tools-steal\",\"action\":\"keep\"}"
    let ticket = desk.askForCall("exit_worktree", keepArgs)
    @Expect(desk.answer(ticket, "allowed-once"), true)
    let runtime = ModelToolRuntime(h.log, false, files: true, workingDirectory: h.root,
        worktree: Some(h.tree), desk: desk, approval: { _ => ticket })
    let remove = runtime.execute(wtToolsCall("exit_worktree", "{\"name\":\"tools-steal\",\"action\":\"remove\"}"))
    @Expect(remove.allowed, false)
    @Expect(remove.why, "approval-arguments-mismatch")
    @Expect(exists(Path(dir)), true)
    @Expect(h.tree.active(), true)
    // 挪用不烧票：同一张票对它真正批过的那次仍然放行一次
    let keep = runtime.execute(wtToolsCall("exit_worktree", keepArgs))
    @Expect(keep.allowed, true)
    @Expect(exists(Path(dir)), true)
    removeIfExists(h.root, recursive: true)
}

// 用例 19：动作闭集在运行期再校验一遍——即便工单绑的就是 action=delete，也不许生效。
@Test
func unknownExitActionIsRefusedEvenWithTicket() {
    let h = wtToolsHarness()
    @Expect(h.enter("tools-action").allowed, true)
    let dir = h.bound()
    let deleteArgs = "{\"name\":\"tools-action\",\"action\":\"delete\"}"
    let out = h.call("exit_worktree", deleteArgs)
    @Expect(out.allowed, false)
    @Expect(out.why.contains("worktree-bad-args"), true)
    @Expect(h.runtime.runtime.lastDetail.stage, "worktree-denied")
    @Expect(h.tree.active(), true)
    @Expect(exists(Path(dir)), true)
    removeIfExists(h.root, recursive: true)
}

// 用例 20：name 必须是当前绑定的那个；批过的票也不许拿去动别的名字。
@Test
func exitWorktreeNameMismatchLeavesBindingAlone() {
    let h = wtToolsHarness()
    @Expect(h.enter("tools-real").allowed, true)
    let dir = h.bound()
    let out = h.exit("ghost", "keep")
    @Expect(out.allowed, false)
    @Expect(out.why.contains("worktree-name-mismatch"), true)
    @Expect(h.tree.active(), true)
    @Expect(h.tree.name(), "tools-real")
    @Expect(exists(Path(dir)), true)
    @Expect(h.bound(), dir)
    removeIfExists(h.root, recursive: true)
}

// 用例 21：没有绑定就要求退出 → 明确拒绝，不伪造成功。
@Test
func exitWorktreeWithoutActiveBindingIsRefused() {
    let h = wtToolsHarness()
    let out = h.exit("never-entered", "keep")
    @Expect(out.allowed, false)
    @Expect(out.why.contains("worktree-not-active"), true)
    @Expect(h.eventDirectory(), "")
    @Expect(h.tree.active(), false)
    removeIfExists(h.root, recursive: true)
}

// 用例 22：keep 批过之后解绑保留目录，并且后续工具的基准目录跟着回到原始检出。
@Test
func exitWorktreeKeepRestoresOriginalDirectoryForLaterTools() {
    let h = wtToolsHarness()
    @Expect(h.enter("tools-keep").allowed, true)
    let dir = h.bound()
    @Expect(h.call("write", "{\"path\":\"kept.txt\",\"content\":\"keep me\"}").allowed, true)
    let out = h.exit("tools-keep", "keep")
    @Expect(out.allowed, true)
    @Expect(wtToolsAssertDescribeShape(out.why).get("active").getOrThrow().asBool().getValue(), false)
    @Expect(h.bound(), h.root)
    @Expect(h.tree.active(), false)
    @Expect(exists(Path(dir).join("kept.txt")), true)
    // 基准目录回正后按名字找原始检出的那份：glob 只往下走，不会替 worktree 里的同名文件说话
    let back = h.call("glob", "{\"pattern\":\"outside.txt\"}")
    @Expect(back.allowed, true)
    @Expect(back.why.contains("outside.txt"), true)
    removeIfExists(h.root, recursive: true)
}

// 用例 23：remove 批过且目录干净 → 目录真被删掉。
@Test
func exitWorktreeRemoveDeletesCleanWorktree() {
    let h = wtToolsHarness()
    @Expect(h.enter("tools-remove").allowed, true)
    let dir = h.bound()
    @Expect(exists(Path(dir)), true)
    let out = h.exit("tools-remove", "remove")
    @Expect(out.allowed, true)
    @Expect(out.why.contains("\"active\""), true)
    @Expect(exists(Path(dir)), false)
    @Expect(h.bound(), h.root)
    removeIfExists(h.root, recursive: true)
}

// 用例 24：一次调用一个结算——模型侧一轮里 enter 之后紧跟 write，落在同一轮内也已经换好目录。
@Test
func modelLoopWritesInsideWorktreeInTheSameTurn() {
    let h = wtToolsHarness()
    h.log.append("user/message", "把 notes.txt 记进 worktree")
    let first = AgentChunks([
        Chunk("tool-call-delta", "{\"name\":\"tools-loop\"}", "", toolIndex: Some(0), toolId: Some("enter-1"), toolName: Some("enter_worktree")),
        Chunk("tool-call-delta", "{\"path\":\"notes.txt\",\"content\":\"inside same turn\"}", "", toolIndex: Some(1), toolId: Some("write-1"), toolName: Some("write")),
        Chunk("finish", "", "tool_calls")])
    let final = AgentChunks([Chunk("text", "done", ""), Chunk("finish", "", "stop")])
    let result = ModelAgentLoop().run(first, { _ => final }, "test-model", TurnToken(), h.log, DeliveryQueue(32), false, toolRuntime: h.runtime)
    @Expect(result.settledToolCalls, Int64(2))
    @Expect(result.successfulToolCalls, Int64(2))
    let dir = SessionWorkspace(h.log).effectiveDirectory()
    @Expect(wtToolsSlashes(dir).contains("/.sacode/worktrees/tools-loop"), true)
    @Expect(String.fromUtf8(File.readFrom(Path(dir).join("notes.txt"))), "inside same turn")
    @Expect(exists(Path(h.root).join("notes.txt")), false)
    @Expect(h.count("tool/result"), Int64(2))
    removeIfExists(h.root, recursive: true)
}

// 用例 25：坏参数一律拒，且不留下任何目录变更；结果照旧落会话日志。
@Test
func worktreeToolBadArgsLeaveNoSessionDirectoryEvent() {
    let h = wtToolsHarness()
    let cases = [
        "{\"name\":\"tools-bad\",\"extra\":1}",
        "{\"name\":123}",
        "{\"name\":\"\"}",
        "{\"name\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}",
        "not-json",
        "{\"name\":\"tools-bad\",\"action\":\"keep\"}"
    ]
    for (args in cases) {
        let out = h.call("enter_worktree", args)
        @Expect(out.allowed, false)
        @Expect(out.why.contains("worktree-bad-args"), true)
        @Expect(out.structured, true)
    }
    for (args in ["{\"name\":\"tools-bad\"}", "{\"action\":\"keep\"}", "{\"name\":\"x\",\"action\":\"keep\",\"discard_changes\":\"yes\"}",
        "{\"name\":\"x\",\"action\":\"keep\",\"extra\":true}", "{}"]) {
        let out = h.call("exit_worktree", args)
        @Expect(out.allowed, false)
        @Expect(out.why.contains("worktree-bad-args"), true)
    }
    @Expect(h.eventDirectory(), "")
    @Expect(h.tree.active(), false)
    @Expect(h.count("tool/runtime/call"), Int64(11))
    @Expect(h.count("tool/runtime/result"), Int64(11))
    removeIfExists(h.root, recursive: true)
}

// 用例 26：非法 worktree 名被核心拒绝时，工具报拒绝而不是假成功，也不改会话基准目录。
@Test
func enterWorktreeRefusesInvalidNameWithoutTouchingSession() {
    let h = wtToolsHarness()
    for (bad in ["a/b", "../escape", "a b"]) {
        let out = h.call("enter_worktree", "{\"name\":\"${bad}\"}")
        @Expect(out.allowed, false)
        @Expect(out.why.contains("worktree-enter-refused"), true)
    }
    @Expect(h.eventDirectory(), "")
    @Expect(h.tree.active(), false)
    @Expect(exists(Path(h.root).join(".sacode").join("worktrees").join("escape")), false)
    removeIfExists(h.root, recursive: true)
}

// 用例 27：discard_changes 是真的转下去——脏目录里 remove 先被拒，带上该旗标才删掉。
// 这条钉的是「可选布尔参数不是装饰」：把它丢掉不传，第二条断言必须变红。
@Test
func removeWithDiscardChangesForwardsTheFlag() {
    let h = wtToolsHarness()
    @Expect(h.enter("tools-discard").allowed, true)
    let dir = h.bound()
    @Expect(h.call("write", "{\"path\":\"uncommitted.txt\",\"content\":\"valuable\"}").allowed, true)
    let plain = h.exit("tools-discard", "remove")
    @Expect(plain.allowed, false)
    @Expect(plain.why.contains("worktree-exit-refused"), true)
    @Expect(exists(Path(dir)), true)
    @Expect(h.tree.active(), true)
    let forced = h.exit("tools-discard", "remove", discardChanges: true)
    @Expect(forced.allowed, true)
    @Expect(exists(Path(dir)), false)
    @Expect(h.bound(), h.root)
    removeIfExists(h.root, recursive: true)
}

// 用例 28：guard 否决在审批之后、执行之前就把调用拦下，worktree 不接这道否决。
@Test
func guardDenialStopsWorktreeToolsBeforeTheyRun() {
    let root = wtToolsRepo()
    let log = SessionLog(Path(root).join("session.log"))
    let tree = SessionWorktree(log, fallback: root)
    let runtime = ModelToolRuntime(log, false, files: true, workingDirectory: root,
        worktree: Some(tree), guard: { _, _ => false })
    let out = runtime.execute(wtToolsCall("enter_worktree", "{\"name\":\"tools-guard\"}"))
    @Expect(out.allowed, false)
    @Expect(out.why, "guard-denied")
    @Expect(tree.active(), false)
    @Expect(SessionWorkspace(log).directory(), "")
    removeIfExists(root, recursive: true)
}

// 用例 29：只登记工具名、不绑参数的旧工单不能放行 remove——沿用 consumeExactForCall 的
// 既有语义（execution/start 与 computer.* 同一条），不是新发明一种审批。
@Test
func nameOnlyTicketCannotReleaseRemoveOfSessionWorktree() {
    let h = wtToolsHarness()
    @Expect(h.enter("tools-loose").allowed, true)
    let dir = h.bound()
    let desk = ApprovalDesk(h.log)
    let loose = desk.ask("exit_worktree")
    @Expect(desk.answer(loose, "allowed-once"), true)
    let runtime = ModelToolRuntime(h.log, false, files: true, workingDirectory: h.root,
        worktree: Some(h.tree), desk: desk, approval: { _ => loose })
    let out = runtime.execute(wtToolsCall("exit_worktree", "{\"name\":\"tools-loose\",\"action\":\"remove\"}"))
    @Expect(out.allowed, false)
    @Expect(out.why, "approval-not-granted:allowed-once")
    @Expect(h.tree.active(), true)
    @Expect(exists(Path(dir)), true)
    removeIfExists(h.root, recursive: true)
}

// 用例 30：手工入口那条 answer 字符串（调用方自报「批过了」）不能放行退出会话 worktree。
@Test
func manualAnswerTierCannotReleaseExitWorktree() {
    let h = wtToolsHarness()
    @Expect(h.enter("tools-manual").allowed, true)
    let dir = h.bound()
    let manual = ToolRuntime(h.log, h.runtime.registry, workingDirectory: h.root,
        worktree: Some(WorktreeTools(h.tree)))
    let out = manual.execute("exit_worktree", "{\"name\":\"tools-manual\",\"action\":\"remove\"}", "allowed-once", true)
    @Expect(out.allowed, false)
    @Expect(out.why, "worktree-exact-approval-required")
    @Expect(manual.lastDetail.stage, "approval-denied")
    @Expect(h.tree.active(), true)
    @Expect(exists(Path(dir)), true)
    removeIfExists(h.root, recursive: true)
}
