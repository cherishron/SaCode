package core

import std.collection.ArrayList
import std.env.*
import std.fs.*
import std.sync.*
import std.unittest.*

// B3-1 账本核心的指名用例：定点金额（断言 16）、缺 usage 记 unknown 不记零（14）、
// 改价不重算历史（15）、并发预留不破上限与结算幂等（13）、未登记维度落待核算（76）、
// 临界区不跨网络且 release 成对（51）、作用域键不含机器/网络标识（64）、
// 未结算派发进待核算（82 的 B3 半）。
//
// 文件名纪律（本项目实测）：仓颉单测默认并行执行，同一文件里多个用例共用同一个固定
// 文件名时，一个用例的清理会删掉另一个用例正在用的文件。所以每条用例用自己独立的
// 文件名（tag 各不相同），清理也只清自己那一份。
//
// 语料全部由用例自己造：不读用户目录、不联网、不依赖时钟；时间一律由调用方注入。

func lgPath(tag: String): String {
    return "core-test-ledger-${tag}.log"
}

func lgClean(tag: String): Unit {
    for (f in [lgPath(tag), "${lgPath(tag)}.lease"]) {
        if (exists(f)) {
            try {
                removeIfExists(f, recursive: false)
            } catch (e: Exception) {
            }
        }
    }
}

// 子串出现次数：只用字节比较，不依赖字符串检索的重载形态
func lgCount(text: String, needle: String): Int64 {
    let t = text.toArray()
    let n = needle.toArray()
    if (n.size == 0) {
        return 0
    }
    var count: Int64 = 0
    var i: Int64 = 0
    while (i + Int64(n.size) <= Int64(t.size)) {
        var same = true
        var k: Int64 = 0
        while (k < Int64(n.size)) {
            if (t[i + k] != n[k]) {
                same = false
                break
            }
            k += 1
        }
        if (same) {
            count += 1
            i += Int64(n.size)
        } else {
            i += 1
        }
    }
    return count
}

// from 之后最近的 to 之前的一段（两个标记本身不在结果里）
func lgSlice(text: String, from: String, to: String): String {
    let a = text.indexOf(from) ?? Int64(-1)
    if (a < 0) {
        return ""
    }
    let tail = text[(a + Int64(from.size))..text.size]
    let b = tail.indexOf(to) ?? Int64(-1)
    if (b < 0) {
        return ""
    }
    return tail[0..b]
}

// 账本源码：形态断言的对象。读不到就让断言红——形态断言不能静默跳过。
// 测试进程的工作目录通常是 core/，两处都试是为了不把「路径猜错」当成通过。
func lgSource(): String {
    for (p in ["src/ledger.cj", "core/src/ledger.cj"]) {
        if (exists(p)) {
            return String.fromUtf8(File.readFrom(p))
        }
    }
    return ""
}

// 每个租约临界区：takeoverIfStale() 到其后最近的 lease.release()（**含** release 本身，
// 这样才能查「先 finally 后 release」这条顺序）
func lgLeaseRegions(text: String): ArrayList<String> {
    let out = ArrayList<String>()
    let release = "lease.release()"
    var rest = text
    while (true) {
        let a = rest.indexOf("takeoverIfStale()") ?? Int64(-1)
        if (a < 0) {
            break
        }
        let tail = rest[a..rest.size]
        let b = tail.indexOf(release) ?? Int64(-1)
        if (b < 0) {
            break
        }
        out.add(tail[0..(b + Int64(release.size))])
        rest = tail[(b + Int64(release.size))..tail.size]
    }
    return out
}

// 网络/远端调用的字面标记：账本里一个都不许出现（断言 51 的检法，断言 64 同族）
let lgNetworkMarkers = [
    "RealSseProvider", "HttpRequestBuilder", "Socket", "Client(", ".send(",
    "std.net", "http://", "https://", "probe(", "connect("
]

