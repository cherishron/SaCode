package cli

import core.*
import std.env.*
import std.fs.*
import std.time.*
import std.convert.*
import stdx.encoding.json.*

class CliKnowledgeStoreStamp {
    let store: KnowledgeStore
    let revision: Int64
    let digest: String
    init(store: KnowledgeStore) {
        let snapshot = store.read()
        this.store = store
        this.revision = snapshot.get("revision").getOrThrow().asInt().getValue()
        this.digest = sha256Hex(snapshot.toString().toArray())
    }
}

class CliGoalKnowledgeBuild {
    let result: KnowledgeContextResult
    let failed: Bool
    init(result: KnowledgeContextResult, failed: Bool) {
        this.result = result
        this.failed = failed
    }
}

class CliGoalRoundIdentity {
    let revision: Int64
    let round: Int64
    init(revision: Int64, round: Int64) {
        this.revision = revision
        this.round = round
    }
}

class CliGoalKnowledgePreparation {
    let ready: Bool
    init(ready: Bool) {
        this.ready = ready
    }
}

func cliGoalRoundIdentity(log: SessionLog): ?CliGoalRoundIdentity {
    var found: ?CliGoalRoundIdentity = None
    try {
        for (event in log.snapshotEvents()) {
            if (event.eventType == "goal/round-prompt") {
                let value = JsonValue.fromStr(event.data).asObject()
                let revision = value.get("revision").getOrThrow().asInt().getValue()
                let round = value.get("round").getOrThrow().asInt().getValue()
                if (revision < 0 || round < 1) {
                    return None
                }
                found = Some(CliGoalRoundIdentity(revision, round))
            }
        }
    } catch (_: Exception) {
        return None
    }
    return found
}

func cliGoalHasUserMessage(log: SessionLog, targetUserSeq: Int64): Bool {
    for (event in log.snapshotEvents()) {
        if (event.seq == targetUserSeq && event.eventType == "user/message") {
            return true
        }
    }
    return false
}

func cliGoalRoundCurrent(log: SessionLog, targetUserSeq: Int64, query: String, expected: CliGoalRoundIdentity): Bool {
    if (!cliGoalHasUserMessage(log, targetUserSeq)) {
        return false
    }
    if (let Some(currentRound) <- cliGoalRoundIdentity(log)) {
        if (currentRound.revision != expected.revision || currentRound.round != expected.round) {
            return false
        }
    } else {
        return false
    }
    let goal = GoalService(log).snapshot()
    return goal.phase == "active" && goal.revision == expected.revision && goal.objective == query.trimAscii()
}

func cliKnowledgeStamp(scope: String, workspace: String): ?CliKnowledgeStoreStamp {
    try {
        let store = KnowledgeStore.forScope(scope, workspace)
        let stamp = CliKnowledgeStoreStamp(store)
        if (store.scope != scope || (scope == "project" && store.workspace != workspace)) {
            return None
        }
        return Some(stamp)
    } catch (_: Exception) {
        return None
    }
}

func cliKnowledgeStampCurrent(stamp: ?CliKnowledgeStoreStamp): Bool {
    if (let Some(expected) <- stamp) {
        try {
            let current = CliKnowledgeStoreStamp(expected.store)
            return current.revision == expected.revision && current.digest == expected.digest
        } catch (_: Exception) {
            return false
        }
    }
    return true
}

func cliGoalWorkspaceCurrent(log: SessionLog, fallback: String, expectedPath: String, expectedRevision: Int64): Bool {
    let workspace = SessionWorkspace(log, fallback: fallback)
    if (workspace.revision() != expectedRevision) {
        return false
    }
    if (!workspace.available()) {
        return expectedPath.size == 0
    }
    try {
        return canonicalize(Path(workspace.effectiveDirectory())).toString() == expectedPath
    } catch (_: Exception) {
        return false
    }
}

func cliProjectKnowledgeMatchesCurrent(stamp: ?CliKnowledgeStoreStamp, audit: JsonObject): Bool {
    if (let Some(project) <- stamp) {
        try {
            let matches = audit.get("matches").getOrThrow().asArray()
            for (value in matches.getItems()) {
                let item = value.asObject()
                if (item.get("scope").getOrThrow().asString().getValue() != "project") {
                    continue
                }
                let id = item.get("id").getOrThrow().asString().getValue()
                let reference = JsonValue.fromStr(project.store.reference(id, project.revision)).asObject()
                let document = reference.get("document").getOrThrow().asObject()
                if (document.get("revision").getOrThrow().asInt().getValue() !=
                    item.get("revision").getOrThrow().asInt().getValue() ||
                    document.get("sourceDigest").getOrThrow().asString().getValue() !=
                    item.get("sourceDigest").getOrThrow().asString().getValue() ||
                    document.get("sourcePath").getOrThrow().asString().getValue() !=
                    item.get("sourcePath").getOrThrow().asString().getValue()) {
                    return false
                }
            }
            return true
        } catch (_: Exception) {
            return false
        }
    }
    return true
}

