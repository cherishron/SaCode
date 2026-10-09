package core
import std.collection.ArrayList
import std.collection.HashMap
import std.fs.*
import std.io.*
import stdx.encoding.json.*

// provider 增量；工具参数保留原始字符串分片，不解析或重编码。
public class Chunk {
    let kind: String    // text | tool-call-delta | usage | finish
    public let text: String
    let reason: String
    public let choiceIndex: Option<Int64>
    public let toolIndex: Option<Int64>
    public let toolId: Option<String>
    public let toolName: Option<String>
    public let requestSeq: Option<Int64>
    public let elapsedMs: Option<Int64>
    public init(kind: String, text: String, reason: String,
        choiceIndex!: Option<Int64> = None, toolIndex!: Option<Int64> = None,
        toolId!: Option<String> = None, toolName!: Option<String> = None,
        requestSeq!: Option<Int64> = None, elapsedMs!: Option<Int64> = None) {
        this.kind = kind
        this.text = text
        this.reason = reason
        this.choiceIndex = choiceIndex
        this.toolIndex = toolIndex
        this.toolId = toolId
        this.toolName = toolName
        this.requestSeq = requestSeq
        this.elapsedMs = elapsedMs
    }
}

public class FakeProvider {
    // 半帧/多字节分片：text 被切成两块，装配必须拼回原值
    public func script(): ArrayList<Chunk> {
        let c = ArrayList<Chunk>()
        c.add(Chunk("text", "你好，", ""))
        c.add(Chunk("text", "world", ""))
        c.add(Chunk("tool-call-delta", "read", ""))
        c.add(Chunk("usage", "12", ""))
        c.add(Chunk("finish", "", "stop"))
        return c
    }
}

public class Assembly {
    public let text = ArrayList<String>()
    public let toolCalls = ArrayList<String>()
    public var usage: String = ""
    public var finishReason: String = ""
    public var interrupted: Bool = true

    // 规则：usage 必须先于 finish；finish 后不再接收 chunk；
    // max-tokens 结束时全部 tool calls 作废。
    public func push(ch: Chunk) {
        if (!interrupted) {
            return   // finish 之后的 chunk 视为协议违例，丢弃并保持终态
        }
        if (ch.kind == "text") {
            text.add(ch.text)
            return
        }
        if (ch.kind == "tool-call-delta") {
            toolCalls.add(ch.text)
            return
        }
        if (ch.kind == "usage") {
            if (finishReason.size == 0) { usage = ch.text }
            return
        }
        if (ch.kind == "finish") {
            finishReason = ch.reason
            interrupted = false
            if (ch.reason == "max-tokens") {
                toolCalls.clear()
            }
        }
    }

    public func assembledText(): String {
        var s = ""
        for (t in text) { s += t }
        return s
    }
}

public class ApprovalOutcome {
    public let allowed: Bool
    public let why: String
    // 结构化失败（LSP 那类要带 reason 与回退线索的）走这一格：上层不再把整个对象
    // JSON 转义进 {"error":"..."}，模型与审查侧才解析得出失败原因。
    public let structured: Bool
    public init(allowed: Bool, why: String, structured!: Bool = false) {
        this.allowed = allowed
        this.why = why
        this.structured = structured
    }
}

public class ToolRuntime {
    let log: SessionLog
    let registry: ToolRegistry
    public var guardDenials: Int64 = 0
    public var registryMisses: Int64 = 0
    // 每次执行都从头新建：留在上一次上会被读成「这次也走过了那一段」
    public var lastDetail = ToolDetail()
    // 已观察过的路径 → 当时那份字节的状态。它是 write 的判断依据：
    // 「我上次看到的就是现在这份吗」，答不出就不能拿旧认知去覆盖别人的改动。
    let observed = HashMap<String, FileObservation>()
    let workingDirectory: String
    let agentOwned: Bool
    let todoAllowParallel: Bool
    let modelProtocol: Bool
    let shellExecutor: ShellExecutor
    let ptcExecutor: PtcExecutor
    let terminalBuffer: TerminalBuffer
    let jobStore: JobStore
    // 统一执行器表：工具名 → (工具名, 参数) → 结果。pipeline 只查这张表，
    // 手工 execute、模型 executeWithApproval 与 ModelToolRuntime 共用同一派发。
    let executors = HashMap<String, (String, String) -> ApprovalOutcome>()
    // L1：7 个 lsp_* 工具与宿主协议面共用同一个 router；会话身份与 turn 取消令牌
    // 由入口绑进来，缺省就是「本入口没有会话 / 没有可取消的轮次」，不是「随便造一个」。
    let lspRouter: LspRouter
    let lspSession: String
    let lspToken: TurnToken
    var lspRequestSeq: Int64 = 0
    // 浏览器工具执行器：由上层入口注入后 browser.* 工具名才可经 pipeline() 分发。
    // 声明了却未注入执行器的 browser.* 工具名照旧归一成 unknown-tool。
    var browserExecutor: Option<BrowserToolExecutor> = None

    public init(log: SessionLog, registry: ToolRegistry, workingDirectory!: String = "", agentOwned!: Bool = false, todoAllowParallel!: Bool = false, modelProtocol!: Bool = false,
        lspRouter!: LspRouter = LspRouters.sharedRouter(), lspSession!: String = "", lspToken!: TurnToken = TurnToken(), team!: ?TeamTools = None, webTools!: ?WebTools = None,
        worktree!: ?WorktreeTools = None, computer!: ?ComputerToolExecutor = None) {
        this.log = log
        this.registry = registry
        this.workingDirectory = workingDirectory
        this.agentOwned = agentOwned
        this.todoAllowParallel = todoAllowParallel
        this.modelProtocol = modelProtocol
        this.lspRouter = lspRouter
        this.lspSession = lspSession
        this.lspToken = lspToken
        this.shellExecutor = ShellExecutor(workingDirectory: workingDirectory)
        this.ptcExecutor = PtcExecutor(workingDirectory: workingDirectory)
        this.terminalBuffer = TerminalBuffer(log)
        this.jobStore = JobStore()
        registerBuiltinExecutors()
        if (let Some(bound) <- team) {
            for (spec in teamToolSpecs()) {
                executors.add(spec.name, { name, args => teamStep(bound, name, args) })
            }
        }
        if (let Some(bound) <- webTools) {
            executors.add("web_fetch", { n, a => webStep(bound, n, a) })
            executors.add("web_search", { n, a => webStep(bound, n, a) })
        }
        // 桌面控制：verb 从工具名尾段还原，执行器与 provider 只在入口显式开启时注入。
        if (let Some(bound) <- computer) {
            for (spec in computerToolSpecs()) {
                executors.add(spec.name, { name, args => computerStep(bound, name[9..], args) })
            }
        }
        // 会话 worktree 的两条工具：声明面由各入口登记，这里只接派发。
        // 审批与 guard 仍在 pipeline 之前完成，没绑定就不登记执行器——
        // 只声明没执行入口的名字一律归一成 unknown-tool，不会假成功。
        if (let Some(bound) <- worktree) {
            executors.add(worktreeEnterToolName, { n, a => worktreeStep(bound, n, a) })
            executors.add(worktreeExitToolName, { n, a => worktreeStep(bound, n, a) })
        }
    }