// 断言 13（前半）：并发两笔预留不突破上限——判据是「已用 + 在途预留」。
// 上限 1_000_000 微元，两笔各 700_000：只容得下一笔，且失败方必须**被上限拒绝**
// （code=budget-exceeded），不是被租约互斥挡掉——后者会让这条用例在「没有原子预留」
// 的实现上假绿，因为「一笔被别的原因挡掉」恰好也满足「没突破上限」。
@Test
func concurrentReservationsCannotBreakTheCeiling() {
    let tag = "concurrent"
    lgClean(tag)
    let path = lgPath(tag)
    let a = UsageLedger(path)
    let b = UsageLedger(path)
    let i1 = ReserveIntent("at-c1", 700000, "CNY")
    let i2 = ReserveIntent("at-c2", 700000, "CNY")
    // 栅栏：两笔必须同一时刻冲进去，否则测不到 read→decide→write 之间的竞争
    let gate = SyncCounter(2)
    let f1 = spawn { =>
        gate.dec()
        gate.waitUntilZero()
        a.reserve(i1, 1000000)
    }
    let f2 = spawn { =>
        gate.dec()
        gate.waitUntilZero()
        b.reserve(i2, 1000000)
    }
    let r1 = f1.get()
    let r2 = f2.get()
    var accepted: Int64 = 0
    var overBudget: Int64 = 0
    for (r in [r1, r2]) {
        if (r.accepted) { accepted += 1 }
        if (r.code == "budget-exceeded") { overBudget += 1 }
    }
    @Expect(accepted, Int64(1))
    @Expect(overBudget, Int64(1))
    let st = UsageLedger(path).state()
    @Expect(st.localUsed("CNY"), Int64(0))
    @Expect(st.localInFlight("CNY"), Int64(700000))
    // 实际用量小于预留：结算后释放剩余预留，只记真实金额
    let winner = if (r1.accepted) { "at-c1" } else { "at-c2" }
    let out = UsageLedger(path).settle(AttemptAccounting(winner,
        LedgerUsage(2, 1, 0, 0, "vendor"), RateCard(100000, 100000, -1, -1, "CNY", "pv1")))
    @Expect(out.status, "settled")
    @Expect(out.amountMicros, Int64(300000))
    let after = UsageLedger(path).state()
    @Expect(after.localInFlight("CNY"), Int64(0))
    @Expect(after.localUsed("CNY"), Int64(300000))
    lgClean(tag)
}

// 预算挂在**模型**上：两个模型同币种时，账户总量不得算进另一个模型的预算。
// 症状是「我刚建的新模型立刻预算耗尽」——它的预算被同账号里别的模型消费顶掉了。
@Test
func perModelBudgetDoesNotCountOtherModelsSpending() {
    let tag = "permmodel"
    lgClean(tag)
    let path = lgPath(tag)
    // 模型 B 先花 900000（同币种 CNY），自己上限很宽
    let b = UsageLedger(path).reserve(ReserveIntent("at-b1", 900000, "CNY",
        customModelId: "cm-b"), 10000000)
    @Expect(b.accepted, true)
    @Expect(UsageLedger(path).state().localInFlight("CNY"), Int64(900000))
    // 模型 A 预算 1000000：A 自己一分钱没花，950000 必须容得下
    let a1 = UsageLedger(path).reserve(ReserveIntent("at-a1", 950000, "CNY",
        customModelId: "cm-a"), 1000000)
    @Expect(a1.accepted, true)
    @Expect(a1.usedMicros, Int64(0))
    @Expect(a1.inFlightMicros, Int64(950000))
    // A 再来一笔 950000：950000 + 950000 > 1000000，必须被 A 自己的预算挡住
    let a2 = UsageLedger(path).reserve(ReserveIntent("at-a2", 950000, "CNY",
        customModelId: "cm-a"), 1000000)
    @Expect(a2.accepted, false)
    @Expect(a2.code, "budget-exceeded")
    // B 再来一笔照样放行：账户总量 1850000 没超 B 的上限
    let b2 = UsageLedger(path).reserve(ReserveIntent("at-b2", 950000, "CNY",
        customModelId: "cm-b"), 10000000)
    @Expect(b2.accepted, true)
    // 结算 A 的那一笔：A 的在途释放、金额转入 A 的模型账，账户总量不变
    let out = UsageLedger(path).settle(AttemptAccounting("at-a1",
        LedgerUsage(1, 1, 0, 0, "vendor"), RateCard(100000, 100000, -1, -1, "CNY", "pv1"),
        customModelId: "cm-a"))
    @Expect(out.status, "settled")
    @Expect(out.amountMicros, Int64(200000))
    let after = UsageLedger(path).state()
    @Expect(after.localInFlight("CNY"), Int64(1850000))
    @Expect(after.localUsed("CNY"), Int64(200000))
    // 结算后 A 的预算腾出来了：再来一笔 950000 必须放行
    let a3 = UsageLedger(path).reserve(ReserveIntent("at-a3", 950000, "CNY",
        customModelId: "cm-a"), 1000000)
    @Expect(a3.accepted, false)
    @Expect(a3.code, "budget-exceeded")
    lgClean(tag)
}

