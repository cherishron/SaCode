package core
import std.unittest.*

class ModeIntegrationCounters {
    var asks: Int64 = 0
    var ticket: Int64 = 0
}

@Test
func modelYoloDoesNotRemoveExistingWriteApprovalRequirement() {
    let log = SessionLog("mode-yolo-write.log")
    log.append("mode/mode", "yolo")
    let counters = ModeIntegrationCounters()
    let runtime = ModelToolRuntime(log, false, files: true, approval: { _ => counters.asks += 1; Int64(0) })
    @Expect(runtime.execute(modeIntegrationCall("write", "{}")).allowed, false)
    @Expect(counters.asks, 1)
}

@Test
func modelModeCancellationAfterApprovalDoesNotConsumeTicket() {
    let log = SessionLog("mode-cancel-approval.log")
    log.append("mode/mode", "auto")
    let token = TurnToken()
    let desk = ApprovalDesk(log)
    let counters = ModeIntegrationCounters()
    let runtime = ModelToolRuntime(log, false, desk: desk, lspToken: token, approval: { call =>
        counters.ticket = desk.askForCall(call.name, call.args, ttl: 30)
        desk.answer(counters.ticket, "allowed-once")
        token.cancel()
        counters.ticket
    })
    runtime.registry.register(ToolSpec("plugin/custom", "unknown", "{}", false))
    let outcome = runtime.execute(modeIntegrationCall("plugin/custom", "{}"))
    @Expect(outcome.allowed, false)
    @Expect(outcome.why, "cancelled")
    @Expect(desk.stateOf(counters.ticket), "allowed-once")
}

@Test
func securityPlanFlagAloneRejectsSideEffectsBeforeApproval() {
    for (laterMode in ["", "yolo"]) {
        let log = SessionLog("security-plan-flag.log")
        log.append("plan/mode", "true")
        if (laterMode.size > 0) { log.append("mode/mode", laterMode) }
        let counters = ModeIntegrationCounters()
        let runtime = ModelToolRuntime(log, false, files: true, approval: { _ => counters.asks += 1; Int64(0) })
        for (name in ["write", "edit", "bash", "pwsh", "run_code"]) {
            let result = runtime.execute(modeIntegrationCall(name, "{}"))
            @Expect(result.allowed, false)
            @Expect(result.why, "approval-mode-denied")
        }
        @Expect(counters.asks, 0)
    }
}

@Test
func securityPlanFlagAllowsReadOnlyToolsAndNoModeKeepsLegacyPolicy() {
    let log = SessionLog("security-plan-read.log")
    log.append("plan/mode", "true")
    let counters = ModeIntegrationCounters()
    let runtime = ModelToolRuntime(log, false, files: true, approval: { _ => counters.asks += 1; Int64(0) })
    let result = runtime.execute(modeIntegrationCall("read", "{}"))
    @Expect(result.why == "approval-mode-denied", false)
    @Expect(counters.asks, 0)
    let legacy = ModelToolRuntime(SessionLog("security-no-mode.log"), false,
        approval: { _ => counters.asks += 1; Int64(0) })
    legacy.registry.register(ToolSpec("plugin/custom", "unknown", "{}", false))
    legacy.execute(modeIntegrationCall("plugin/custom", "{}"))
    @Expect(counters.asks, 0)
}

func modeIntegrationCall(name: String, args: String): ModelToolCall {
    let call = ModelToolCall(0)
    call.id = "mode-call"; call.name = name; call.args = args
    return call
}

@Test
func modelPlanModeRejectsWriteBeforeRequestingApproval() {
    let log = SessionLog("mode-plan-integration.log")
    log.append("mode/mode", "plan")
    let counters = ModeIntegrationCounters()
    let runtime = ModelToolRuntime(log, false, files: true, approval: { _ => counters.asks += 1; Int64(0) })
    let outcome = runtime.execute(modeIntegrationCall("write", "{}"))
    @Expect(outcome.allowed, false)
    @Expect(outcome.why, "approval-mode-denied")
    @Expect(counters.asks, 0)
}

@Test
func modelModeUnknownContributionRequiresExactApprovalEvenWithReadOnlySpec() {
    let log = SessionLog("mode-auto-integration.log")
    log.append("mode/mode", "auto")
    let desk = ApprovalDesk(log)
    let counters = ModeIntegrationCounters()
    let runtime = ModelToolRuntime(log, false, desk: desk, guard: { _, _ => false }, approval: { call =>
        counters.asks += 1
        counters.ticket = desk.askForCall(call.name, call.args, ttl: 30)
        desk.answer(counters.ticket, "allowed-once")
        counters.ticket
    })
    runtime.registry.register(ToolSpec("plugin/custom", "unknown contribution", "{}", false))
    @Expect(runtime.execute(modeIntegrationCall("plugin/custom", "{}")).allowed, false)
    @Expect(counters.asks, 1)
    @Expect(desk.stateOf(counters.ticket), "used")
}