    // worktree 派发：目录、分支、三重保护与 workspace/directory 事件都在 SessionWorktree 里，
    // 这一层只保证管线照走——参数原样交下去（不改写），结果原样落 tool/runtime/result。
    private func worktreeStep(bound: WorktreeTools, name: String, args: String): ApprovalOutcome {
        let outcome = bound.execute(name, args)
        lastDetail.argsAfterPre = args
        lastDetail.stage = if (outcome.allowed) { "ran" } else { "worktree-denied" }
        lastDetail.verified = outcome.allowed
        recordResult(outcome.why)
        return outcome
    }

    // 团队派发仍在审批与 guard 之后；身份及参数校验由绑定实例负责。
    private func teamStep(bound: TeamTools, name: String, args: String): ApprovalOutcome {
        let outcome = bound.execute(name, args)
        lastDetail.argsAfterPre = args
        lastDetail.stage = if (outcome.allowed) { "ran" } else { "team-denied" }
        lastDetail.verified = outcome.allowed
        recordResult(outcome.why)
        return outcome
    }

    // 网页工具派发：web_fetch / web_search 免审批，执行器只把参数转给 WebTools。
    private func webStep(bound: WebTools, name: String, args: String): ApprovalOutcome {
        try {
            let result = bound.execute(name, args, lspToken)
            lastDetail.argsAfterPre = args
            lastDetail.stage = "ran"
            lastDetail.verified = true
            recordResult(result)
            return ApprovalOutcome(true, result)
        } catch (error: Exception) {
            lastDetail.argsAfterPre = args
            lastDetail.stage = "web-error"
            lastDetail.verified = false
            recordResult("web-error:${error.message}")
            return ApprovalOutcome(false, error.message)
        }
    }

    // 内建执行器注册：每个工具一行，取代 pipeline 里的硬编码分支链。
    // 这里只登记「本仓已实现」的执行器；ToolSpec 声明面由各入口自行注册，
    // 声明了却没登记执行器的名字照旧归一成 unknown-tool。
    private func registerBuiltinExecutors(): Unit {
        executors.add("todo_write", { _, a => todoStep(a) })
        executors.add("update_goal", { _, a => updateGoalStep(a) })
        executors.add("read", { _, a => readStep(a) })
        executors.add("write", { _, a => writeStep(a) })
        executors.add("edit", { _, a => editStep(a) })
        executors.add("glob", { _, a => globStep(a) })
        executors.add("grep", { _, a => grepStep(a) })
        executors.add("bash", { n, a => shellStep(n, a) })
        executors.add("pwsh", { n, a => shellStep(n, a) })
        executors.add("run_code", { _, a => runCodeStep(a) })
        executors.add("lsp", { _, a => lspStep(a) })
        // 7 个语义 verb 各一条；旧的 lsp 执行器保留给手工调用（模型声明面已换成这 7 条）。
        executors.add("lsp_define", { _, a => lspDefineStep(a) })
        executors.add("lsp_lookup", { _, a => lspLookupStep(a) })
        executors.add("lsp_references", { _, a => lspReferencesStep(a) })
        executors.add("lsp_implementation", { _, a => lspImplementationStep(a) })
        executors.add("lsp_call_hierarchy", { _, a => lspCallHierarchyStep(a) })
        executors.add("lsp_diagnostics", { _, a => lspDiagnosticsStep(a) })
        executors.add("lsp_rename", { _, a => lspRenameStep(a) })
        // 浏览器工具：执行器由上层入口注入 browserExecutor 后才可用。
        // 声明了却未注入执行器的 browser.* 工具名照旧归一成 unknown-tool.
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
    }

    // 浏览器工具派发：提取 verb（去掉 browser. 前缀），委托 BrowserToolExecutor 执行。
    // 未注入执行器时返回 browser-provider-not-injected，pipeline 会将其归一成 unknown-tool。
    private func browserStep(verb: String, args: String): ApprovalOutcome {
        if (let Some(exec) <- browserExecutor) {
            let result = exec.perform(verb, args, token: lspToken)
            if (result.ok) {
                return ApprovalOutcome(true, result.content)
            } else {
                return ApprovalOutcome(false, "browser-${result.failureKind}::${result.message}")
            }
        }
        return ApprovalOutcome(false, "browser-provider-not-injected")
    }

    public func setBrowserExecutor(exec: BrowserToolExecutor): Unit {
        browserExecutor = Some(exec)
    }

    // 桌面工具派发：只回传真实终态。已投递动作即便随后被取消，committed/截图仍按原样保留，
    // 这里不把「取消」改写「未执行」；完整结果走 modelProtocol 的 runtime/result，
    // 模型可见的那条 tool/result 由轮次循环带引用另写。
    private func computerStep(exec: ComputerToolExecutor, verb: String, args: String): ApprovalOutcome {
        let result = exec.perform(verb, args, token: lspToken)
        let payload = JsonObject()
        payload.put("ok", JsonBool(result.ok))
        payload.put("verb", JsonString(result.verb))
        payload.put("content", JsonValue.fromStr(result.content))
        payload.put("failureKind", JsonString(result.failureKind))
        payload.put("message", JsonString(result.message))
        lastDetail.argsAfterPre = args
        lastDetail.stage = if (result.ok) { "ran" } else { "computer-${result.failureKind}" }
        lastDetail.verified = result.ok
        recordResult("computer.${verb}:${result.failureKind}")
        return ApprovalOutcome(result.ok, payload.toString(), structured: true)
    }

    // 模型协议由上层统一记录关联 ID；管线审计仍入同一日志，但不重复进入模型历史。
    private func recordCall(data: String): Unit {
        log.append(if (modelProtocol) { "tool/runtime/call" } else { "tool/call" }, data)
    }
    private func recordResult(data: String): Unit {
        log.append(if (modelProtocol) { "tool/runtime/result" } else { "tool/result" }, data)
    }
    private func workingPath(path: String): String {
        let base = SessionWorkspace(log, fallback: workingDirectory).effectiveDirectory()
        if (base.size == 0 || Path(path).isAbsolute()) { return path }
        return Path(base).join(path).toString()
    }

    // 固定序：注册表查询 → 审批 → guard → pre-execute → snapshot → execute → post-execute（无损校验）
    public func execute(name: String, args: String, answer: String, allowedByGuard: Bool): ApprovalOutcome {
        lastDetail = ToolDetail()
        recordCall( "${name} ${args}")
        if (!registry.has(name)) {
            // 未登记的工具不走审批：拒绝并计数，审批应答再正确也无效
            registryMisses += 1
            lastDetail.stage = "unregistered"
            recordResult( "unregistered:${name}")
            return ApprovalOutcome(false, "unregistered-tool:${name}")
        }
        if (registry.requiresApproval(name)) {
            // 桌面动作不接受自报审批：调用方说「批过了」不作数，只能凭 desk 发的精确工单走
            // executeWithApproval()。留在这条入口上等于给绕过审批面开了一道口子。
            if (name.startsWith("computer.")) {
                lastDetail.stage = "approval-denied"
                recordResult("denied:${name}:computer-exact-approval-required")
                return ApprovalOutcome(false, "computer-exact-approval-required")
            }
            // 退出会话 worktree 只认 desk 发过号的工单：调用方自报「批过了」在这条路上
            // 不作数——keep 会挪走后续所有工具的地基，remove 还要删目录，
            // 免审批档不能替人批这两件事。
            if (name == worktreeExitToolName) {
                lastDetail.stage = "approval-denied"
                recordResult("denied:${name}:worktree-exact-approval-required")
                return ApprovalOutcome(false, "worktree-exact-approval-required")
            }
            // fail-closed：只有 allowed-once 放行，无应答者/非法应答一律拒
            if (answer != "allowed-once") {
                lastDetail.stage = "approval-denied"
                recordResult( "denied:${name}:${answer}")
                return ApprovalOutcome(false, "approval-not-allowed-once")
            }
        }
        return pipeline(name, args, allowedByGuard)
    }

