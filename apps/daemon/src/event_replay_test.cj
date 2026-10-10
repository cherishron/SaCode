package daemon
import core.*

import std.collection.*
import std.env.*
import std.fs.*
import std.unittest.*

// session/events 的补读语义钉子（设计 §6）：
//   「新增拟定 session/events 方法，接受 sessionId、afterSeq、limit（1..200）；
//     返回 durable 事件、generation、nextSeq、hasMore。
//     generation 不匹配或游标超出范围返回显式 gap，客户端重取快照并补读」。
// 三条最容易假绿的线都在这里钉：
//   1) 只交已 flush 的前缀——append 不算持久（AGENTS.md 的第一条约束）；
//   2) gap 必须是显式原因而不是「空页」，否则客户端会把「没取到」当成「没有事件」；
//   3) seq 出线是十进制字符串，不能一会儿数一会儿串。

class ReplayFixture {
    let root: String
    let sessionId: String
    let logPath: String
    let durableCount: Int64

    init(name!: String, appends!: Int64) {
        root = "${getTempDirectory().toString()}/sa-replay-${name}"
        if (!exists(root)) { Directory.create(root) }
        let catalog = SessionCatalog(root)
        sessionId = catalog.create("fixture")
        logPath = catalog.pathFor(sessionId)
        let log = SessionLog(logPath)
        // create() 已经往同一份日志写过 session/title。新的 SessionLog 实例必须先 load()
        // 再 append：否则 flush 的「只增不减」守卫会因为草稿比磁盘短而拒绝落盘（返回 false）。
        @Expect(log.load(), true)
        var i: Int64 = 0
        while (i < appends) {
            log.append("user/message", "m-${i}")
            i += 1
        }
        @Expect(log.flush(), true)
        // create 自己写过一条 session/title，所以盘上比这里多一条。
        durableCount = appends + Int64(1)
    }

    // 只 append 不 flush：这一段在进程内可见，但不算持久，补读不能把它当历史交出去。
    func appendVolatile(text: String): Unit {
        let log = SessionLog(logPath)
        log.load()
        log.append("user/message", text)
    }

    func replay(): SessionEventReplay {
        return SessionEventReplay(root: root)
    }
}

@Test
func pageFromCursorReturnsOnlyLaterEventsWithDecimalStringSeq() {
    let f = ReplayFixture(name: "cursor", appends: Int64(3))
    let p = f.replay().page(sessionId: f.sessionId, afterSeq: "0", limit: "50", generation: "")
    @Expect(p.kind, REPLAY_KIND_PAGE)
    @Expect(p.items.size, Int64(3))
    @Expect(p.items[0].seq, Int64(1))
    @Expect(p.hasMore, false)
    @Expect(p.nextSeq, "${f.durableCount - Int64(1)}")
    // 游标本身不参与返回：afterSeq 是「已看过的那一条」。
    let later = f.replay().page(sessionId: f.sessionId, afterSeq: "2", limit: "50", generation: p.generation)
    @Expect(later.kind, REPLAY_KIND_PAGE)
    @Expect(later.items.size, Int64(1))
    @Expect(later.items[0].seqText, "3")
}

@Test
func limitCutsThePageAndFlagsMore() {
    let f = ReplayFixture(name: "limit", appends: Int64(5))
    let p = f.replay().page(sessionId: f.sessionId, afterSeq: "0", limit: "2", generation: "")
    @Expect(p.items.size, Int64(2))
    @Expect(p.hasMore, true)
    @Expect(p.nextSeq, "2")
    // 下一段接着取：把两页拼起来必须正好覆盖全部持久事件，一条不多一条不少。
    let q = f.replay().page(sessionId: f.sessionId, afterSeq: p.nextSeq, limit: "2", generation: "")
    @Expect(q.items.size, Int64(2))
    @Expect(q.hasMore, true)
    let r = f.replay().page(sessionId: f.sessionId, afterSeq: q.nextSeq, limit: "2", generation: "")
    @Expect(r.items.size, Int64(1))
    @Expect(r.hasMore, false)
}

@Test
func cursorBeyondHorizonIsExplicitGapNotEmptyPage() {
    // 「没取到」和「没有事件」必须是两回事：越界游标回空页会被客户端当成会话是空的。
    let f = ReplayFixture(name: "beyond", appends: Int64(2))
    let p = f.replay().page(sessionId: f.sessionId, afterSeq: "99", limit: "50", generation: "")
    @Expect(p.kind, REPLAY_KIND_GAP)
    @Expect(p.reason, REPLAY_GAP_CURSOR)
    @Expect(p.items.size, Int64(0))
    @Expect(p.generation.size > Int64(0), true)
}

@Test
func generationMismatchIsExplicitGapAndCarriesCurrentGeneration() {
    let f = ReplayFixture(name: "gen", appends: Int64(2))
    let now = f.replay().page(sessionId: f.sessionId, afterSeq: "0", limit: "50", generation: "")
    let stale = f.replay().page(sessionId: f.sessionId, afterSeq: "0", limit: "50",
        generation: "0000000000000000000000000000000000000000000000000000000000000000")
    @Expect(stale.kind, REPLAY_KIND_GAP)
    @Expect(stale.reason, REPLAY_GAP_GENERATION)
    // gap 里要带当前代次，否则客户端只能再问一次才知道该按哪份快照补读。
    @Expect(stale.generation, now.generation)
    // 同一本日志的代次不随追加漂移：它是「还是不是同一本账」，不是版本号。
    let more = SessionLog(f.logPath)
    @Expect(more.load(), true)
    more.append("user/message", "late")
    @Expect(more.flush(), true)
    let afterAppend = f.replay().page(sessionId: f.sessionId, afterSeq: "0", limit: "50", generation: now.generation)
    @Expect(afterAppend.kind, REPLAY_KIND_PAGE)
}

