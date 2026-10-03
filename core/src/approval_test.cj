package core

import std.unittest.*
import std.fs.*

// 审批的协议面。§6.1.2 补证清单第 2 条：此前审批只是调用方随手带的一个字符串，
// 日志里只有 tool/result denied:*，全仓没有任何 approval/* 事件——「谁批的、批了没有、
// 批过头没有」都无从追问。这几条用例把审批钉成一次显式往返：发号 → 应答 → 一次性消费。
//
// 时钟是逻辑的（tick/advance），不是墙钟：过期行为必须可被测出来，而不是靠 sleep 赌时序。
// 接真实单调时钟是后续项，接法只是把 ttl 换成 deadline。

func apPath(tag: String): String {
    return "core-ap-${tag}.log"
}

func apEvents(log: SessionLog, kind: String): Int64 {
    var n: Int64 = 0
    for (ev in log.snapshotEvents()) {
        if (ev.eventType == kind) {
            n += 1
        }
    }
    return n
}

@Test
func askRegistersPendingAndWritesAskedEvent() {
    let p = apPath("ask")
    removeIfExists(p, recursive: false)
    let log = SessionLog(p)
    let desk = ApprovalDesk(log)
    let id = desk.ask("write")
    @Expect(id > Int64(0), true)
    @Expect(desk.stateOf(id), "pending")
    @Expect(desk.pendingCount(), Int64(1))
    @Expect(apEvents(log, "approval/asked"), Int64(1))
    removeIfExists(p, recursive: false)
}

@Test
func allowedOnceIsSingleUse() {
    let p = apPath("once")
    removeIfExists(p, recursive: false)
    let log = SessionLog(p)
    let desk = ApprovalDesk(log)
    let id = desk.ask("write")
    @Expect(desk.answer(id, "allowed-once"), true)
    @Expect(desk.stateOf(id), "allowed-once")
    @Expect(desk.consume(id), "allowed-once")
    // 用第二次必须拿不到放行：一次性就是字面意思的一次
    @Expect(desk.consume(id), "")
    @Expect(apEvents(log, "approval/decided"), Int64(1))
    removeIfExists(p, recursive: false)
}

// 方案验收表原文：「旧审批 ID 不可重用」。重复应答不得改判、也不得静默成功。
@Test
func secondAnswerOnSameIdIsRefused() {
    let p = apPath("reuse")
    removeIfExists(p, recursive: false)
    let log = SessionLog(p)
    let desk = ApprovalDesk(log)
    let id = desk.ask("write")
    @Expect(desk.answer(id, "allowed-once"), true)
    @Expect(desk.answer(id, "denied"), false)
    @Expect(desk.stateOf(id), "allowed-once")
    @Expect(apEvents(log, "approval/decided"), Int64(1))
    removeIfExists(p, recursive: false)
}

@Test
func answerUnknownIdFailsAndIllegalDecisionIsRefused() {
    let p = apPath("unknown")
    removeIfExists(p, recursive: false)
    let log = SessionLog(p)
    let desk = ApprovalDesk(log)
    @Expect(desk.answer(Int64(4242), "allowed-once"), false)
    @Expect(desk.consume(Int64(4242)), "")
    // fail-closed：非 allowed-once 的「放行」都不算放行（没有永久授权这条路径）
    let id = desk.ask("write")
    @Expect(desk.answer(id, "allowed-always"), false)
    @Expect(desk.stateOf(id), "pending")
    @Expect(desk.consume(id), "")
    removeIfExists(p, recursive: false)
}

// 工单与执行面的衔接：调用方自己声明「批过了」不作数，只有 desk 发过号且未被消费过的
// allowed-once 工单能放行，且只放行一次。
@Test
func approvalTicketGrantsExactlyOneExecution() {
    let p = apPath("grant")
    removeIfExists(p, recursive: false)
    let log = SessionLog(p)
    let reg = ToolRegistry()
    reg.register(ToolSpec("write", "写文件", "path", true))
    let rt = ToolRuntime(log, reg)
    let desk = ApprovalDesk(log)
    let id = desk.ask("write")
    @Expect(desk.answer(id, "allowed-once"), true)
    let first = rt.executeWithApproval("write", "a.txt", id, true, desk)
    @Expect(first.allowed, true)
    let second = rt.executeWithApproval("write", "a.txt", id, true, desk)
    @Expect(second.allowed, false)
    @Expect(second.why, "approval-not-granted:used")
    removeIfExists(p, recursive: false)
}

@Test
func expiredTicketCannotGrantExecution() {
    let p = apPath("expired-run")
    removeIfExists(p, recursive: false)
    let log = SessionLog(p)
    let reg = ToolRegistry()
    reg.register(ToolSpec("write", "写文件", "path", true))
    let rt = ToolRuntime(log, reg)
    let desk = ApprovalDesk(log)
    let id = desk.askWithTtl("write", Int64(2))
    desk.advance(Int64(2))
    @Expect(desk.stateOf(id), "expired")
    let r = rt.executeWithApproval("write", "a.txt", id, true, desk)
    @Expect(r.allowed, false)
    @Expect(r.why, "approval-not-granted:expired")
    removeIfExists(p, recursive: false)
}

// 未登记的工具即使握着合法工单也不放行：注册表检查在审批之前，顺序不许换
@Test
func unregisteredToolIsRefusedEvenWithValidTicket() {
    let p = apPath("unreg-run")
    removeIfExists(p, recursive: false)
    let log = SessionLog(p)
    let reg = ToolRegistry()
    reg.register(ToolSpec("write", "写文件", "path", true))
    let rt = ToolRuntime(log, reg)
    let desk = ApprovalDesk(log)
    let id = desk.ask("write")
    desk.answer(id, "allowed-once")
    let missesBefore = rt.registryMisses
    let r = rt.executeWithApproval("rm -rf", "x", id, true, desk)
    @Expect(r.allowed, false)
    @Expect(r.why, "unregistered-tool:rm -rf")
    @Expect(rt.registryMisses, missesBefore + Int64(1))
    removeIfExists(p, recursive: false)
}

@Test
func pendingApprovalExpiresAndIsSettledOnce() {
    let p = apPath("expire")
    removeIfExists(p, recursive: false)
    let log = SessionLog(p)
    let desk = ApprovalDesk(log)
    let ttl: Int64 = 3
    let shortId = desk.askWithTtl("write", ttl)
    let longId = desk.askWithTtl("write", Int64(50))
    @Expect(desk.pendingCount(), Int64(2))
    desk.advance(ttl)
    @Expect(desk.stateOf(shortId), "expired")
    @Expect(desk.stateOf(longId), "pending")
    @Expect(desk.consume(shortId), "")
    @Expect(desk.pendingCount(), Int64(1))
    @Expect(apEvents(log, "approval/expired"), Int64(1))
    // 再推进到长工单也过期：expired 事件必须变成 2（长的那条），而不是 3——
    // 短工单已被结算过，不得重复落账
    desk.advance(Int64(60))
    @Expect(apEvents(log, "approval/expired"), Int64(2))
    @Expect(desk.stateOf(shortId), "expired")
    @Expect(desk.pendingCount(), Int64(0))
    removeIfExists(p, recursive: false)
}
