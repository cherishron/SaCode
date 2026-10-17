package daemon
import core.*

import std.collection.*

// session/events 的服务端补读面（设计 §6）。会话日志是唯一真源，这里只做「读盘 + 按游标切页」，
// 不产生任何副作用：所以 durable=false，也不进幂等账。
//
// 三条不能含糊的口径：
//   - 只交已 flush 的前缀。append 只在实例内可见，把它当历史交出去就是伪造持久记录。
//   - 「取不到」与「没有」是两回事：越界游标与代次不符都回显式 gap，
//     并把当前代次一起带回去，客户端据此重取快照再补读，不会把空页当成空会话。
//   - seq 出线固定十进制字符串（§6），游标传回与网关比较都用这一个形状。

public let REPLAY_KIND_PAGE: String = "page"
public let REPLAY_KIND_GAP: String = "gap"
public let REPLAY_KIND_REJECTED: String = "rejected"

public let REPLAY_GAP_CURSOR: String = "cursor-beyond-horizon"
public let REPLAY_GAP_GENERATION: String = "generation-mismatch"

public let REPLAY_ERR_CURSOR_MALFORMED: String = "cursor-malformed"
public let REPLAY_ERR_LIMIT_MALFORMED: String = "limit-malformed"
public let REPLAY_ERR_LIMIT_RANGE: String = "limit-out-of-range"
public let REPLAY_ERR_UNKNOWN_SESSION: String = "unknown-session"

let REPLAY_LIMIT_MIN: Int64 = 1
let REPLAY_LIMIT_MAX: Int64 = 200

public class ReplayEvent {
    public let seq: Int64
    public let seqText: String
    public let eventType: String
    public let data: String
    public init(seq!: Int64, eventType!: String, data!: String) {
        this.seq = seq
        this.seqText = seq.toString()
        this.eventType = eventType
        this.data = data
    }
}

public class ReplayPage {
    public let kind: String
    public let reason: String
    public let generation: String
    public let nextSeq: String
    public let hasMore: Bool
    public let items: ArrayList<ReplayEvent>

    public init(kind!: String, reason!: String = "", generation!: String = "",
                nextSeq!: String = "", hasMore!: Bool = false,
                items!: ArrayList<ReplayEvent> = ArrayList<ReplayEvent>()) {
        this.kind = kind
        this.reason = reason
        this.generation = generation
        this.nextSeq = nextSeq
        this.hasMore = hasMore
        this.items = items
    }

    public func toJson(): String {
        var events = "["
        var comma = ""
        for (e in items) {
            events = "${events}${comma}{\"seq\":\"${e.seqText}\",\"eventType\":\"${jsonEscapeText(e.eventType)}\",\"data\":\"${jsonEscapeText(e.data)}\"}"
            comma = ","
        }
        events += "]"
        let gapText = if (kind == REPLAY_KIND_GAP) { "\"${jsonEscapeText(reason)}\"" } else { "null" }
        return "{\"generation\":\"${jsonEscapeText(generation)}\",\"nextSeq\":\"${jsonEscapeText(nextSeq)}\"," +
            "\"hasMore\":${if (hasMore) { "true" } else { "false" }},\"gap\":${gapText},\"events\":${events}}"
    }
}

// 十进制正整数解析：只接受纯数字，且短到不可能溢出。
// 不用 Int64.tryParse——那是「文档里有、本机没编过」的形态，这里的手写扫描
// 顺手把 "-1"、" 1"、"1e3" 全部归到 malformed，正是 §6 要的严格游标。
func parseDecimal(raw: String): Option<Int64> {
    if (raw.size == Int64(0) || raw.size > Int64(18)) { return None }
    var v: Int64 = 0
    for (b in raw.toArray()) {
        if (b < 48 || b > 57) { return None }
        v = v * Int64(10) + Int64(b - 48)
    }
    return Some(v)
}

public class SessionEventReplay {
    let root: String

    public init(root!: String) {
        this.root = root
    }