// 断言 13（后半）：同一 attempt 重复结算返回首次结论、不重复扣费。
// 第二次即便带着不同用量与不同计价版本来，也绝不重算历史那一笔。
@Test
func repeatedSettleChargesExactlyOnce() {
    let tag = "idempotent"
    lgClean(tag)
    let path = lgPath(tag)
    @Expect(UsageLedger(path).reserve(ReserveIntent("at-i1", 700000, "CNY"), 1000000).accepted, true)
    let first = UsageLedger(path).settle(AttemptAccounting("at-i1",
        LedgerUsage(2, 1, 0, 0, "vendor"), RateCard(100000, 100000, -1, -1, "CNY", "pv1")))
    @Expect(first.status, "settled")
    @Expect(first.code, "settled")
    @Expect(first.amountMicros, Int64(300000))
    @Expect(first.idempotent, false)
    let entry = UsageLedger(path).attemptEntry("at-i1")
    @Expect(entry.size > 0, true)
    let second = UsageLedger(path).settle(AttemptAccounting("at-i1",
        LedgerUsage(2, 1, 0, 0, "vendor"), RateCard(100000, 100000, -1, -1, "CNY", "pv1")))
    @Expect(second.status, "settled")
    @Expect(second.amountMicros, Int64(300000))
    @Expect(second.idempotent, true)
    @Expect(UsageLedger(path).state().localUsed("CNY"), Int64(300000))
    @Expect(UsageLedger(path).state().localInFlight("CNY"), Int64(0))
    // 换个「当前价」再来一次：首结论不变，账目原文逐字不变
    let third = UsageLedger(path).settle(AttemptAccounting("at-i1",
        LedgerUsage(99, 99, 0, 0, "vendor"), RateCard(900000, 900000, -1, -1, "CNY", "pv2")))
    @Expect(third.amountMicros, Int64(300000))
    @Expect(third.priceVersion, "pv1")
    @Expect(UsageLedger(path).state().localUsed("CNY"), Int64(300000))
    @Expect(UsageLedger(path).attemptEntry("at-i1"), entry)
    lgClean(tag)
}

// 断言 14：缺 usage 记 meterSource=unknown，不记零。
// 「0」是「上游回了零用量」，「-1」才是「这一笔还没核算」——两者不许塌成一档。
@Test
func missingUsageIsRecordedUnknownNotZero() {
    let tag = "nousage"
    lgClean(tag)
    let path = lgPath(tag)
    let rates = RateCard(100000, 200000, 300000, 400000, "CNY", "pv1")
    let out = UsageLedger(path).settle(AttemptAccounting("at-u1", LedgerUsage.absent(), rates))
    @Expect(out.status, "unsettled")
    @Expect(out.code, "usage-unspecified")
    @Expect(out.amountMicros, Int64(-1))
    @Expect(out.meterSource, "unknown")
    let entry = UsageLedger(path).attemptEntry("at-u1")
    @Expect(entry.contains("\"meterSource\":\"unknown\""), true)
    // 「不许记成零消费」：账目里不能出现被冒充成已核算的 0
    @Expect(entry.contains("\"amountMicros\":0"), false)
    @Expect(UsageLedger(path).amountOf("at-u1"), Int64(-1))
    @Expect(UsageLedger(path).meterSourceOf("at-u1"), "unknown")
    @Expect(UsageLedger(path).state().localUsed("CNY"), Int64(0))
    let unsettled = UsageLedger(path).unsettledAttempts()
    @Expect(unsettled.size, Int64(1))
    @Expect(unsettled[0], "at-u1")
    lgClean(tag)
}

