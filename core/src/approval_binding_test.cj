package core

import std.unittest.*

@Test
func policyApprovalRequiresExactTicketForNormallyReadOnlyTool() {
    let log = SessionLog("approval-policy-exact.log")
    let registry = ToolRegistry()
    registry.register(ToolSpec("read", "read", "{}", false))
    let runtime = ToolRuntime(log, registry)
    let desk = ApprovalDesk(log)
    @Expect(runtime.executeWithApproval("read", "a", 0, false, desk, policyApproval: true).allowed, false)
    let legacy = desk.ask("read")
    @Expect(desk.answer(legacy, "allowed-once"), true)
    @Expect(runtime.executeWithApproval("read", "a", legacy, false, desk, policyApproval: true).allowed, false)
    @Expect(desk.stateOf(legacy), "allowed-once")
    let exact = desk.askForCall("read", "a", ttl: 30)
    @Expect(desk.answer(exact, "allowed-once"), true)
    @Expect(runtime.executeWithApproval("read", "b", exact, false, desk, policyApproval: true).allowed, false)
    @Expect(desk.stateOf(exact), "allowed-once")
    // guard拒绝执行，但有效工单必须已被一次性消费。
    @Expect(runtime.executeWithApproval("read", "a", exact, false, desk, policyApproval: true).allowed, false)
    @Expect(desk.stateOf(exact), "used")
}

// 精确审批不得退回只按工具名放行；错误尝试也不能烧掉正确提案的票。
@Test
func exactApprovalRejectsChangedArgumentsAndToolOnlyConsumption() {
    let log = SessionLog("approval-binding-arguments.log")
    let desk = ApprovalDesk(log)
    let id = desk.askForCall("write", "{\"path\":\"a\"}", ttl: 30)
    @Expect(desk.answer(id, "allowed-once"), true)
    @Expect(desk.argumentsMatch(id, "{\"path\":\"b\"}"), false)
    @Expect(desk.consume(id, "write"), "")
    @Expect(desk.consumeExactForCall(id, "write", "{\"path\":\"b\"}"), "")
    @Expect(desk.stateOf(id), "allowed-once")
    @Expect(desk.consumeExactForCall(id, "write", "{\"path\":\"a\"}"), "allowed-once")
    @Expect(desk.consumeExactForCall(id, "write", "{\"path\":\"a\"}"), "")
}

@Test
func exactApprovalRejectsLegacyUnboundTicket() {
    let desk = ApprovalDesk(SessionLog("approval-binding-legacy.log"))
    let id = desk.ask("execution/start")
    @Expect(desk.answer(id, "allowed-once"), true)
    @Expect(desk.consumeExactForCall(id, "execution/start", "proposal"), "")
    @Expect(desk.stateOf(id), "allowed-once")
}

class BindingApprovalClock {
    var now: Int64 = 0
}

@Test
func exactApprovalExpiresAfterApprovalBeforeConsumption() {
    let clock = BindingApprovalClock()
    let log = SessionLog("approval-binding-expiry.log")
    let desk = ApprovalDesk(log, clock: { => clock.now })
    let id = desk.askForCall("write", "proposal", ttl: 2)
    @Expect(desk.answer(id, "allowed-once"), true)
    clock.now = 2
    @Expect(desk.consumeExactForCall(id, "write", "proposal"), "")
    @Expect(desk.stateOf(id), "expired")
    var expired: Int64 = 0
    for (event in log.snapshotEvents()) {
        if (event.eventType == "approval/expired") { expired += 1 }
    }
    @Expect(expired, Int64(1))
}
