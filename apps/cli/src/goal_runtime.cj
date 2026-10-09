package cli
import core.*
import std.env.*
import std.time.*
import std.convert.*

// 用户入口与旧 goal 无参数自测分开；读取恢复投影不会创建运行线程。
func cliGoalJson(goal: GoalSnapshot): String {
    return "{\"id\":\"${jsonEscapeText(goal.id)}\",\"revision\":${goal.revision},\"phase\":\"${jsonEscapeText(goal.phase)}\",\"objective\":\"${jsonEscapeText(goal.objective)}\",\"blockedReason\":\"${jsonEscapeText(goal.blockedReason)}\"}"
}

func runGoalCommand(args: Array<String>): Int64 {
    if (args.size == 2 && args[1] == "describe") {
        try {
            let log = SessionLog("session.log")
            if (!log.load()) { throw Exception("replay-rejected") }
            println(cliGoalJson(GoalService(log).snapshot()))
            return 0
        } catch (e: Exception) { getStdErr().writeln("goal: ${e.message}"); return 1 }
    }
    if ((args.size != 3 && args.size != 5) || args[1] != "run" || (args.size == 5 && args[3] != "--budget")) {
        getStdErr().writeln("usage: sacode goal run <objective> [--budget <tokens>] | goal describe")
        return 64
    }
    var requestedBudget: Int64 = 200000
    if (args.size == 5) {
        try { requestedBudget = Int64.parse(args[4]) } catch (_: Exception) { return 64 }
        if (requestedBudget < 1 || requestedBudget > 200000) { return 64 }
    }
    let base = getVariable("SACODE_PROVIDER_BASE_URL") ?? ""
    let model = getVariable("SACODE_PROVIDER_MODEL") ?? ""
    let key = getVariable("SACODE_PROVIDER_KEY") ?? ""
    if (base.size == 0 || model.size == 0) {
        getStdErr().writeln("goal: provider-unavailable；请配置 SACODE_PROVIDER_BASE_URL 与 SACODE_PROVIDER_MODEL")
        return 69
    }
    let lease = WriteLease("session.log")
    if (!lease.takeoverIfStale()) { getStdErr().writeln("goal: already-owned"); return 5 }
    let log = SessionLog("session.log")
    var signalId: Int64 = -1
    var computerRuntime: ?ComputerRuntime = None
    try {
        if (!log.load()) { throw Exception("replay-rejected") }
        if (!ConsoleSignals.install()) { throw Exception("cancel-handler-unavailable") }
        let token = TurnToken()
        signalId = ConsoleSignals.attach(token)
        let goal = GoalService(log)
        let checkpoint = GoalCheckpoint(log, lease)
        let desk = ApprovalDesk(log)
        computerRuntime = ComputerRuntime.openFromEnvironment(log)
        let computerExecutor: ?ComputerToolExecutor = if (let Some(bound) <- computerRuntime) { Some(bound.executor) } else { None }
        let policy = PermissionPolicy()
        let modeCtrl = ModeController(log)
        let effectiveMode = modeCtrl.current()
        // 策略层 guard：allow 直接放行，deny 拒绝，ask 走原有 approval 回调
        let policyGuard: (String, String) -> Bool = { name, args =>
            let decision = policy.decide(effectiveMode, name)
            if (decision == "allow") { return true }
            if (decision == "deny") { return false }
            // ask 继续走原有 approval 回调
            return true
        }
        let tools = ModelToolRuntime(log, false, files: true, computer: computerExecutor,
            workingDirectory: getWorkingDirectory().toString(), desk: desk,
            approval: { call =>
                // 精确工单只为本次调用发号；无人回答、EOF 或取消都不放行。
                if (token.cancelled()) { return Int64(-1) }
                let id = desk.askForCall(call.name, call.args)
                if (!checkpoint.checkpoint()) { token.cancel(); return Int64(-1) }
                getStdErr().writeln("approval\t${id}\t${call.name}\t${call.args}")
                getStdErr().writeln("允许一次？[y/N]"); getStdErr().flush()
                let answer = decideAnswer(getStdIn().readln())
                if (!token.cancelled() && answer.size > 0) { desk.answer(id, answer) }
                if (!checkpoint.checkpoint()) { token.cancel(); return Int64(-1) }
                return id
            }, guard: { name, args =>
                // 监督及沙箱准入尚未收口，不能从模型的旧 Shell 工具绕过门禁。
                if (!policyGuard(name, args)) { return false }
                return !token.cancelled() && name != "bash" && name != "pwsh" && name != "run_code"
            }, lspSession: "current", lspToken: token)
        let budgetMeter = TokenMeter(log)
        budgetMeter.rebuild()
        if (args.size == 5 && requestedBudget > budgetMeter.budgetValue()) { throw Exception("budget-cannot-increase") }
        goal.create(args[2])
        if (args.size == 5 && requestedBudget < budgetMeter.budgetValue() && !budgetMeter.lowerBudget(requestedBudget)) { throw Exception("bad-budget") }
        log.append("system/message", SystemPromptBuilder(tools.registry).build())
        log.append("user/message", args[2])
        if (!checkpoint.checkpoint()) { throw Exception("goal-admission-checkpoint-failed") }
        let meter = GoalUsageMeter(log, Int64(200000))
        let specs = tools.specs()
        let attachments = AttachmentStore(getWorkingDirectory().join("attachments").toString(), log, AttachmentLimits.localBackend())
        let supportsImages = (getVariable("SACODE_PROVIDER_SUPPORTS_IMAGES") ?? "") == "1"
        let first: () -> Provider = { => DeferredProvider({ =>
            RealSseProvider(base, key, modelRequestJson(model, log.snapshotEvents().toArray(), tools: specs, attachStore: attachments, supportsImages: supportsImages), token)
        }, token) }
        let next: (String) -> Provider = { request => RealSseProvider(base, key, request, token) }
        let clockBase = MonoTime.now()
        let sink = ThreadSafeDeliveryQueue(1024)
        let handle = GoalRunner().start(first, next, model, token, log, sink,
            GoalScheduler(log, { => (MonoTime.now() - clockBase).toSeconds() }), goal,
            Int64(8), Int64(3600), Int64(3), { => checkpoint.checkpoint() }, { => meter.over() },
            toolRuntime: Some(tools), attach: attachments, supportsImages: supportsImages,
            settleRound: { result => meter.settle(result) })
        while (handle.isRunning()) {
            for (frame in sink.take(256)) { println(frame) }
            getStdOut().flush()
            sleep(20 * Duration.millisecond)
        }
        for (frame in sink.take(1024)) { println(frame) }
        let result = handle.result()
        if (log.isDurableFrozen()) { throw Exception("session-durable-frozen:lease-retained") }
        println(cliGoalJson(goal.snapshot()))
        getStdErr().writeln("goal-result\t${result.finishReason}\tusage=${result.usage}")
        if (result.cancelled) { return 130 }
        return if (goal.snapshot().phase == "complete") { 0 } else { 1 }
    } catch (e: Exception) {
        getStdErr().writeln("goal: ${e.message}")
        return 1
    } finally {
        if (let Some(bound) <- computerRuntime) { bound.close() }
        if (signalId >= 0) { ConsoleSignals.detach(signalId) }
        if (!log.isDurableFrozen()) { lease.release() }
    }
}