    // 走审批工单的固定序：注册表 → 消费一次性凭据 → guard → execute → tool/result 落盘。
    // 与 execute() 的区别只在审批来源：这里的答案必须是 desk 发过号的工单，
    // 调用方自己声明「批过了」不作数；工单过期、被拒、已用过，全都拒。
    public func executeWithApproval(name: String, args: String, approvalId: Int64, allowedByGuard: Bool, desk: ApprovalDesk): ApprovalOutcome {
        lastDetail = ToolDetail()
        recordCall( "${name} ${args}")
        if (!registry.has(name)) {
            registryMisses += 1
            lastDetail.stage = "unregistered"
            recordResult( "unregistered:${name}")
            return ApprovalOutcome(false, "unregistered-tool:${name}")
        }
        if (registry.requiresApproval(name)) {
            // 桌面控制动的是真人的鼠标键盘，工单必须绑死这一次的arguments：旧式只批工具名的票
            // 能被他挪去放行任意一次点击，这里不吃。其余工具保持原宽松语义。
            // computer.* 与退出会话 worktree 都要「绑着原始参数」的工单：只登记工具名
            // （desk.ask 那条旧路）的票不能放行删目录与挪地基——沿用 consumeExactForCall
            // 这条既有语义，不另发明审批。
            let exactApproval = name.startsWith("computer.") || name == worktreeExitToolName
            let grant = if (exactApproval) {
                desk.consumeExactForCall(approvalId, name, args)
            } else {
                desk.consumeForCall(approvalId, name, args)
            }
            if (grant != "allowed-once") {
                let bound = desk.toolOf(approvalId)
                if (bound.size > 0 && bound != name) {
                    // 票是批给别的工具的：拒绝原因必须和「没批过」分开写，
                    // 否则日志里只留一个 denied，答不出人到底批了什么、被拿去干了什么。
                    lastDetail.stage = "approval-mismatch"
                    recordResult( "denied:${name}:approval-mismatch:${bound}")
                    return ApprovalOutcome(false, "approval-tool-mismatch:${bound}")
                }
                if (bound == name && !desk.argumentsMatch(approvalId, args)) {
                    lastDetail.stage = "approval-mismatch"
                    recordResult("denied:${name}:approval-arguments-mismatch")
                    return ApprovalOutcome(false, "approval-arguments-mismatch")
                }
                let st = desk.stateOf(approvalId)
                lastDetail.stage = "approval-denied"
                recordResult( "denied:${name}:approval-${st}")
                return ApprovalOutcome(false, "approval-not-granted:${st}")
            }
        }
        // guard 之后的执行统一走 pipeline：两种审批来源共用同一条管线，
        // 审批怎么来的不该改变参数归一化、snapshot 或无损校验的行为。
        return pipeline(name, args, allowedByGuard)
    }

    // guard → pre-execute → snapshot → execute → post-execute（无损校验），五段都在
    // lastDetail 上留痕；失败一律归一成互不相同的阶段码——只报「没成功」的管线，
    // 日志和界面都答不出该找谁。
    //
    // 派发按执行器表进行：每个已实现工具在 init 里注册一行 (toolName, args) 闭包，
    // 不再叠硬编码分支链；手工入口与模型工具运行时共用这一张表。
    // 登记了 ToolSpec 但没给执行器的名字仍归一成 unknown-tool，
    // 与「未登记」（unregistered）是两种失败。
    private func pipeline(name: String, args: String, allowedByGuard: Bool): ApprovalOutcome {
        if (!allowedByGuard) {
            guardDenials += 1
            lastDetail.stage = "guard-denied"
            recordResult( "denied:${name}:guard")
            return ApprovalOutcome(false, "guard-denied")
        }
        match (executors.get(name)) {
            case Some(step) => return step(name, args)
            case None =>
                // 注册过但这个实现还没写的工具：与「未登记」是两种失败，必须分开归一
                lastDetail.stage = "unknown-tool"
                recordResult( "unknown-tool:${name}")
                return ApprovalOutcome(false, "unknown-tool:${name}")
        }
    }

    // todo_write 工具：TodoTool 的执行器表入口，与其它工具走同一派发路径。
    private func updateGoalStep(args: String): ApprovalOutcome {
        var goalId = ""
        var status = ""
        try {
            let obj = JsonValue.fromStr(args).asObject()
            if (obj.size() != 2) { throw Exception("bad-args") }
            goalId = obj.get("goal_id").getOrThrow().asString().getValue()
            status = obj.get("status").getOrThrow().asString().getValue()
            if (goalId.trimAscii().size == 0 || (status != "completed" && status != "in_progress")) {
                throw Exception("bad-args")
            }
        } catch (_: Exception) { recordResult("bad-args"); return ApprovalOutcome(false, "bad-args") }
        var outcome = ApprovalOutcome(false, "goal-not-active")
        synchronized(log.mtx) {
            let snap = GoalService(log).snapshot()
            if (snap.phase == "none" || snap.id != goalId) {
                recordResult("goal-not-found:${goalId}")
                outcome = ApprovalOutcome(false, "goal-not-found")
            } else if (snap.phase != "active") {
                recordResult("goal-not-active:${goalId}:${snap.phase}")
            } else {
                let recorded = GoalClaim(log).recordStatus(goalId, snap.revision, status)
                if (status == "completed" && !recorded) {
                    recordResult("goal-no-open-round:${goalId}")
                    outcome = ApprovalOutcome(false, "goal-no-open-round")
                } else {
                    let result = if (status == "completed") { "ok-goal-completed:${goalId}" } else { "ok-goal-update:${goalId}" }
                    recordResult(result)
                    lastDetail.verified = true
                    outcome = ApprovalOutcome(true, "ok")
                }
            }
        }
        lastDetail.stage = if (outcome.allowed) { "done" } else { outcome.why }
        return outcome
    }

    private func todoStep(args: String): ApprovalOutcome {
        try {
            let result = TodoTool(log, todoAllowParallel).execute(args, agentOwned)
            lastDetail.stage = "done"
            lastDetail.verified = true
            recordResult( result)
            return ApprovalOutcome(true, result)
        } catch (e: Exception) {
            lastDetail.stage = "bad-args"
            recordResult( e.message)
            return ApprovalOutcome(false, e.message)
        }
    }