// 断言 15：改绑定价格后，历史 attempt 金额逐字不变（结算时写计价快照，不按当前价重算）。
@Test
func priceChangeNeverRewritesHistoricalAttempts() {
    let tag = "price"
    lgClean(tag)
    let path = lgPath(tag)
    let v1 = RateCard(100000, 200000, -1, -1, "CNY", "pv1")
    let first = UsageLedger(path).settle(AttemptAccounting("at-p1",
        LedgerUsage(1, 2, 0, 0, "vendor"), v1))
    @Expect(first.status, "settled")
    // 1×0.1 元 + 2×0.2 元 = 0.5 元 = 500_000 微元
    @Expect(first.amountMicros, Int64(500000))
    @Expect(first.priceVersion, "pv1")
    let entryBefore = UsageLedger(path).attemptEntry("at-p1")
    @Expect(entryBefore.contains("\"priceVersion\":\"pv1\""), true)
    @Expect(entryBefore.contains("\"rateInputMicrosPerUnit\":100000"), true)
    // 改价只影响之后的请求
    let v2 = RateCard(900000, 900000, -1, -1, "CNY", "pv2")
    let second = UsageLedger(path).settle(AttemptAccounting("at-p2",
        LedgerUsage(1, 2, 0, 0, "vendor"), v2))
    @Expect(second.amountMicros, Int64(2700000))
    @Expect(second.priceVersion, "pv2")
    // 历史账目逐字不变，费率与计价版本仍是当时那两份
    @Expect(UsageLedger(path).attemptEntry("at-p1"), entryBefore)
    @Expect(UsageLedger(path).amountOf("at-p1"), Int64(500000))
    @Expect(UsageLedger(path).priceVersionOf("at-p1"), "pv1")
    // 历史 attempt 再结算一次也拿首结论，不按新价重算
    let again = UsageLedger(path).settle(AttemptAccounting("at-p1",
        LedgerUsage(1, 2, 0, 0, "vendor"), v2))
    @Expect(again.amountMicros, Int64(500000))
    @Expect(again.priceVersion, "pv1")
    @Expect(again.idempotent, true)
    @Expect(UsageLedger(path).state().localUsed("CNY"), Int64(3200000))
    lgClean(tag)
}

// 断言 16：定点金额——0.1 + 0.2 形态的累加精确；溢出即拒不清零。
@Test
func fixedPointMoneyIsExactAndOverflowIsRefusedNotZeroed() {
    let tag = "fixed"
    lgClean(tag)
    let path = lgPath(tag)
    // 0.1 元 + 0.2 元：定点精确等于 0.3；同一算式在双精度上不成立（下一行就是反证），
    // 所以「换 Double 累加」的变异体会在这里转红，而不是照样绿。
    let sum = LedgerMoney(100000, "CNY").plus(LedgerMoney(200000, "CNY"))
    @Expect(sum.isSome(), true)
    @Expect(sum.getOrThrow().micros, Int64(300000))
    @Expect(sum.getOrThrow().decimal(), "0.3")
    @Expect(sum.getOrThrow().text(), "0.3 CNY")
    @Expect(0.1 + 0.2 == 0.3, false)
    // 展示与解析都按微单位刻度：0.000001 是最小粒度，更细一律拒（不静默舍入）
    @Expect(ledgerDecimalOf(1000000), "1")
    @Expect(ledgerDecimalOf(1500000), "1.5")
    @Expect(ledgerDecimalOf(1), "0.000001")
    @Expect(ledgerMicrosOfDecimal("0.1") ?? Int64(-1), Int64(100000))
    @Expect(ledgerMicrosOfDecimal("0.2") ?? Int64(-1), Int64(200000))
    @Expect(ledgerMicrosOfDecimal("0.000001") ?? Int64(-1), Int64(1))
    @Expect(ledgerMicrosOfDecimal("0.0000001").isNone(), true)
    @Expect(ledgerMicrosOfDecimal("abc").isNone(), true)
    // 币种不同不许直接相加
    @Expect(LedgerMoney(1, "CNY").plus(LedgerMoney(1, "USD")).isNone(), true)
    // 定点加法上界：Int64 最大值，加 1 即拒（不静默回绕成负数）
    @Expect(LedgerMoney(Int64.Max, "CNY").plus(LedgerMoney(1, "CNY")).isNone(), true)
    // 结算里的一次乘法溢出：整笔落「待核算」，金额是未知（-1），不是 0，也不是回绕值
    // 9223372036855 微元/单位 × 1000000 单位 = 9.223372036855e18 > Int64 最大值
    let huge = RateCard(9223372036855, -1, -1, -1, "CNY", "pv-overflow")
    let out = UsageLedger(path).settle(AttemptAccounting("at-f1",
        LedgerUsage(1000000, 0, 0, 0, "vendor"), huge))
    @Expect(out.status, "unsettled")
    @Expect(out.code, "amount-overflow")
    @Expect(out.amountMicros, Int64(-1))
    let entry = UsageLedger(path).attemptEntry("at-f1")
    @Expect(entry.contains("\"amountMicros\":-1"), true)
    @Expect(entry.contains("\"amountMicros\":0"), false)
    @Expect(UsageLedger(path).state().localUsed("CNY"), Int64(0))
    lgClean(tag)
}