    // 代次 = 首条持久事件的内容摘要。它只回答「还是不是同一本日志」：
    // 追加不换代次（否则每次补读都被判成 gap），删库重建才换。
    static func generationOf(events: ArrayList<SessionEvent>): String {
        if (Int64(events.size) == Int64(0)) { return "empty" }
        let first = events[0]
        let frame = "${first.seq}|${first.eventType}|${first.data}"
        return sha256Hex(frame.toArray())
    }

    public func page(sessionId!: String, afterSeq!: String, limit!: String, generation!: String): ReplayPage {
        // 缺省游标 = 从头，含 seq 0：新客户端第一次补读不该天然丢掉第一条。
        // 显式写 "-1" 仍按 malformed 拒——§6 要严格的十进制游标，不接受我们自己发明的反值哨兵。
        var hasCursor = false
        var cursorValue: Int64 = 0
        var want: Int64 = 0
        if (afterSeq.size > Int64(0)) {
            let parsed = parseDecimal(afterSeq)
            if (!parsed.isSome()) {
                return ReplayPage(kind: REPLAY_KIND_REJECTED, reason: REPLAY_ERR_CURSOR_MALFORMED)
            }
            cursorValue = parsed.getOrThrow()
            want = cursorValue + Int64(1)
            hasCursor = true
        }
        let size = parseDecimal(limit)
        if (!size.isSome()) {
            return ReplayPage(kind: REPLAY_KIND_REJECTED, reason: REPLAY_ERR_LIMIT_MALFORMED)
        }
        if (size.getOrThrow() < REPLAY_LIMIT_MIN || size.getOrThrow() > REPLAY_LIMIT_MAX) {
            return ReplayPage(kind: REPLAY_KIND_REJECTED, reason: REPLAY_ERR_LIMIT_RANGE)
        }
        var logPath = ""
        let resolved = try { logPath = SessionCatalog(root).pathFor(sessionId); true }
            catch (_: Exception) { false }
        if (!resolved) {
            return ReplayPage(kind: REPLAY_KIND_REJECTED, reason: REPLAY_ERR_UNKNOWN_SESSION)
        }
        let log = SessionLog(logPath)
        if (!log.load()) {
            return ReplayPage(kind: REPLAY_KIND_REJECTED, reason: REPLAY_ERR_UNKNOWN_SESSION)
        }
        let durable = log.snapshotEvents()
        let gen = SessionEventReplay.generationOf(durable)
        let horizon = Int64(durable.size) - Int64(1)
        // 空日志没有任何「已投递」可回：nextSeq 回空串，按上面的口径就是「仍从头读」。
        if (horizon < Int64(0)) {
            if (generation.size > Int64(0) && generation != gen) {
                return ReplayPage(kind: REPLAY_KIND_GAP, reason: REPLAY_GAP_GENERATION, generation: gen)
            }
            return ReplayPage(kind: REPLAY_KIND_PAGE, generation: gen)
        }
        if (generation.size > Int64(0) && generation != gen) {
            return ReplayPage(kind: REPLAY_KIND_GAP, reason: REPLAY_GAP_GENERATION,
                generation: gen, nextSeq: horizon.toString())
        }
        if (hasCursor && cursorValue > horizon) {
            return ReplayPage(kind: REPLAY_KIND_GAP, reason: REPLAY_GAP_CURSOR,
                generation: gen, nextSeq: horizon.toString())
        }
        let cap = size.getOrThrow()
        let items = ArrayList<ReplayEvent>()
        // nextSeq 的口径是「你确实看到的那一条」，不是「我本来打算给你的那一条」：
        // 无新事件时把游标原样带回去，客户端下次轮询才不会跳过之后才落盘的那条。
        var lastSeen = if (hasCursor) { cursorValue } else { Int64(-1) }
        var i: Int64 = 0
        while (i < Int64(durable.size)) {
            let ev = durable[i]
            i += 1
            if (ev.seq < want) { continue }
            if (Int64(items.size) >= cap) { continue }
            items.add(ReplayEvent(seq: ev.seq, eventType: ev.eventType, data: ev.data))
            lastSeen = ev.seq
        }
        let nextText = if (lastSeen < Int64(0)) { "" } else { lastSeen.toString() }
        return ReplayPage(kind: REPLAY_KIND_PAGE, generation: gen, nextSeq: nextText,
            hasMore: lastSeen < horizon, items: items)
    }
}