    // write 工具：已有文件走受保护原子替换，新建文件走禁止覆盖的发布。
    // 需审批；已有文件必须先读过且期间未被外部改动。
    private func writeStep(args: String): ApprovalOutcome {
        let parsed = normalizeArgs(args)
        lastDetail.preRewrote = (parsed.norm != args)
        lastDetail.argsAfterPre = parsed.norm
        if (!parsed.ok) {
            lastDetail.stage = "bad-args"
            recordResult( "bad-args")
            return ApprovalOutcome(false, "bad-args")
        }
        let path = workingPath(parsed.path)
        lastDetail.snapshotBefore = priorSize(path)
        lastDetail.snapshotExpected = parsed.content.toArray().size
        // snapshot 段顺手取当前那份字节的状态。观察过且状态已变＝第三方动过手，
        // 这一段必须在任何写入之前判：拒了还照写，等于覆盖掉别人的工作。
        var key = ""
        var wasExisting = false
        try {
            wasExisting = exists(path)
            key = fileObservationKey(path)
            let seen = observed.get(key)
            if (wasExisting) {
                if (let Some(prior) <- seen) {
                    if (!prior.present) { return failFile("fs-not-observed", path) }
                    if (!sameFileBytes(prior.bytes, File.readFrom(path))) {
                        return failFile("fs-stale-version", path)
                    }
                } else {
                    return failFile("fs-not-observed", path)
                }
                // 受保护替换：独占临时文件写完整后原子落位，写途中崩溃不会留下撕裂的目标。
                replaceFileAtomically(path, parsed.content.toArray())
            } else {
                if (let Some(prior) <- seen) {
                    if (prior.present) { return failFile("fs-stale-version", path) }
                }
                // 发布新文件必须在落位时拒绝覆盖，不能靠 exists→write 的时间窗口。
                publishNewFile(path, parsed.content.toArray())
            }
        } catch (e: IOException) {
            lastDetail.stage = "io-error"
            recordResult( "io-error:${path}")
            return ApprovalOutcome(false, "io-error:${path}")
        } catch (e: Exception) {
            lastDetail.stage = "threw"
            recordResult( "threw:${path}")
            return ApprovalOutcome(false, "threw:${path}")
        }
        // post-execute：写后重读逐字节比对，掉一个字节、被改写一个字节都不算成功
        var back: Array<Byte> = []
        try {
            back = File.readFrom(path)
            key = fileObservationKey(path)
        } catch (e: Exception) {
            return failFile("post-read-error", path)
        }
        let want = parsed.content.toArray()
        if (!sameFileBytes(back, want)) {
            lastDetail.verified = false
            lastDetail.stage = "torn-write"
            recordResult( "torn-write:${path}:expected=${want.size},got=${back.size}")
            return ApprovalOutcome(false, "torn-write:${path}")
        }
        // 这一份刚由本工具写下并核对过，观察记录跟着更新，否则下一次自己写自己会被自己拦
        observed[key] = FileObservation(true, back)
        lastDetail.verified = true
        lastDetail.stage = "ran"
        let out = "ok:${path}"
        recordResult( out)
        return ApprovalOutcome(true, out)
    }

    // 读侧也走前两段与后两段：pre-execute 裁出路径与可选 offset/limit 分页，
    // post-execute 交回的必须是盘上真实读到的字节（顺手记下这一份的状态供 write 判断）。
    // 缓存读结果等于没读——FS_NOT_OBSERVED 说的就是这件事。
    //
    // 有界读取：返回给模型与日志的正文按行分页（默认 offset=0、limit=2000 行，
    // 另有 256 KiB 字节硬上界兜底单行超长文件），截断时尾部带 read-truncated 标记。
    // 观察面仍登记全量字节——「我读过盘上这份」与「给模型看多少」是两件事，
    // 版本保护不因分页而放宽；无截断时结果格式与既有重放断言逐字一致。
    private func readStep(args: String): ApprovalOutcome {
        var raw = args.trimAscii()
        var offset: Int64 = 0
        var limit: Int64 = 2000
        if (raw.startsWith("{")) {
            try {
                let obj = JsonValue.fromStr(raw).asObject()
                // additionalProperties:false：只允许 path/offset/limit，用已知键计数法检测多余字段
                let known = (if (obj.get("path").isSome()) { 1 } else { 0 }) + (if (obj.get("offset").isSome()) { 1 } else { 0 }) + (if (obj.get("limit").isSome()) { 1 } else { 0 })
                if (obj.size() != known) { throw Exception("bad-args") }
                raw = obj.get("path").getOrThrow().asString().getValue()
                if (let Some(v) <- obj.get("offset")) { offset = v.asInt().getValue() }
                if (let Some(v) <- obj.get("limit")) { limit = v.asInt().getValue() }
            } catch (_: Exception) {
                lastDetail.stage = "bad-args"
                recordResult("bad-args")
                return ApprovalOutcome(false, "bad-args")
            }
        }
        if (offset < 0 || limit <= 0) {
            lastDetail.stage = "bad-args"
            recordResult("bad-args")
            return ApprovalOutcome(false, "bad-args")
        }
        let path = if (raw.size == 0) { raw } else { workingPath(raw) }
        lastDetail.argsAfterPre = path
        lastDetail.preRewrote = (path != args)
        if (path.size == 0) {
            lastDetail.stage = "bad-args"
            recordResult( "bad-args")
            return ApprovalOutcome(false, "bad-args")
        }
        if (!exists(Path(path))) {
            // 缺失也是观察；若之后别人创建了它，只能走禁止覆盖的创建意图。
            try { observed[fileObservationKey(path)] = FileObservation(false, []) } catch (e: Exception) {
                // 父目录也不存在时无法解析身份，创建本来就会失败；读仍报 not-found。
            }
            lastDetail.stage = "not-found"
            recordResult( "not-found:${path}")
            return ApprovalOutcome(false, "not-found:${path}")
        }
        var bytes: Array<Byte> = []
        try {
            bytes = File.readFrom(path)
        } catch (e: IOException) {
            lastDetail.stage = "io-error"
            recordResult( "io-error:${path}")
            return ApprovalOutcome(false, "io-error:${path}")
        } catch (e: Exception) {
            lastDetail.stage = "threw"
            recordResult( "threw:${path}")
            return ApprovalOutcome(false, "threw:${path}")
        }
        var text = ""
        var key = ""
        try {
            text = String.fromUtf8(bytes)
            key = fileObservationKey(path)
        } catch (e: IllegalArgumentException) {
            return failFile("invalid-encoding", path)
        } catch (e: Exception) {
            return failFile("io-error", path)
        }
        // 有界切片：行数先按 offset/limit 裁，再按字节上界收口。
        let lines = text.split("\n")
        let totalLines = Int64(lines.size)
        var start = if (offset < totalLines) { offset } else { totalLines }
        var end = start + limit
        if (end > totalLines) { end = totalLines }
        var sliced = ""
        var i = start
        var byteBudget = Int64(262144)
        while (i < end) {
            let piece = lines[i] + (if (i + 1 < end) { "\n" } else { "" })
            let pieceBytes = piece.toArray().size
            if (i > start && byteBudget - pieceBytes < 0) {
                end = i
                break
            }
            byteBudget -= pieceBytes
            sliced += piece
            i += 1
        }
        let returned = end - start
        // 解码与身份解析都成功，才登记已观察并记录成功，失败不能冒充 read 成功。
        // 观察始终是全量字节：分页只限定「给模型看多少」，不放宽 write 的版本比对。
        observed[key] = FileObservation(true, bytes)
        lastDetail.snapshotBefore = bytes.size
        lastDetail.snapshotExpected = bytes.size
        lastDetail.verified = true
        lastDetail.stage = "ran"
        if (returned >= totalLines && start == 0) {
            // 未截断：正文进日志可重放，格式与既有断言逐字一致。
            recordResult( "ok-read:${path}:${bytes.size}\n${text}")
            return ApprovalOutcome(true, text)
        }
        // 截断：日志与模型上下文只进切片，标记里写清窗口与总量。
        let marker = "[read-truncated:offset=${start},lines=${returned}/${totalLines}]"
        recordResult( "ok-read:${path}:${bytes.size}:lines=${returned}/${totalLines}\n${sliced}\n${marker}")
        return ApprovalOutcome(true, "${sliced}\n${marker}")
    }