// 断言 51：账本租约的临界区不跨网络，且 release 在 finally 里成对出现。
// 三条证据各自独立：(a) 源码形态——临界区只包一条落盘、无任何网络符号；
// (b) 行为——reserve 返回时租约必须已经归还（否则调用方在网络调用期间仍持锁）；
// (c) 失败路径——账本损坏时早退也不能把租约漏在盘上（release 不在 finally 就会漏）。
@Test
func ledgerCriticalSectionNeverSpansNetworkAndLeaseReturnsInFinally() {
    let tag = "shape"
    lgClean(tag)
    let path = lgPath(tag)
    let src = lgSource()
    @Expect(src.size > 0, true)
    let regions = lgLeaseRegions(src)
    // 成对：每个 takeoverIfStale() 后面都有一个 release，两边数量相等
    @Expect(regions.size > 0, true)
    @Expect(lgCount(src, "takeoverIfStale()"), lgCount(src, "lease.release()"))
    @Expect(regions.size, lgCount(src, "lease.release()"))
    for (region in regions) {
        // 「取租约 → 写一条 → 归还」：临界区里只许有一次落盘
        @Expect(lgCount(region, "log.append("), Int64(1))
        // release 必须挂在 finally 上：早退路径也要归还
        @Expect(region.contains("} finally {"), true)
        let fin = region.indexOf("finally") ?? Int64(-1)
        let rel = region.indexOf("lease.release()") ?? Int64(-1)
        @Expect(fin >= 0 && fin < rel, true)
        // 临界区里不许出现任何网络/远端调用
        for (marker in lgNetworkMarkers) {
            @Expect(region.contains(marker), false)
        }
    }
    // 整份账本源码里既没有网络调用，也不自己读时钟（时间由调用方注入，账本可回放）
    for (marker in lgNetworkMarkers) {
        @Expect(src.contains(marker), false)
    }
    for (marker in ["MonoTime", "DateTime", "now()", "systemTime"]) {
        @Expect(src.contains(marker), false)
    }
    // (b) 预留返回时租约已归还
    @Expect(UsageLedger(path).reserve(ReserveIntent("at-s1", 100000, "CNY"), 1000000).accepted, true)
    @Expect(WriteLease(path).held(), false)
    // (c) 中段缺帧的账本：早退拒绝，且租约没有漏在盘上。
    // 坏帧必须放在**中间**：回放对「末行只写了一半」是有意容忍的（truncatedTail），
    // 只有中段序号断裂才判整份拒绝。
    let corrupt = "0\tledger/reserved\t{}\n9\tledger/reserved\t{}\n2\tledger/reserved\t{}\n"
    File.writeTo(path, corrupt.toArray())
    let bad = UsageLedger(path).reserve(ReserveIntent("at-s2", 100000, "CNY"), 1000000)
    @Expect(bad.accepted, false)
    @Expect(bad.code, "ledger-corrupt")
    // 拒绝就是没写：损坏的账本一个字节都不许被改动
    @Expect(String.fromUtf8(File.readFrom(path)), corrupt)
    @Expect(WriteLease(path).held(), false)
    lgClean(tag)
}

