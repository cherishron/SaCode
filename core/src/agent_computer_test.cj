package core

import std.unittest.*

// 桌面工具的审批来源闸门：自报审批与未绑参数的旧工单都不放行，
// 免得「批过一次点击」被挪去放行任意一次鼠标键盘动作。

@Test
func computerInputRejectsSelfDeclaredApproval(): Unit {
    let log = makeTestLog("computer-self-approval")
    let registry = ToolRegistry()
    registry.register(ToolSpec("computer.click", "点击", "{}", true))
    let runtime = ToolRuntime(log, registry)
    let result = runtime.execute("computer.click", "{}", "allowed-once", true)
    @Expect(result.allowed, false)
    @Expect(result.why, "computer-exact-approval-required")
}

@Test
func computerInputRejectsUnboundApprovalTicket(): Unit {
    let log = makeTestLog("computer-unbound-approval")
    let registry = ToolRegistry()
    registry.register(ToolSpec("computer.click", "点击", "{}", true))
    let runtime = ToolRuntime(log, registry)
    let desk = ApprovalDesk(log)
    let ticket = desk.ask("computer.click")
    desk.answer(ticket, "allowed-once")
    let result = runtime.executeWithApproval("computer.click", "{}", ticket, true, desk)
    @Expect(result.allowed, false)
    @Expect(result.why.startsWith("approval-not-granted"), true)
    // 拒绝不烧票：人已给出的答复还得能对它真正批过的那次动作生效。
    @Expect(desk.stateOf(ticket), "allowed-once")
}