    private func failFile(stage: String, path: String): ApprovalOutcome {
        lastDetail.stage = stage
        recordResult( "${stage}:${path}")
        return ApprovalOutcome(false, "${stage}:${path}")
    }

    // edit 工具：读取文件 → 查找 old_string → 替换为 new_string → 写回。
    // 需要文件已被观察（与 write 同级），且 old_string 必须精确出现一次。
    private func editStep(args: String): ApprovalOutcome {
        let parsed = parseEditArgs(args)
        if (!parsed.ok) {
            lastDetail.stage = "bad-args"
            recordResult( "bad-args")
            return ApprovalOutcome(false, "bad-args")
        }
        lastDetail.argsAfterPre = parsed.norm
        lastDetail.preRewrote = (parsed.norm != args)
        let path = workingPath(parsed.path)
        if (path.size == 0) {
            lastDetail.stage = "bad-args"
            recordResult( "bad-args")
            return ApprovalOutcome(false, "bad-args")
        }
        // 检查观察状态（与 write 一致：已存在文件必须已读）
        var key = fileObservationKey(path)
        if (exists(path)) {
            if (let Some(prior) <- observed.get(key)) {
                if (!prior.present) { return failFile("fs-not-observed", path) }
                if (!sameFileBytes(prior.bytes, File.readFrom(path))) {
                    return failFile("fs-stale-version", path)
                }
            } else {
                return failFile("fs-not-observed", path)
            }
        } else {
            lastDetail.stage = "not-found"
            recordResult( "not-found:${path}")
            return ApprovalOutcome(false, "not-found:${path}")
        }
        // 读文件内容
        var text = ""
        var bytes: Array<Byte> = []
        try {
            bytes = File.readFrom(path)
            text = String.fromUtf8(bytes)
        } catch (e: IOException) {
            lastDetail.stage = "io-error"
            recordResult( "io-error:${path}")
            return ApprovalOutcome(false, "io-error:${path}")
        } catch (e: Exception) {
            lastDetail.stage = "threw"
            recordResult( "threw:${path}")
            return ApprovalOutcome(false, "threw:${path}")
        }
        // 查找 old_string 出现次数
        let count = countOccurrences(text, parsed.oldString)
        if (count == 0) {
            lastDetail.stage = "edit-not-found"
            recordResult( "edit-not-found:${path}")
            return ApprovalOutcome(false, "edit-not-found:${path}")
        }
        if (count > 1) {
            lastDetail.stage = "edit-ambiguous"
            recordResult( "edit-ambiguous:${path}:${count}")
            return ApprovalOutcome(false, "edit-ambiguous:${path}:${count}")
        }
        // 替换并写回：受保护原子替换，写途中崩溃不会留下撕裂的目标。
        let newText = replaceFirst(text, parsed.oldString, parsed.newString)
        lastDetail.snapshotBefore = bytes.size
        lastDetail.snapshotExpected = newText.toArray().size
        try {
            replaceFileAtomically(path, newText.toArray())
        } catch (e: IOException) {
            lastDetail.stage = "io-error"
            recordResult( "io-error:${path}")
            return ApprovalOutcome(false, "io-error:${path}")
        }
        // 验证写入（与 write 一致：写后重读比对）
        var back: Array<Byte> = []
        try {
            back = File.readFrom(path)
            key = fileObservationKey(path)
        } catch (e: Exception) {
            return failFile("post-read-error", path)
        }
        let want = newText.toArray()
        if (!sameFileBytes(back, want)) {
            lastDetail.verified = false
            lastDetail.stage = "torn-write"
            recordResult( "torn-write:${path}:expected=${want.size},got=${back.size}")
            return ApprovalOutcome(false, "torn-write:${path}")
        }
        observed[key] = FileObservation(true, back)
        lastDetail.verified = true
        lastDetail.stage = "ran"
        recordResult( "ok-edit:${path}")
        return ApprovalOutcome(true, "ok:${path}")
    }

    // glob 工具：查找匹配模式的所有文件（只读，免审批）。
    private func globStep(args: String): ApprovalOutcome {
        let pattern = parseSimpleJsonString(args, "pattern")
        if (pattern.size == 0) {
            lastDetail.stage = "bad-args"
            recordResult( "bad-args")
            return ApprovalOutcome(false, "bad-args")
        }
        lastDetail.argsAfterPre = pattern
        lastDetail.preRewrote = (pattern != args)
        let cwd = workingPath("")
        let results = globFiles(pattern, cwd)
        var json = "["
        var first = true
        for (r in results) {
            if (!first) { json += "," }
            first = false
            json += "\"${jsonEscapeText(r)}\""
        }
        json += "]"
        lastDetail.stage = "ran"
        lastDetail.verified = true
        recordResult("ok-glob:${results.size}")
        return ApprovalOutcome(true, json)
    }

    // grep 工具：搜索文件内容（只读，免审批）。
    private func grepStep(args: String): ApprovalOutcome {
        let parsed = parseGrepArgs(args)
        if (!parsed.ok) {
            lastDetail.stage = "bad-args"
            recordResult("bad-args")
            return ApprovalOutcome(false, "bad-args")
        }
        lastDetail.argsAfterPre = parsed.norm
        lastDetail.preRewrote = (parsed.norm != args)
        let path = if (parsed.path.size > 0) { workingPath(parsed.path) } else { workingPath("") }
        let results = grepFiles(parsed.pattern, path)
        var json = "["
        var first = true
        for (r in results) {
            if (!first) { json += "," }
            first = false
            json += "\"${jsonEscapeText(r)}\""
        }
        json += "]"
        lastDetail.stage = "ran"
        lastDetail.verified = true
        recordResult("ok-grep:${results.size}")
        return ApprovalOutcome(true, json)
    }

