package core

import std.unittest.*
import std.fs.*

// token 计量与预算（矩阵 53 token-meter 此前是 ◐：usage 只当字符串存着，
// 既没有累加也没有预算）。三条口径先划死：
// 1) 会话日志是唯一真源——账要能从 turn/usage 事件重算出来，进程内存里的计数不算第二真源；
// 2) 超预算就不计入，也不「先记了再红字提醒」，后者等于默认放行；
// 3) 预算只能调小不能调大：能让界面自己抬高预算的防额不是防额。

func mtPath(tag: String): String {
    return "core-mt-${tag}.log"
}

func mtCleanup(tag: String) {
    removeIfExists(mtPath(tag), recursive: false)
    removeIfExists("${mtPath(tag)}.lease", recursive: false)
}

func mtEventCount(log: SessionLog, kind: String): Int64 {
    var n: Int64 = 0
    for (ev in log.snapshotEvents()) {
        if (ev.eventType == kind) {
            n += 1
        }
    }
    return n
}

@Test
func usageAddsUpAcrossTurnsAndIsLogged() {
    mtCleanup("sum")
    let log = SessionLog(mtPath("sum"))
    let m = TokenMeter(log)
    @Expect(m.record("12"), "recorded")
    @Expect(m.record("17"), "recorded")
    @Expect(m.used(), Int64(29))
    @Expect(m.over(), false)
    // 每一笔都要落事件，否则「这一轮花了多少」答不出来
    @Expect(mtEventCount(log, "turn/usage"), Int64(2))
    mtCleanup("sum")
}

// 超预算的一笔不计入，也不许留下「记了又撤销」的中间态。
@Test
func overBudgetIsRefusedAndLeavesTotalUnchanged() {
    mtCleanup("over")
    let log = SessionLog(mtPath("over"))
    let m = TokenMeter(log, budget: Int64(20))
    @Expect(m.record("17"), "recorded")
    @Expect(m.record("12"), "over-budget")
    @Expect(m.used(), Int64(17))
    @Expect(m.over(), true)
    // 拒绝也要可追问：落一条 usage/over-budget，而不是静默吞掉
    @Expect(mtEventCount(log, "usage/over-budget"), Int64(1))
    @Expect(mtEventCount(log, "turn/usage"), Int64(1))
    mtCleanup("over")
}

// 解析不出数字是上游契约违例。宁可记 0 并单独计数，也不要把它当成一笔大额消耗——
// 后者会让一条乱码把预算打满，把可诊断的格式问题变成不可诊断的拒绝。
@Test
func unparseableUsageCountsAsZeroAndIsFlagged() {
    mtCleanup("bad")
    let log = SessionLog(mtPath("bad"))
    let m = TokenMeter(log, budget: Int64(50))
    @Expect(m.record("twelve"), "bad-usage")
    @Expect(m.record(""), "bad-usage")
    @Expect(m.record("-5"), "bad-usage")
    @Expect(m.used(), Int64(0))
    @Expect(m.badCount, Int64(3))
    // 一条都不许进 turn/usage：那不是消耗，是格式问题
    @Expect(mtEventCount(log, "turn/usage"), Int64(0))
    @Expect(mtEventCount(log, "usage/bad-usage"), Int64(3))
    mtCleanup("bad")
}

// 预算的方向性：调小是收紧（允许），调大是放宽（拒绝），负数也是拒绝。
@Test
func budgetOnlyGoesDown() {
    mtCleanup("budget")
    let log = SessionLog(mtPath("budget"))
    let m = TokenMeter(log, budget: Int64(100))
    @Expect(m.lowerBudget(Int64(30)), true)
    @Expect(m.used(), Int64(0))
    @Expect(m.record("40"), "over-budget")
    @Expect(m.lowerBudget(Int64(999)), false)
    @Expect(m.lowerBudget(Int64(-1)), false)
    // 调大被拒之后预算仍停在收紧后的那档
    @Expect(m.record("31"), "over-budget")
    @Expect(m.used(), Int64(0))
    mtCleanup("budget")
}

// 关键的一条：账要能从日志重算。flush 之后换一个新实例 load 再 rebuild，
// 总量与超预算判决都必须一致——否则内存计数就是第二真源，崩溃重启会「失忆」。
@Test
func totalIsRebuiltFromSessionLog() {
    mtCleanup("rebuild")
    let p = mtPath("rebuild")
    let log = SessionLog(p)
    let m = TokenMeter(log, budget: Int64(50))
    @Expect(m.record("20"), "recorded")
    @Expect(m.record("25"), "recorded")
    @Expect(m.record("10"), "over-budget")
    log.flush()
    let fresh = SessionLog(p)
    @Expect(fresh.load(), true)
    let m2 = TokenMeter(fresh, budget: Int64(50))
    @Expect(m2.rebuild(), Int64(45))
    @Expect(m2.used(), Int64(45))
    @Expect(m2.over(), true)
    // 重算出来的账继续拦得住下一笔
    @Expect(m2.record("6"), "over-budget")
    @Expect(m2.used(), Int64(45))
    mtCleanup("rebuild")
}

// 预算档位不能只活在内存里：换个进程重新起来若把它洗回默认宽档，
// 「只能收紧」就留下一条重启即可绕过的放宽后门。
@Test
func tightenedBudgetSurvivesProcessRestart() {
    mtCleanup("budget-restart")
    let p = mtPath("budget-restart")
    let log = SessionLog(p)
    let m = TokenMeter(log, budget: Int64(100))
    @Expect(m.lowerBudget(Int64(30)), true)
    @Expect(log.flush(), true)
    let fresh = SessionLog(p)
    @Expect(fresh.load(), true)
    // 新实例默认按宽档起来，rebuild 必须把它拉回日志上那一档
    let m2 = TokenMeter(fresh, budget: Int64(100))
    @Expect(m2.budgetValue(), Int64(100))
    m2.rebuild()
    @Expect(m2.budgetValue(), Int64(30))
    @Expect(m2.record("40"), "over-budget")
    // 再收紧一次并落盘：第三进程重算拿到的应是最紧的那档，不是第一条
    @Expect(m2.lowerBudget(Int64(10)), true)
    @Expect(fresh.flush(), true)
    let fresh2 = SessionLog(p)
    @Expect(fresh2.load(), true)
    let m3 = TokenMeter(fresh2, budget: Int64(100))
    m3.rebuild()
    @Expect(m3.budgetValue(), Int64(10))
    @Expect(m3.record("11"), "over-budget")
    @Expect(m3.record("9"), "recorded")
    mtCleanup("budget-restart")
}