func cliEmptyKnowledgeAudit(query: String, targetUserSeq: Int64, workspace: String, workspaceRevision: Int64): String {
    let audit = JsonObject()
    audit.put("version", JsonInt(1))
    audit.put("status", JsonString("retrieval-error"))
    audit.put("searchKind", JsonString("bounded-literal-lexical"))
    audit.put("targetUserSeq", JsonInt(targetUserSeq))
    audit.put("workspace", JsonString(workspace))
    audit.put("workspaceRevision", JsonInt(workspaceRevision))
    audit.put("queryDigest", JsonString(sha256Hex(query.toArray())))
    audit.put("candidateCount", JsonInt(0))
    audit.put("truncatedCount", JsonInt(0))
    audit.put("matches", JsonArray())
    return audit.toString()
}

func cliGoalKnowledgeBuild(query: String, targetUserSeq: Int64, workspace: String, workspaceRevision: Int64,
    userStore: ?CliKnowledgeStoreStamp, projectStore: ?CliKnowledgeStoreStamp): CliGoalKnowledgeBuild {
    try {
        let result = KnowledgeContextBuilder.build(query, targetUserSeq, workspace, workspaceRevision,
            userStore: if (let Some(stamp) <- userStore) {
                Some(stamp.store)
            } else {
                None
            }, projectStore: if (let Some(stamp) <- projectStore) {
                Some(stamp.store)
            } else {
                None
            }, maxDocuments: 6, maxContextBytes: 10000, maxDocumentBytes: 1800)
        return CliGoalKnowledgeBuild(result, false)
    } catch (_: Exception) {
        let audit = cliEmptyKnowledgeAudit(query, targetUserSeq, workspace, workspaceRevision)
        return CliGoalKnowledgeBuild(KnowledgeContextResult("", audit, 0), true)
    }
}

func cliGoalKnowledgeAudit(result: KnowledgeContextResult, workspace: String, userStore: ?CliKnowledgeStoreStamp,
    projectStore: ?CliKnowledgeStoreStamp, round: CliGoalRoundIdentity, statusOverride: String): String {
    let audit = JsonValue.fromStr(result.retrievalJson).asObject()
    audit.put("workspaceIdentity", JsonString(workspace))
    audit.put("userStoreStatus", JsonString(if (let Some(_) <- userStore) {
        "available"
    } else {
        "unavailable"
    }))
    audit.put("projectStoreStatus", JsonString(if (let Some(_) <- projectStore) {
        "available"
    } else {
        "unavailable"
    }))
    audit.put("userStoreRevision", JsonInt(if (let Some(stamp) <- userStore) {
        stamp.revision
    } else {
        -1
    }))
    audit.put("projectStoreRevision", JsonInt(if (let Some(stamp) <- projectStore) {
        stamp.revision
    } else {
        -1
    }))
    if (statusOverride.size > 0) {
        audit.put("status", JsonString(statusOverride))
        audit.put("candidateCount", JsonInt(0))
        audit.put("truncatedCount", JsonInt(0))
        audit.put("matches", JsonArray())
    }
    audit.put("goalRevision", JsonInt(round.revision))
    audit.put("goalRound", JsonInt(round.round))
    return audit.toString()
}

func cliClearGoalKnowledge(log: SessionLog, checkpoint: GoalCheckpoint, reason: String): Bool {
    try {
        log.append("knowledge/context/clear", reason)
        return checkpoint.checkpoint()
    } catch (_: Exception) {
        return false
    }
}

