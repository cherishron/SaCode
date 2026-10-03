package core

import std.unittest.*
import std.collection.ArrayList
import std.fs.*

// 审批的协议面。§6.1.2 补证清单第 2 条：此前审批只是调用方随手带的一个字符串，
// 日志里只有 tool/result denied:*，全仓没有任何 approval/* 事件——「谁批的、批了没有、
// 批过头没有」都无从追问。这几条用例把审批钉成一次显式往返：发号 → 应答 → 一次性消费。
//
// 时钟是真实单调钟（MonoTime），不是可由调用方推进的逻辑刻度：过期要么由时间决定，
// 要么就不算过期。用例分两类——注入假钟做确定性推进（证明过期判定本身正确），
// 以及不注入任何钟、用真实时间跨过 deadline（证明生产默认接线真的接在单调钟上）。

// 假钟：仓颉不允许把「捕获可变局部变量」的 lambda 当函数值传出去
// （lambda capturing mutable variables needs to be called directly），
// 所以可推进的时钟必须装在一个不可变引用里，推进只改它内部的字段。
class ApprovalTick {
    var now: Int64 = 0
}

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
    let first = rt.executeWithApproval("write", "a.txt x", id, true, desk)
    @Expect(first.allowed, true)
    let second = rt.executeWithApproval("write", "a.txt x", id, true, desk)
    @Expect(second.allowed, false)
    @Expect(second.why, "approval-not-granted:used")
    removeIfExists("a.txt", recursive: false)
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
    let fake = ApprovalTick()
    let desk = ApprovalDesk(log, clock: { => fake.now })
    let id = desk.askWithTtl("write", Int64(2))
    fake.now = 2
    @Expect(desk.stateOf(id), "expired")
    let r = rt.executeWithApproval("write", "a.txt x", id, true, desk)
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
    let ttl: Int64 = 3
    let fake = ApprovalTick()
    let desk = ApprovalDesk(log, clock: { => fake.now })
    let shortId = desk.askWithTtl("write", ttl)
    let longId = desk.askWithTtl("write", Int64(50))
    @Expect(desk.pendingCount(), Int64(2))
    fake.now = ttl
    @Expect(desk.stateOf(shortId), "expired")
    @Expect(desk.stateOf(longId), "pending")
    @Expect(desk.consume(shortId), "")
    @Expect(desk.pendingCount(), Int64(1))
    @Expect(apEvents(log, "approval/expired"), Int64(1))
    // 再把钟推到长工单也过期：expired 事件必须变成 2（长的那条），而不是 3——
    // 短工单已被结算过，不得重复落账
    fake.now = ttl + 60
    // 过期是「碰到桌面时」结算的：光挪钟不扫描，所以先真碰一次再数账
    @Expect(desk.pendingCount(), Int64(0))
    @Expect(apEvents(log, "approval/expired"), Int64(2))
    @Expect(desk.stateOf(shortId), "expired")
    removeIfExists(p, recursive: false)
}

// 工单号要从日志里已出现过的最大号往后发，不能从 1 重来。
// 起因是实测到的证据：CLI 每次 `dsh call` 都是一个新进程，日志里连着出现两条
// `approval/asked 1:write`——号只在进程内唯一时，审计答不出「是哪一次批的」，
// 「旧审批 ID 不可重用」这条也就只在单进程内成立。
// 测试侧自己剥 `approval/asked` 数据里的号（只取冒号前的连续数字），
// 这样这几条用例在实现落地前就能编译、并以断言级失败报红，而不是撞在符号未声明上。
func askedIdOf(data: String): Int64 {
    var n: Int64 = -1
    for (c in data.toArray()) {
        let d = Int64(c) - 48
        if (d < 0 || d > 9) {
            break
        }
        n = if (n < 0) { d } else { n * 10 + d }
    }
    return n
}

func apDupAskedIds(log: SessionLog): Int64 {
    let seen = ArrayList<Int64>()
    var dups: Int64 = 0
    for (ev in log.snapshotEvents()) {
        if (ev.eventType == "approval/asked") {
            let v = askedIdOf(ev.data)
            var hit = false
            for (x in seen) {
                if (x == v) {
                    hit = true
                }
            }
            if (hit) {
                dups += 1
            } else {
                seen.add(v)
            }
        }
    }
    return dups
}

// 跨进程（真实重启）：第二个 desk 从盘上回放后必须往后接号，
// 并且上一进程留下的号在它这里既不能应答也不能消费——不能隔空改判别人那一次。
@Test
func ticketIdsContinueAcrossProcesses() {
    let p = apPath("cross-process")
    removeIfExists(p, recursive: false)
    let log = SessionLog(p)
    let first = ApprovalDesk(log)
    let a = first.ask("write")
    let b = first.ask("write")
    @Expect(a, Int64(1))
    @Expect(b, Int64(2))
    @Expect(log.flush(), true)
    let reloaded = SessionLog(p)
    @Expect(reloaded.load(), true)
    let second = ApprovalDesk(reloaded)
    @Expect(second.ask("write"), Int64(3))
    @Expect(apEvents(reloaded, "approval/asked"), Int64(3))
    @Expect(apDupAskedIds(reloaded), Int64(0))
    @Expect(second.answer(a, "allowed-once"), false)
    @Expect(second.consume(a), "")
    @Expect(second.consume(b), "")
    @Expect(apEvents(reloaded, "approval/decided"), Int64(0))
    removeIfExists(p, recursive: false)
}

// 同一份日志上换一个新 desk（进程内的「重开一张桌子」）也不得重号：
// 发号读的是日志，不只是这个对象自己的计数器。
@Test
func secondDeskOnSameLogDoesNotReuseIds() {
    let p = apPath("same-log")
    removeIfExists(p, recursive: false)
    let log = SessionLog(p)
    let first = ApprovalDesk(log)
    let a = first.ask("write")
    let second = ApprovalDesk(log)
    let b = second.ask("write")
    @Expect(b > a, true)
    @Expect(apDupAskedIds(log), Int64(0))
    // 第一张桌子发的号仍归第一个 desk 结算，第二个 desk 不能替它改判
    @Expect(second.answer(a, "allowed-once"), false)
    @Expect(first.answer(a, "allowed-once"), true)
    removeIfExists(p, recursive: false)
}

// 这条测的是「生产默认接线」：不注入任何假钟，只等真实单调时间跨过 deadline。
// 假钟用例证明过期判定本身正确，但证明不了 ApprovalDesk(log) 真的接上了钟——
// 若默认钟被冻成常量，只有这条会红。
@Test
func defaultDeskClockExpiresOnRealMonotonicTime() {
    let p = apPath("real-clock")
    removeIfExists(p, recursive: false)
    let log = SessionLog(p)
    let reg = ToolRegistry()
    reg.register(ToolSpec("write", "写文件", "path", true))
    let rt = ToolRuntime(log, reg)
    let desk = ApprovalDesk(log)
    let id = desk.askWithTtl("write", Int64(1))
    @Expect(desk.stateOf(id), "pending")
    sleep(Duration.second)
    // 有界轮询，不再往上加定值 sleep：等的只是真实时钟跨过那一秒
    var tries: Int64 = 0
    while (desk.stateOf(id) == "pending" && tries < Int64(6)) {
        sleep(Duration.millisecond * 100)
        tries += 1
    }
    @Expect(desk.stateOf(id), "expired")
    let r = rt.executeWithApproval("write", "ap-real.txt x", id, true, desk)
    @Expect(r.allowed, false)
    @Expect(r.why, "approval-not-granted:expired")
    removeIfExists(p, recursive: false)
    removeIfExists("ap-real.txt", recursive: false)
}