    // shell 工具（bash/pwsh）：执行 shell 命令，返回 stdout/stderr/退出码。
    // 需审批（与 write 同级）。执行结果桥接到 TerminalBuffer（PTY）与 JobStore（Jobs）。
    private func shellStep(toolName: String, args: String): ApprovalOutcome {
        let parsed = parseShellArgs(args)
        if (!parsed.ok) {
            lastDetail.stage = "bad-args"
            recordResult("bad-args")
            return ApprovalOutcome(false, "bad-args")
        }
        lastDetail.argsAfterPre = parsed.norm
        lastDetail.preRewrote = (parsed.norm != args)
        // 创建 Job 记录（PTY/Jobs 桥接）
        let jobId = jobStore.start("bash", parsed.command)
        // 确定 shell 命令
        let shellCmd: String
        let shellArgs: Array<String>
        if (toolName == "pwsh") {
            shellCmd = "powershell"
            shellArgs = ["-Command"]
        } else {
            shellCmd = "cmd"
            shellArgs = ["/c"]
        }
        // 执行
        let result = shellExecutor.runShellCommand(shellCmd, shellArgs, parsed.command,
            cwd: workingPath(""), timeoutMs: 30000, sandboxMode: parsed.sandboxMode)
        if (result.isSome()) {
            if (let Some(r) <- result) {
                // 有退出事实不代表捕获完整；不能把编码/管道失败当成成功空输出。
                if (!r.outputComplete || r.error.size > 0) {
                    try { jobStore.mark(jobId, "failed") } catch (_: Exception) {}
                    lastDetail.stage = "io-error"
                    recordResult("io-error:shell-${toolName}:${r.error}")
                    return ApprovalOutcome(false, "io-error:shell-${toolName}:${r.error}")
                }
                lastDetail.stage = "ran"
                lastDetail.verified = r.exitCode == 0 && !r.timedOut && !r.cancelled
                var output = "${r.stdout}\n${r.stderr}"
                if (r.stdoutTruncated) { output += "\n[shell-stdout-truncated:65536-bytes]" }
                if (r.stderrTruncated) { output += "\n[shell-stderr-truncated:65536-bytes]" }
                if (!lastDetail.verified) { output += "\n[shell-exit-code:${r.exitCode};timed-out:${r.timedOut};cancelled:${r.cancelled}]" }
                // PTY 桥接：写入 TerminalBuffer
                if (output.size > 0) {
                    terminalBuffer.append(jobId, output)
                }
                // Jobs 桥接：更新状态
                if (r.timedOut || r.cancelled) {
                    try { jobStore.mark(jobId, "stopping") } catch (_: Exception) {}
                    try { jobStore.mark(jobId, "killed") } catch (_: Exception) {}
                } else if (r.exitCode == 0) {
                    try { jobStore.mark(jobId, "completed") } catch (_: Exception) {}
                } else {
                    try { jobStore.mark(jobId, "failed") } catch (_: Exception) {}
                }
                let prefix = if (lastDetail.verified) { "ok-shell" } else { "failed-shell" }
                recordResult("${prefix}:${toolName}:${r.exitCode}:${output.size}")
                return ApprovalOutcome(lastDetail.verified, output)
            }
        }
        // 执行失败：标记 Job 为 failed
        try { jobStore.mark(jobId, "failed") } catch (_: Exception) {}
        lastDetail.stage = "io-error"
        recordResult("io-error:shell-${toolName}")
        return ApprovalOutcome(false, "io-error:shell-${toolName}")
    }

    // run_code 工具：通过 node 执行 JS 代码（PTC 运行时）。
    // 需审批。执行结果桥接到 TerminalBuffer（PTY）与 JobStore（Jobs）。
    private func runCodeStep(args: String): ApprovalOutcome {
        let code = parseSimpleJsonString(args, "code")
        if (code.size == 0) {
            lastDetail.stage = "bad-args"
            recordResult("bad-args")
            return ApprovalOutcome(false, "bad-args")
        }
        lastDetail.argsAfterPre = code
        lastDetail.preRewrote = (code != args)
        // 创建 Job 记录（PTY/Jobs 桥接）
        let label = if (code.size > 80) { code[0..80] } else { code }
        let jobId = jobStore.start("subagent", label)
        // 基准目录每次执行都现算：workingPath 读的是会话有效目录（会话日志里最后一条
        // workspace/directory），不是构造期那份常量——进入/退出 worktree 之后 node 子进程
        // 必须跟着换地方，这一点和 read/write/glob/grep/bash 走的是同一个口径。
        let result = ptcExecutor.runCode(code, timeoutMs: 30000, sandboxMode: "workspace-write",
            cwd: workingPath(""))
        if (result.isSome()) {
            if (let Some(r) <- result) {
                lastDetail.stage = "ran"
                lastDetail.verified = true
                let output = "${r.stdout}\n${r.stderr}"
                // PTY 桥接：写入 TerminalBuffer
                if (output.size > 0) {
                    terminalBuffer.append(jobId, output)
                }
                // Jobs 桥接：更新状态
                if (r.timedOut) {
                    try { jobStore.mark(jobId, "stopping") } catch (_: Exception) {}
                    try { jobStore.mark(jobId, "killed") } catch (_: Exception) {}
                } else if (r.exitCode == 0) {
                    try { jobStore.mark(jobId, "completed") } catch (_: Exception) {}
                } else {
                    try { jobStore.mark(jobId, "failed") } catch (_: Exception) {}
                }
                recordResult("ok-run_code:${r.exitCode}:${output.size}")
                return ApprovalOutcome(true, output)
            }
        }
        // 执行失败：标记 Job 为 failed
        try { jobStore.mark(jobId, "failed") } catch (_: Exception) {}
        lastDetail.stage = "io-error"
        recordResult("io-error:run_code")
        return ApprovalOutcome(false, "io-error:run_code")
    }

    // 请求身份由本管线自己铸造：一次调用一个序号，取消与在途归属才有可对齐的名字。
    // 序号是实例内的，跨进程不需要一致——真源仍是会话日志里那两条 call/result。
    private func nextLspRequestId(): String {
        lspRequestSeq += 1
        return "lsp-${lspRequestSeq}"
    }

    // 7 个 verb 共用同一条通道：参数解析 → 契约校验 → 路由 → 形状化输出。
    // 每个 verb 各写一份校验迟早漏一个，而漏掉的那个正好是 rename。
    private func lspVerbStep(verb: String, args: String): ApprovalOutcome {
        let params = lspParseParams(args, verb)
        if (!params.ok) {
            lastDetail.stage = "bad-args"
            recordResult("bad-args")
            let bad = LspResponse(); bad.ok = false; bad.reason = lspFailBadArgs; bad.verb = verb
            return ApprovalOutcome(false, lspResponseJson(bad), structured: true)
        }
        let root0 = SessionWorkspace(log, fallback: workingDirectory).effectiveDirectory()
        // 入口没绑会话工作区（CLI 手工面）时退回进程当前目录，而不是让请求带着空身份
        // 落成 lsp-bad-args——那会让这 7 条工具在该入口永远走不到路由。
        let root = if (root0.size > 0) { root0 } else { lspProcessWorkspace() }
        let session = if (lspSession.size > 0) { lspSession } else { root }
        let req = lspBuildRequest(session, nextLspRequestId(), verb, params, root, lspToken)
        lastDetail.argsAfterPre = req.path
        lastDetail.preRewrote = (req.path != params.path)
        let resp = lspRouter.route(req)
        let payload = lspResponseJson(resp)
        if (resp.ok) {
            lastDetail.stage = "ran"
            lastDetail.verified = true
            recordResult("ok-lsp-${verb}:${lspOutcomeCount(resp)}")
            return ApprovalOutcome(true, payload)
        }
        // 失败保持失败：原因、非语义标记与回退线索都在 payload 里，不塌成空数组。
        lastDetail.stage = "lsp-${resp.reason}"
        recordResult("lsp-failed:${resp.reason}")
        return ApprovalOutcome(false, payload, structured: true)
    }