func cliPrepareGoalKnowledge(log: SessionLog, checkpoint: GoalCheckpoint, targetUserSeq: Int64, query: String,
    fallbackWorkspace: String, token: TurnToken): CliGoalKnowledgePreparation {
    if (token.cancelled()) {
        return CliGoalKnowledgePreparation(false)
    }
    if (!cliGoalHasUserMessage(log, targetUserSeq)) {
        return CliGoalKnowledgePreparation(false)
    }
    let round = cliGoalRoundIdentity(log)
    if (!round.isSome()) {
        return CliGoalKnowledgePreparation(false)
    }
    let expectedRound = round.getOrThrow()
    if (!cliGoalRoundCurrent(log, targetUserSeq, query, expectedRound)) {
        return CliGoalKnowledgePreparation(false)
    }
    if (!cliClearGoalKnowledge(log, checkpoint, "goal-round-start")) {
        return CliGoalKnowledgePreparation(false)
    }

    let sessionWorkspace = SessionWorkspace(log, fallback: fallbackWorkspace)
    let workspaceRevision = sessionWorkspace.revision()
    var workspace = ""
    if (sessionWorkspace.available()) {
        try {
            workspace = canonicalize(Path(sessionWorkspace.effectiveDirectory())).toString()
        } catch (_: Exception) {
            workspace = ""
        }
    }
    let userStore = cliKnowledgeStamp("user", "")
    let projectStore: ?CliKnowledgeStoreStamp = if (workspace.size > 0) {
        cliKnowledgeStamp("project", workspace)
    } else {
        None
    }
    let built = cliGoalKnowledgeBuild(query, targetUserSeq, workspace, workspaceRevision, userStore, projectStore)
    var statusOverride = if (built.failed) {
        "retrieval-error"
    } else {
        ""
    }
    var current = cliGoalWorkspaceCurrent(log, fallbackWorkspace, workspace, workspaceRevision) &&
        cliKnowledgeStampCurrent(userStore) && cliKnowledgeStampCurrent(projectStore)
    current = current && cliProjectKnowledgeMatchesCurrent(projectStore,
        JsonValue.fromStr(built.result.retrievalJson).asObject())
    current = current && cliGoalRoundCurrent(log, targetUserSeq, query, expectedRound)
    if (!current) {
        statusOverride = "discarded-changed-snapshot"
    }
    let noStoreAvailable = if (let Some(_) <- userStore) {
        false
    } else if (let Some(_) <- projectStore) {
        false
    } else {
        true
    }
    if (noStoreAvailable && statusOverride.size == 0 && built.result.context.size == 0) {
        statusOverride = "store-unavailable"
    }

    var auditJson = cliGoalKnowledgeAudit(built.result, workspace, userStore, projectStore, expectedRound,
        statusOverride)
    try {
        // 审计先于正文事件；只有审计和正文都通过持久屏障时才会发模型请求。
        log.append("knowledge/retrieval", auditJson)
        // 审计写入后再次核验，缩短来源或工作区变化与 context 追加之间的竞态窗口。
        var stillCurrent = !token.cancelled() && cliGoalHasUserMessage(log, targetUserSeq) && cliGoalWorkspaceCurrent(
            log, fallbackWorkspace, workspace, workspaceRevision) && cliKnowledgeStampCurrent(userStore) &&
            cliKnowledgeStampCurrent(projectStore) && cliGoalRoundCurrent(log, targetUserSeq, query, expectedRound) &&
            cliProjectKnowledgeMatchesCurrent(projectStore, JsonValue.fromStr(built.result.retrievalJson).asObject())
        if (!stillCurrent && !built.failed) {
            statusOverride = if (token.cancelled()) {
                "cancelled"
            } else {
                "discarded-changed-snapshot"
            }
            auditJson = cliGoalKnowledgeAudit(built.result, workspace, userStore, projectStore, expectedRound,
                statusOverride)
            log.append("knowledge/retrieval", auditJson)
        }
        if (stillCurrent && !built.failed && built.result.context.size > 0) {
            let enriched = KnowledgeContextResult(built.result.context, auditJson, built.result.matchCount)
            log.append("knowledge/context", knowledgeContextEventJson(enriched))
        }
        if (!checkpoint.checkpoint()) {
            if (!cliClearGoalKnowledge(log, checkpoint, "knowledge-context-checkpoint-failed")) {
                getStdErr().writeln("knowledge-context-clear-unconfirmed; session durable-frozen")
            }
            return CliGoalKnowledgePreparation(false)
        }
    } catch (_: Exception) {
        // 若日志部分写入，先尽力记下 clear；清理失败仍然 fail closed。
        if (!cliClearGoalKnowledge(log, checkpoint, "knowledge-context-audit-failed")) {
            getStdErr().writeln("knowledge-context-clear-unconfirmed; session durable-frozen")
        }
        return CliGoalKnowledgePreparation(false)
    }
    if (token.cancelled()) {
        if (!cliClearGoalKnowledge(log, checkpoint, "knowledge-context-cancelled")) {
            return CliGoalKnowledgePreparation(false)
        }
        return CliGoalKnowledgePreparation(false)
    }
    return CliGoalKnowledgePreparation(true)
}