// 断言 76：某维度有用量而该维度费率未登记（-1）→ 该笔落「待核算」；
// 绝不用已登记维度反推、绝不拿总量乘单一单价（那样账面自洽，但每一笔都是错的）。
@Test
func unregisteredDimensionFallsToUnsettledInsteadOfBlending() {
    let tag = "rates"
    lgClean(tag)
    let path = lgPath(tag)
    // 输入/输出已登记，缓存读未登记而这一笔真的用了 5 个缓存读单位
    let rates = RateCard(100000, 200000, -1, -1, "CNY", "pv1")
    let out = UsageLedger(path).settle(AttemptAccounting("at-w1",
        LedgerUsage(1, 2, 5, 0, "vendor"), rates))
    @Expect(out.status, "unsettled")
    @Expect(out.code, "rate-unregistered:cacheRead")
    // 已登记维度本来能算出一个数（1×0.1 + 2×0.2 = 0.5 元），但账目必须是未知而不是它
    @Expect(out.amountMicros, Int64(-1))
    @Expect(UsageLedger(path).state().localUsed("CNY"), Int64(0))
    @Expect(UsageLedger(path).unsettledAttempts()[0], "at-w1")
    // 边界：该维度用量为 0 不算「有用量」，同一条计价格式照常结算
    let zero = UsageLedger(path).settle(AttemptAccounting("at-w2",
        LedgerUsage(1, 2, 0, 0, "vendor"), rates))
    @Expect(zero.status, "settled")
    @Expect(zero.amountMicros, Int64(500000))
    // 四档全登记时按维度分别计价：1×100000 + 2×200000 + 5×300000 + 7×400000 = 4_800_000
    let both = UsageLedger(path).settle(AttemptAccounting("at-w3",
        LedgerUsage(1, 2, 5, 7, "vendor"), RateCard(100000, 200000, 300000, 400000, "CNY", "pv1")))
    @Expect(both.status, "settled")
    @Expect(both.amountMicros, Int64(4800000))
    lgClean(tag)
}

// 断言 64：账本与租约的作用域键里不含任何机器或网络标识，只有本机路径 + 同机作用域键。
@Test
func ledgerScopeKeyCarriesNoMachineOrNetworkIdentity() {
    let tag = "scope"
    lgClean(tag)
    let path = lgPath(tag)
    let ledger = UsageLedger(path)
    // 作用域键 = 本机账本路径（加同机前缀），没有设备号、机器名、网络地址
    @Expect(ledger.scopeKey(), "local:${path}")
    @Expect(ledger.scopeKey().startsWith("local:"), true)
    @Expect(ledger.scopeKey().contains("://"), false)
    @Expect(ledger.scopeKey().startsWith("\\\\"), false)
    @Expect(ledger.scopeKey().contains("@"), false)
    // 取证不是空转：本机确实有机器名，而它不在键里（机器名为空的环境跳过这一条）
    let machine = getVariable("COMPUTERNAME") ?? ""
    if (machine.size >= 3) {
        @Expect(ledger.scopeKey().toAsciiUpper().contains(machine.toAsciiUpper()), false)
    }
    // 账目事件体里同样不许出现机器名/网络标识
    @Expect(UsageLedger(path).reserve(ReserveIntent("at-k1", 100000, "CNY"), 1000000).accepted, true)
    @Expect(UsageLedger(path).settle(AttemptAccounting("at-k1",
        LedgerUsage(1, 0, 0, 0, "vendor"), RateCard(100000, -1, -1, -1, "CNY", "pv1"))).status, "settled")
    let raw = String.fromUtf8(File.readFrom(path))
    @Expect(raw.contains("://"), false)
    if (machine.size >= 3) {
        @Expect(raw.toAsciiUpper().contains(machine.toAsciiUpper()), false)
    }
    // 形态：源码里不出现机器/网络标识的字面量（照断言 48 的检法）
    let src = lgSource()
    @Expect(src.size > 0, true)
    for (marker in ["HOSTNAME", "COMPUTERNAME", "deviceId", "machineId", "hostname",
        "localhost", "127.0.0.1"]) {
        @Expect(src.contains(marker), false)
    }
    lgClean(tag)
}