    private func lspDefineStep(args: String): ApprovalOutcome { return lspVerbStep("define", args) }
    private func lspLookupStep(args: String): ApprovalOutcome { return lspVerbStep("lookup", args) }
    private func lspReferencesStep(args: String): ApprovalOutcome { return lspVerbStep("references", args) }
    private func lspImplementationStep(args: String): ApprovalOutcome { return lspVerbStep("implementation", args) }
    private func lspCallHierarchyStep(args: String): ApprovalOutcome { return lspVerbStep("call-hierarchy", args) }
    private func lspDiagnosticsStep(args: String): ApprovalOutcome { return lspVerbStep("diagnostics", args) }
    private func lspRenameStep(args: String): ApprovalOutcome { return lspVerbStep("rename", args) }

    // lsp 工具：从文件中提取符号（只读，免审批）。
    private func lspStep(args: String): ApprovalOutcome {
        let parsed = parseLspArgs(args)
        if (!parsed.ok) {
            lastDetail.stage = "bad-args"
            recordResult("bad-args")
            return ApprovalOutcome(false, "bad-args")
        }
        lastDetail.argsAfterPre = parsed.norm
        lastDetail.preRewrote = (parsed.norm != args)
        let path = workingPath(parsed.path)
        let symbols = lspSymbols(path)
        var json = "["
        var first = true
        for (s in symbols) {
            if (!first) { json += "," }
            first = false
            json += "\"${jsonEscapeText(s)}\""
        }
        json += "]"
        lastDetail.stage = "ran"
        lastDetail.verified = true
        recordResult("ok-lsp:${symbols.size}")
        return ApprovalOutcome(true, json)
    }

    // 解析 edit 工具参数：{ "path": "...", "old_string": "...", "new_string": "..." }
    private func parseEditArgs(args: String): EditArgs {
        if (!args.trimAscii().startsWith("{")) {
            return EditArgs("", "", "", "", false)
        }
        try {
            let obj = JsonValue.fromStr(args).asObject()
            if (obj.size() != 3) { return EditArgs("", "", "", "", false) }
            let path = obj.get("path").getOrThrow().asString().getValue()
            let oldStr = obj.get("old_string").getOrThrow().asString().getValue()
            let newStr = obj.get("new_string").getOrThrow().asString().getValue()
            if (path.size == 0 || oldStr.size == 0) { return EditArgs("", "", "", "", false) }
            return EditArgs(path, oldStr, newStr, obj.toString(), true)
        } catch (_: Exception) { return EditArgs("", "", "", "", false) }
    }

    // 解析 grep 工具参数：{ "pattern": "...", "path": "..." }
    private func parseGrepArgs(args: String): GrepArgs {
        if (!args.trimAscii().startsWith("{")) {
            return GrepArgs("", "", "", false)
        }
        try {
            let obj = JsonValue.fromStr(args).asObject()
            if (obj.size() < 1 || obj.size() > 2) { return GrepArgs("", "", "", false) }
            let pattern = obj.get("pattern").getOrThrow().asString().getValue()
            var path = ""
            if (let Some(p) <- obj.get("path")) { path = p.asString().getValue() }
            if (pattern.size == 0) { return GrepArgs("", "", "", false) }
            return GrepArgs(pattern, path, obj.toString(), true)
        } catch (_: Exception) { return GrepArgs("", "", "", false) }
    }

    // 解析 shell 工具参数：{ "command": "...", "sandbox_mode": "..." }
    private func parseShellArgs(args: String): ShellArgs {
        let trimmed = args.trimAscii()
        if (!trimmed.startsWith("{")) {
            return ShellArgs(trimmed, "workspace-write", trimmed, true)
        }
        try {
            let obj = JsonValue.fromStr(trimmed).asObject()
            // additionalProperties:false：只允许 command/sandbox_mode 两个键
            // additionalProperties:false：只允许 command/sandbox_mode，用已知键计数法
            let knownShell = (if (obj.get("command").isSome()) { 1 } else { 0 }) + (if (obj.get("sandbox_mode").isSome()) { 1 } else { 0 })
            if (obj.size() != knownShell) { return ShellArgs("", "", "", false) }
            let cmd = obj.get("command").getOrThrow().asString().getValue()
            var sandboxMode = "workspace-write"
            if (let Some(sm) <- obj.get("sandbox_mode")) { sandboxMode = sm.asString().getValue() }
            if (cmd.size == 0) { return ShellArgs("", "", "", false) }
            return ShellArgs(cmd, sandboxMode, obj.toString(), true)
        } catch (_: Exception) { return ShellArgs("", "", "", false) }
    }

    // 解析 lsp 工具参数：{ "operation": "symbols", "path": "..." }
    private func parseLspArgs(args: String): LspArgs {
        if (!args.trimAscii().startsWith("{")) {
            return LspArgs("", "", false)
        }
        try {
            let obj = JsonValue.fromStr(args).asObject()
            // additionalProperties:false：只允许 path 一个键
            if (obj.size() != 1) { return LspArgs("", "", false) }
            let path = obj.get("path").getOrThrow().asString().getValue()
            if (path.size == 0) { return LspArgs("", "", false) }
            return LspArgs(path, obj.toString(), true)
        } catch (_: Exception) { return LspArgs("", "", false) }
    }

    // 从 JSON 对象中解析单个字符串字段
    private func parseSimpleJsonString(args: String, field: String): String {
        let trimmed = args.trimAscii()
        if (!trimmed.startsWith("{")) { return "" }
        try {
            let obj = JsonValue.fromStr(trimmed).asObject()
            // additionalProperties:false：只允许 field 这一个键
            if (obj.size() != 1) { return "" }
            if (let Some(v) <- obj.get(field)) { return v.asString().getValue() }
        } catch (_: Exception) {}
        return ""
    }

    // 统计子串出现次数
    private func countOccurrences(text: String, sub: String): Int64 {
        if (sub.size == 0) { return 0 }
        let ta = text.toArray()
        let sa = sub.toArray()
        var count: Int64 = 0
        var i: Int64 = 0
        while (i <= ta.size - sa.size) {
            var found = true
            var j: Int64 = 0
            var innerDone = false
            while (j < sa.size) {
                let idx = i + j
                if (ta[idx] != sa[j]) {
                    found = false
                    innerDone = true
                }
                j += 1
                if (innerDone) { break }
            }
            if (found) { count += 1 }
            i += 1
        }
        return count
    }