// 用户入口与旧 goal 无参数自测分开；读取恢复投影不会创建运行线程。
func cliGoalJson(goal: GoalSnapshot): String {
    return "{\"id\":\"${jsonEscapeText(goal.id)}\",\"revision\":${goal.revision},\"phase\":\"${jsonEscapeText(goal.phase)}\",\"objective\":\"${jsonEscapeText(goal.objective)}\",\"blockedReason\":\"${jsonEscapeText(goal.blockedReason)}\"}"
}

func runGoalCommand(args: Array<String>): Int64 {
    if (args.size == 2 && args[1] == "describe") {
        try {
            let log = SessionLog("session.log")
            if (!log.load()) {
                throw Exception("replay-rejected")
            }
            println(cliGoalJson(GoalService(log).snapshot()))
            return 0
        } catch (e: Exception) {
            getStdErr().writeln("goal: ${e.message}");
            return 1
        }
    }
    if ((args.size != 3 && args.size != 5) || args[1] != "run" || (args.size == 5 && args[3] != "--budget")) {
        getStdErr().writeln("usage: sacode goal run <objective> [--budget <tokens>] | goal describe")
        return 64
    }
    var requestedBudget: Int64 = 200000
    if (args.size == 5) {
        try {
            requestedBudget = Int64.parse(args[4])
        } catch (_: Exception) {
            return 64
        }
        if (requestedBudget < 1 || requestedBudget > 200000) {
            return 64
        }
    }
    let base = getVariable("SACODE_PROVIDER_BASE_URL") ?? ""
    let model = getVariable("SACODE_PROVIDER_MODEL") ?? ""
    let key = getVariable("SACODE_PROVIDER_KEY") ?? ""
    if (base.size == 0 || model.size == 0) {
        getStdErr().writeln("goal: provider-unavailable；请配置 SACODE_PROVIDER_BASE_URL 与 SACODE_PROVIDER_MODEL")
        return 69
    }
    let lease = WriteLease("session.log")
    if (!lease.takeoverIfStale()) {
        getStdErr().writeln("goal: ${leaseFailureLabel(lease)}")
        return leaseFailureExitCode(lease)
    }
    let log = SessionLog("session.log")
    var signalId: Int64 = -1
    var computerRuntime: ?ComputerRuntime = None
    var loadedLog = false
    var cleanupCheckpoint: ?GoalCheckpoint = None
    var exitCode: Int64 = 1
    try {
        if (!log.load()) {
            throw Exception("replay-rejected")
        }
        loadedLog = true
        if (!ConsoleSignals.install()) {
            throw Exception("cancel-handler-unavailable")
        }
        let token = TurnToken()
        signalId = ConsoleSignals.attach(token)
        let goal = GoalService(log)
        let checkpoint = GoalCheckpoint(log, lease)
        let desk = ApprovalDesk(log)
        computerRuntime = ComputerRuntime.openFromEnvironment(log)
        let computerExecutor: ?ComputerToolExecutor = if (let Some(bound) <- computerRuntime) {
            Some(bound.executor)
        } else {
            None
        }
        let policy = PermissionPolicy()
        let modeCtrl = ModeController(log)
        let effectiveMode = modeCtrl.current()
        // 策略层 guard：allow 直接放行，deny 拒绝，ask 走原有 approval 回调
        let policyGuard: (String, String) -> Bool = {
            name, args =>
                let decision = policy.decide(effectiveMode, name)
                if (decision == "allow") {
                    return true
                }
                if (decision == "deny") {
                    return false
                }
                // ask 继续走原有 approval 回调
                return true
        }
        let tools = ModelToolRuntime(
            log,
            false,
            files: true,
            computer: computerExecutor,
            workingDirectory: getWorkingDirectory().toString(),
            desk: desk,
            approval: {
                call =>
                    // 精确工单只为本次调用发号；无人回答、EOF 或取消都不放行。
                    if (token.cancelled()) {
                        return Int64(-1)
                    }
                    let id = desk.askForCall(call.name, call.args)
                    if (!checkpoint.checkpoint()) {
                        token.cancel();
                        return Int64(-1)
                    }
                    getStdErr().writeln("approval\t${id}\t${call.name}\t${call.args}")
                    getStdErr().writeln("允许一次？[y/N]");
                    getStdErr().flush()
                    let answer = decideAnswer(getStdIn().readln())
                    if (!token.cancelled() && answer.size > 0) {
                        desk.answer(id, answer)
                    }
                    if (!checkpoint.checkpoint()) {
                        token.cancel();
                        return Int64(-1)
                    }
                    return id
            },
            guard: {
                name, args =>
                    // 执行类动作要求目标平台的真实隔离探测通过，不能凭模式名裸跑。
                    if (!policyGuard(name, args)) {
                        return false
                    }
                    if (token.cancelled()) {
                        return false
                    }
                    if (name == "bash" || name == "pwsh" || name == "run_code") {
                        return platformExecutionReady(getWorkingDirectory().toString())
                    }
                    return true
            },
            lspSession: "current",
            lspToken: token,
            webSettings: Some(WebSettings.forUser())
        )
        let budgetMeter = TokenMeter(log)
        budgetMeter.rebuild()
        if (args.size == 5 && requestedBudget > budgetMeter.budgetValue()) {
            throw Exception("budget-cannot-increase")
        }
        goal.create(args[2])
        if (args.size == 5 && requestedBudget < budgetMeter.budgetValue() && !budgetMeter.lowerBudget(requestedBudget)) {
            throw Exception("bad-budget")
        }
        log.append("system/message", SystemPromptBuilder(tools.registry).build())
        let targetUserSeq = log.append("user/message", args[2]).seq
        if (!checkpoint.checkpoint()) {
            throw Exception("goal-admission-checkpoint-failed")
        }
        cleanupCheckpoint = Some(checkpoint)
        let meter = GoalUsageMeter(log, Int64(200000))
        let specs = tools.specs()
        let attachments = AttachmentStore(getWorkingDirectory().join("attachments").toString(), log,
            AttachmentLimits.localBackend())
        let supportsImages = (getVariable("SACODE_PROVIDER_SUPPORTS_IMAGES") ?? "") == "1"
        let fallbackWorkspace = getWorkingDirectory().toString()
        let first: () -> Provider = {
            =>
                let prepared = cliPrepareGoalKnowledge(log, checkpoint, targetUserSeq, args[2], fallbackWorkspace, token)
                if (!prepared.ready) {
                    throw Exception("knowledge-context-admission-failed")
                }
                var request = ""
                try {
                    request = modelRequestJson(model, log.snapshotEvents().toArray(), tools: specs,
                        attachStore: attachments, supportsImages: supportsImages)
                } catch (e: Exception) {
                    if (!cliClearGoalKnowledge(log, checkpoint, "goal-request-build-failed")) {
                        throw Exception("knowledge-context-clear-failed")
                    }
                    throw Exception(e.message)
                }
                let requestForRound = request
                return DeferredProvider({=> RealSseProvider(base, key, requestForRound, token)}, token)
        }
        let next: (String) -> Provider = {request => RealSseProvider(base, key, request, token)}
        let clockBase = MonoTime.now()
        let sink = ThreadSafeDeliveryQueue(1024)
        let handle = GoalRunner().start(first, next, model, token, log, sink,
            GoalScheduler(log, {=> (MonoTime.now() - clockBase).toSeconds()}), goal, Int64(8), Int64(3600), Int64(3),
            {=> checkpoint.checkpoint()}, {=> meter.over()}, toolRuntime: Some(tools), attach: attachments,
            supportsImages: supportsImages, settleRound: {result => meter.settle(result)})
        while (handle.isRunning()) {
            for (frame in sink.take(256)) {
                println(frame)
            }
            getStdOut().flush()
            sleep(20 * Duration.millisecond)
        }
        for (frame in sink.take(1024)) {
            println(frame)
        }
        let result = handle.result()
        if (log.isDurableFrozen()) {
            throw Exception("session-durable-frozen:lease-retained")
        }
        println(cliGoalJson(goal.snapshot()))
        getStdErr().writeln("goal-result\t${result.finishReason}\tusage=${result.usage}")
        exitCode = if (result.cancelled) {
            130
        } else if (goal.snapshot().phase == "complete") {
            0
        } else {
            1
        }
    } catch (e: Exception) {
        getStdErr().writeln("goal: ${e.message}")
        exitCode = 1
    } finally {
        if (loadedLog) {
            if (let Some(checkpoint) <- cleanupCheckpoint) {
                if (!cliClearGoalKnowledge(log, checkpoint, "goal-run-finished")) {
                    getStdErr().writeln("knowledge-context-clear-failed")
                    exitCode = 1
                }
            }
        }
        if (let Some(bound) <- computerRuntime) {
            bound.close()
        }
        if (signalId >= 0) {
            ConsoleSignals.detach(signalId)
        }
        if (!log.isDurableFrozen()) {
            lease.release()
        }
    }
    return exitCode
}