// 断言 82 的 B3 半 + 「与 attempt_log.cj 同一个文件」：B2 先落先发标记，
// B3 在同一份账本上认出「已派发但未结算」的那几笔，结算后不再出现。
@Test
func dispatchedButUnsettledAttemptIsVisibleOnTheSameLedgerFile() {
    let tag = "dispatch"
    lgClean(tag)
    let path = lgPath(tag)
    @Expect(AttemptLog(path).markDispatched("lr-d1", "at-d1", "step-a/m-1"), true)
    @Expect(UsageLedger(path).reserve(
        ReserveIntent("at-d1", 100000, "CNY", logicalRequestId: "lr-d1"), 1000000).accepted, true)
    let pending = UsageLedger(path).dispatchedUnsettled()
    @Expect(pending.size, Int64(1))
    @Expect(pending[0], "at-d1")
    let held = UsageLedger(path).pendingReservations()
    @Expect(held.size, Int64(1))
    @Expect(held[0], "at-d1")
    @Expect(UsageLedger(path).settle(AttemptAccounting("at-d1",
        LedgerUsage(1, 0, 0, 0, "vendor"), RateCard(100000, -1, -1, -1, "CNY", "pv1"))).status, "settled")
    @Expect(UsageLedger(path).dispatchedUnsettled().size, Int64(0))
    @Expect(UsageLedger(path).pendingReservations().size, Int64(0))
    @Expect(UsageLedger(path).state().localUsed("CNY"), Int64(100000))
    lgClean(tag)
}

// §7.3：供应商关闭或会话被抛弃时，该 attempt 的预留必须显式作废，
// 否则在途额度会永久占位；作废后也不许再结算出一笔费用。
@Test
func voidReleasesInFlightReservationPermanently() {
    let tag = "void"
    lgClean(tag)
    let path = lgPath(tag)
    @Expect(UsageLedger(path).reserve(ReserveIntent("at-v1", 700000, "CNY"), 1000000).accepted, true)
    @Expect(UsageLedger(path).state().localInFlight("CNY"), Int64(700000))
    @Expect(UsageLedger(path).voidAttempt("at-v1", "provider-closed"), "voided")
    @Expect(UsageLedger(path).state().localInFlight("CNY"), Int64(0))
    @Expect(UsageLedger(path).state().localUsed("CNY"), Int64(0))
    @Expect(UsageLedger(path).pendingReservations().size, Int64(0))
    // 幂等：第二次作废不再写一条，也不改钱
    @Expect(UsageLedger(path).voidAttempt("at-v1", "provider-closed"), "already-voided")
    // 作废后不允许再结算出一笔费用（fail-closed）
    let out = UsageLedger(path).settle(AttemptAccounting("at-v1",
        LedgerUsage(1, 0, 0, 0, "vendor"), RateCard(100000, -1, -1, -1, "CNY", "pv1")))
    @Expect(out.status, "rejected")
    @Expect(out.code, "attempt-voided")
    @Expect(out.amountMicros, Int64(-1))
    @Expect(UsageLedger(path).state().localUsed("CNY"), Int64(0))
    // 作废过的 attempt 也不许重新预留（换一个 id 才是新尝试）
    let again = UsageLedger(path).reserve(ReserveIntent("at-v1", 700000, "CNY"), 1000000)
    @Expect(again.accepted, false)
    @Expect(again.code, "attempt-voided")
    lgClean(tag)
}

// 预留的原子性与 fail-closed：同一 attempt 重复预留不叠加在途额度；
// 另一个持有者拿着租约时立刻回拒绝码，既不排队也不先发后补记。
@Test
func reserveIsIdempotentPerAttemptAndFailsClosedWhenTheLedgerIsBusy() {
    let tag = "reserve"
    lgClean(tag)
    let path = lgPath(tag)
    @Expect(UsageLedger(path).reserve(ReserveIntent("at-r1", 300000, "CNY"), 1000000).accepted, true)
    let again = UsageLedger(path).reserve(ReserveIntent("at-r1", 300000, "CNY"), 1000000)
    @Expect(again.accepted, true)
    @Expect(again.code, "already-reserved")
    @Expect(again.inFlightMicros, Int64(300000))
    @Expect(UsageLedger(path).state().localInFlight("CNY"), Int64(300000))
    // 另一入口（或另一个进程）持着租约：fail-closed，不写、不排队
    let held = WriteLease(path)
    @Expect(held.acquire(), true)
    try {
        let busy = UsageLedger(path).reserve(ReserveIntent("at-r2", 300000, "CNY"), 1000000)
        @Expect(busy.accepted, false)
        @Expect(busy.code, "ledger-busy")
        @Expect(UsageLedger(path).state().localInFlight("CNY"), Int64(300000))
    } finally {
        held.release()
    }
    // 结算后的 attempt 不许再预留（免得同一笔被记两次）
    @Expect(UsageLedger(path).settle(AttemptAccounting("at-r1",
        LedgerUsage(1, 0, 0, 0, "vendor"), RateCard(100000, -1, -1, -1, "CNY", "pv1"))).status, "settled")
    let settled = UsageLedger(path).reserve(ReserveIntent("at-r1", 300000, "CNY"), 1000000)
    @Expect(settled.accepted, false)
    @Expect(settled.code, "already-settled")
    lgClean(tag)
}