@Test
func limitOutOfRangeIsRejectedNotClamped() {
    // 静默把 0 或 201 折进合法区间，客户端拿到的页大小就不是它要的那一个，
    // 而它无法从应答里看出来。
    let f = ReplayFixture(name: "range", appends: Int64(3))
    @Expect(f.replay().page(sessionId: f.sessionId, afterSeq: "0", limit: "0", generation: "").kind, REPLAY_KIND_REJECTED)
    @Expect(f.replay().page(sessionId: f.sessionId, afterSeq: "0", limit: "201", generation: "").reason, REPLAY_ERR_LIMIT_RANGE)
    @Expect(f.replay().page(sessionId: f.sessionId, afterSeq: "-1", limit: "50", generation: "").reason, REPLAY_ERR_CURSOR_MALFORMED)
    @Expect(f.replay().page(sessionId: f.sessionId, afterSeq: "abc", limit: "50", generation: "").reason, REPLAY_ERR_CURSOR_MALFORMED)
    @Expect(f.replay().page(sessionId: f.sessionId, afterSeq: "0", limit: "abc", generation: "").reason, REPLAY_ERR_LIMIT_MALFORMED)
}

@Test
func unflushedTailIsNotDeliveredAsHistory() {
    let f = ReplayFixture(name: "tail", appends: Int64(2))
    f.appendVolatile("只在内存里")
    let p = f.replay().page(sessionId: f.sessionId, afterSeq: "0", limit: "50", generation: "")
    @Expect(p.items.size, Int64(2))
    @Expect(p.nextSeq, "${f.durableCount - Int64(1)}")
    var found = false
    for (e in p.items) { if (e.data == "只在内存里") { found = true } }
    @Expect(found, false)
}

@Test
func unknownSessionIsRejectedWithoutFabricatingAPage() {
    let f = ReplayFixture(name: "unknown", appends: Int64(1))
    let p = f.replay().page(sessionId: "sessions/nope", afterSeq: "0", limit: "50", generation: "")
    @Expect(p.kind, REPLAY_KIND_REJECTED)
    @Expect(p.reason, REPLAY_ERR_UNKNOWN_SESSION)
    @Expect(p.items.size, Int64(0))
}

@Test
func pageJsonCarriesCursorFieldsAndGapReason() {
    let f = ReplayFixture(name: "json", appends: Int64(2))
    let p = f.replay().page(sessionId: f.sessionId, afterSeq: "0", limit: "50", generation: "")
    let text = p.toJson()
    @Expect((text.indexOf("\"generation\":\"") ?? Int64(-1)) >= Int64(0), true)
    // seq 出线是十进制字符串（§6 固定形状），不是裸数字。
    @Expect((text.indexOf("\"seq\":\"1\"") ?? Int64(-1)) >= Int64(0), true)
    @Expect((text.indexOf("\"hasMore\":false") ?? Int64(-1)) >= Int64(0), true)
    @Expect((text.indexOf("\"gap\":null") ?? Int64(-1)) >= Int64(0), true)
    let gap = f.replay().page(sessionId: f.sessionId, afterSeq: "99", limit: "50", generation: "")
    @Expect((gap.toJson().indexOf("\"gap\":\"${REPLAY_GAP_CURSOR}\"") ?? Int64(-1)) >= Int64(0), true)
}

@Test
func absentCursorReadsFromSeqZeroWhileExplicitZeroSkipsIt() {
    // 第一次补读必须拿到第一条持久事件。「0」是「已经看过 seq 0」的游标，
    // 不能同时当缺省值用——否则远程端永远读不到第一条，而本地测试全用显式 "0" 时看不出来。
    let f = ReplayFixture(name: "head", appends: Int64(2))
    let head = f.replay().page(sessionId: f.sessionId, afterSeq: "", limit: "50", generation: "")
    @Expect(head.kind, REPLAY_KIND_PAGE)
    @Expect(head.items.size, Int64(3))
    @Expect(head.items[0].seq, Int64(0))
    @Expect(head.nextSeq, "2")
    let explicit = f.replay().page(sessionId: f.sessionId, afterSeq: "0", limit: "50", generation: "")
    @Expect(explicit.items.size, Int64(2))
    @Expect(explicit.items[0].seq, Int64(1))
    // 从头与显式 "0" 必须是两种结果，否则这条钉子等于没写。
    @Expect(head.items.size > explicit.items.size, true)
}

@Test
func quietPollReturnsSameCursorInsteadOfJumpingAhead() {
    // 无新事件时把游标原样带回。若回的是「我本来打算给你的那一条」，客户端下次轮询就
    // 把它当已看过，之后才落盘的那条会被永久跳掉——这是补读面最贵的 off-by-one。
    let f = ReplayFixture(name: "quiet", appends: Int64(2))
    let first = f.replay().page(sessionId: f.sessionId, afterSeq: "2", limit: "50", generation: "")
    @Expect(first.kind, REPLAY_KIND_PAGE)
    @Expect(first.items.size, Int64(0))
    @Expect(first.hasMore, false)
    @Expect(first.nextSeq, "2")
    let more = SessionLog(f.logPath)
    @Expect(more.load(), true)
    more.append("user/message", "after-poll")
    @Expect(more.flush(), true)
    let after = f.replay().page(sessionId: f.sessionId, afterSeq: first.nextSeq, limit: "50", generation: "")
    @Expect(after.items.size, Int64(1))
    @Expect(after.items[0].seq, Int64(3))
    @Expect(after.items[0].data, "after-poll")
}