    // 替换第一次出现的子串
    private func replaceFirst(text: String, old: String, new: String): String {
        let ta = text.toArray()
        let oa = old.toArray()
        let na = new.toArray()
        var i: Int64 = 0
        while (i <= ta.size - oa.size) {
            var found = true
            var j: Int64 = 0
            var innerDone = false
            while (j < oa.size) {
                let idx = i + j
                if (ta[idx] != oa[j]) {
                    found = false
                    innerDone = true
                }
                j += 1
                if (innerDone) { break }
            }
            if (found) {
                let result = ArrayList<Byte>()
                var k: Int64 = 0
                while (k < i) {
                    result.add(ta[k])
                    k += 1
                }
                k = 0
                while (k < na.size) {
                    result.add(na[k])
                    k += 1
                }
                k = i + oa.size
                while (k < ta.size) {
                    result.add(ta[k])
                    k += 1
                }
                return String.fromUtf8(result.toArray())
            }
            i += 1
        }
        return text
    }

    // pre-execute 的归一化只动「路径与正文之间」的空白：路径前的空白、路径与正文之间多余的
    // 空白都吃掉，但正文内部的空格是内容，不是分隔符——把它当分隔符会静默丢内容。
    func normalizeArgs(args: String): ToolArgs {
        if (args.trimAscii().startsWith("{")) {
            try {
                let obj = JsonValue.fromStr(args).asObject()
                if (obj.size() != 2) { throw Exception("bad-args") }
                let path = obj.get("path").getOrThrow().asString().getValue()
                let content = obj.get("content").getOrThrow().asString().getValue()
                if (path.trimAscii().size == 0) { throw Exception("bad-args") }
                return ToolArgs(path, content, obj.toString(), true)
            } catch (_: Exception) { return ToolArgs("", "", "", false) }
        }
        let parts = args.split(" ")
        var path = ""
        var body = ArrayList<String>()
        var i: Int64 = 0
        while (i < parts.size) {
            if (parts[i].size > 0) {
                break
            }
            i += 1
        }
        if (i < parts.size) {
            path = parts[i]
            i += 1
        }
        while (i < parts.size && parts[i].size == 0) {
            i += 1
        }
        while (i < parts.size) {
            body.add(parts[i])
            i += 1
        }
        if (path.size == 0 || body.size == 0) {
            return ToolArgs(path, "", "${path}", false)
        }
        // 尾部空白同属要丢掉的「分隔区」，只有正文中间的空白才是内容
        var last = body.size - 1
        while (last >= 0 && body[last].size == 0) {
            last -= 1
        }
        if (last < 0) {
            return ToolArgs(path, "", "${path}", false)
        }
        var content = body[0]
        var j: Int64 = 1
        while (j <= last) {
            content = "${content} ${body[j]}"
            j += 1
        }
        return ToolArgs(path, content, "${path} ${content}", true)
    }

    func priorSize(path: String): Int64 {
        if (!exists(Path(path))) {
            return Int64(0)
        }
        try {
            return File.readFrom(path).size
        } catch (e: Exception) {
            return Int64(-2)
        }
    }
}

// 当前 Windows 构建的观察键：解析绝对路径和软链接，统一 ASCII 大小写。
// 逐字节保存观察值，不能用会碰撞的自制短哈希代替内容一致性。
func fileObservationKey(path: String): String {
    if (exists(path)) { return canonicalize(path).toString().toAsciiLower() }
    let parent = Path(path).parent.toString()
    let dir = if (parent.size == 0) { "./" } else { parent }
    let full = canonicalize(dir).join(Path(path).fileName)
    return full.toString().toAsciiLower()
}

class FileObservation {
    let present: Bool
    let bytes: Array<Byte>
    init(present: Bool, bytes: Array<Byte>) { this.present = present; this.bytes = bytes }
}

func sameFileBytes(left: Array<Byte>, right: Array<Byte>): Bool {
    if (left.size != right.size) { return false }
    var i: Int64 = 0
    while (i < left.size) {
        if (left[i] != right[i]) { return false }
        i += 1
    }
    return true
}

// 独占临时文件先写完整，再原子落位；目标抢先出现时不替换它。
func publishNewFile(path: String, bytes: Array<Byte>): Unit {
    let parent = Path(path).parent.toString()
    let dir = if (parent.size == 0) { "./" } else { parent }
    let tmp = File.createTemp(Path(dir))
    let staging = tmp.info.path.toString()
    var closed = false
    try {
        tmp.write(bytes)
        tmp.close()
        closed = true
        rename(staging, to: path, overwrite: false)
    } finally {
        if (!closed) { tmp.close() }
        removeIfExists(staging, recursive: false)
    }
}

// 已有文件的受保护原子替换：独占临时文件先写完整，再 rename(overwrite: true) 落位。
// 与 publishNewFile 的区别只在落位语义——发布新文件绝不覆盖，替换必须覆盖；
// 两者共享同一道「先写完整、再原子改名」的保护。直接 File.writeTo 在写途中
// 崩溃会留下撕裂的目标（半份新内容），这里崩在任意一步，盘上要么是完整旧版、
// 要么是完整新版，不会出现中间态。落位后临时文件已随 rename 消失，
// finally 兜底清理失败路径上的残留 staging。
func replaceFileAtomically(path: String, bytes: Array<Byte>): Unit {
    let parent = Path(path).parent.toString()
    let dir = if (parent.size == 0) { "./" } else { parent }
    let tmp = File.createTemp(Path(dir))
    let staging = tmp.info.path.toString()
    var closed = false
    try {
        tmp.write(bytes)
        tmp.close()
        closed = true
        rename(staging, to: path, overwrite: true)
    } finally {
        if (!closed) { tmp.close() }
        removeIfExists(staging, recursive: false)
    }
}

// pre-execute 的产物：路径、正文、归一化后的整串（用于判断有没有改写过）。
public class ToolArgs {
    public let path: String
    public let content: String
    public let norm: String
    public let ok: Bool

    public init(path: String, content: String, norm: String, ok: Bool) {
        this.path = path
        this.content = content
        this.norm = norm
        this.ok = ok
    }
}

// 管线各段留下的事实。两个入口与日志都靠它回答「走到哪一段、为什么停」，
// 而不是靠返回值猜。
public class ToolDetail {
    public var stage: String = "not-run"
    public var argsAfterPre: String = ""
    public var preRewrote: Bool = false
    public var snapshotBefore: Int64 = -1
    public var snapshotExpected: Int64 = 0
    public var verified: Bool = false
}

// edit 工具参数
class EditArgs {
    let path: String
    let oldString: String
    let newString: String
    let norm: String
    let ok: Bool
    init(path: String, oldString: String, newString: String, norm: String, ok: Bool) {
        this.path = path
        this.oldString = oldString
        this.newString = newString
        this.norm = norm
        this.ok = ok
    }
}

// grep 工具参数
class GrepArgs {
    let pattern: String
    let path: String
    let norm: String
    let ok: Bool
    init(pattern: String, path: String, norm: String, ok: Bool) {
        this.pattern = pattern
        this.path = path
        this.norm = norm
        this.ok = ok
    }
}

// shell 工具参数
class ShellArgs {
    let command: String
    let sandboxMode: String
    let norm: String
    let ok: Bool
    init(command: String, sandboxMode: String, norm: String, ok: Bool) {
        this.command = command
        this.sandboxMode = sandboxMode
        this.norm = norm
        this.ok = ok
    }
}

// lsp 工具参数
class LspArgs {
    let path: String
    let norm: String
    let ok: Bool
    init(path: String, norm: String, ok: Bool) {
        this.path = path
        this.norm = norm
        this.ok = ok
    }
}