// §7.5 + 断言 41 的同机口径：账本读面按币种分列，供路由器按 customModelId 取用量；
// 不同币种不许被合加成一个数（跨币种要换算，B3 不做静默折算）。
@Test
func routerViewExposesLocalUsedPerCustomModelAndCurrency() {
    let tag = "router"
    lgClean(tag)
    let path = lgPath(tag)
    @Expect(UsageLedger(path).settle(AttemptAccounting("at-m1",
        LedgerUsage(1, 0, 0, 0, "vendor"), RateCard(100000, -1, -1, -1, "CNY", "pv1"),
        customModelId: "cm-a")).status, "settled")
    @Expect(UsageLedger(path).settle(AttemptAccounting("at-m2",
        LedgerUsage(2, 0, 0, 0, "vendor"), RateCard(100000, -1, -1, -1, "CNY", "pv1"),
        customModelId: "cm-a")).status, "settled")
    @Expect(UsageLedger(path).settle(AttemptAccounting("at-m3",
        LedgerUsage(1, 0, 0, 0, "vendor"), RateCard(500000, -1, -1, -1, "USD", "pv1"),
        customModelId: "cm-b")).status, "settled")
    @Expect(UsageLedger(path).routerView("CNY").usedFor("cm-a"), Int64(300000))
    @Expect(UsageLedger(path).routerView("CNY").usedFor("cm-b"), Int64(0))
    @Expect(UsageLedger(path).routerView("USD").usedFor("cm-b"), Int64(500000))
    @Expect(UsageLedger(path).state().localUsed("CNY"), Int64(300000))
    @Expect(UsageLedger(path).state().localUsed("USD"), Int64(500000))
    lgClean(tag)
}

// §7.5：统计读面分列 usageKind 与 providerId（实例）两个维度，
// 聚合时不许把实例维度抹掉——号池里要看得清「哪把 key 花了多少」。
@Test
func describeKeepsUsageKindAndProviderDimensions() {
    let tag = "describe"
    lgClean(tag)
    let path = lgPath(tag)
    @Expect(UsageLedger(path).settle(AttemptAccounting("at-d1",
        LedgerUsage(1, 1, 0, 0, "vendor"), RateCard(100000, 100000, -1, -1, "CNY", "pv1"),
        customModelId: "cm-a", providerId: "step-a", usageKind: "chat")).status, "settled")
    @Expect(UsageLedger(path).settle(AttemptAccounting("at-d2",
        LedgerUsage(3, 0, 0, 0, "vendor"), RateCard(100000, 100000, -1, -1, "CNY", "pv1"),
        customModelId: "cm-a", providerId: "step-b", usageKind: "probe")).status, "settled")
    let kinds = UsageLedger(path).usageKindTotals()
    @Expect(kinds.size, Int64(2))
    @Expect(kinds[0].key, "chat")
    @Expect(kinds[0].usedMicros, Int64(200000))
    @Expect(kinds[1].key, "probe")
    @Expect(kinds[1].usedMicros, Int64(300000))
    let providers = UsageLedger(path).providerTotals()
    @Expect(providers.size, Int64(2))
    @Expect(providers[0].key, "step-a")
    @Expect(providers[0].customModelId, "cm-a")
    @Expect(providers[0].usedMicros, Int64(200000))
    @Expect(providers[1].key, "step-b")
    @Expect(providers[1].usedMicros, Int64(300000))
    let describe = UsageLedger(path).describeJson()
    @Expect(describe.contains("\"providerId\":\"step-a\""), true)
    @Expect(describe.contains("\"providerId\":\"step-b\""), true)
    @Expect(describe.contains("\"usageKind\":\"probe\""), true)
    // 本地累计费用不许冒充余额/跨机口径
    @Expect(describe.contains("local:"), true)
    lgClean(tag)
}
