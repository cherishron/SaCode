package daemon
import core.*

import std.collection.*
import stdx.encoding.json.*

// SSE 帧的成形与断线补读（设计 §6）。这一档刻意是纯函数：`/sse` 那个循环本体只能在
// 真实 daemon 上验收，而「一帧该长什么样」「重连该补哪一段」「去重拿什么当键」
// 三条必须能独立钉住，否则恢复面只能靠肉眼读日志。
//
// 游标形状 `<sessionId>|<seq>` 由服务端写进帧的 `id:` 行，客户端原样回带 `Last-Event-ID`
// （apps/desktop/remote-transport.mjs 已在透传）。两条不可让的口径：
//   - 坏游标一律按「没有游标」处理，建流照常成功。把它升成异常等于让任何远程客户端
//     发一个坏 Last-Event-ID 就能拒绝服务自己这条连接。
//   - 只有持久事件带游标。瞬时帧标 ephemeral 且不带 id，客户端才不会拿它去补读，
//     也就不会把「重放瞬时文本」当成服务端承诺过的行为。

public let SSE_ID_SEP: String = "|"
public let SSE_EVENT_DURABLE: String = "durable"
public let SSE_EVENT_EPHEMERAL: String = "ephemeral"
// sessionId 的形状上限与审计侧标识符同一口径：超长/含非法字符直接判「没有游标」。
let SSE_RESUME_ID_MAX: Int64 = 64

public class ResumeCursor {
    public let valid: Bool
    public let sessionId: String
    public let seq: String
    public init(valid!: Bool, sessionId!: String = "", seq!: String = "") {
        this.valid = valid
        this.sessionId = sessionId
        this.seq = seq
    }
}

public class SseFrame {
    // 持久帧：id 行给续读游标，event 行给类别，data 行带归属 + 游标 + 事件本体。
    static func renderDurable(sessionId!: String, seq!: String, eventType!: String, data!: String): String {
        let payload = "{\"sessionId\":\"${jsonEscapeText(sessionId)}\",\"seq\":\"${jsonEscapeText(seq)}\"," +
            "\"eventType\":\"${jsonEscapeText(eventType)}\",\"data\":\"${jsonEscapeText(data)}\"}"
        return "id: ${sessionId}${SSE_ID_SEP}${seq}\nevent: ${SSE_EVENT_DURABLE}\ndata: ${payload}\n\n"
    }

    // 直播/瞬时帧：不带 id，只标 ephemeral。
    static func renderLive(frame: String): String {
        return "event: ${SSE_EVENT_EPHEMERAL}\ndata: ${frame}\n\n"
    }

    // 关闭原因要写在流里：§6 要求「超过任一限额关闭并给出可恢复原因」。
    // 只把它落进 daemon 的 stderr，客户端就只能靠连接断开自己去猜该重连还是该补读。
    static func renderClose(reason: String): String {
        return "event: close\ndata: {\"reason\":\"${jsonEscapeText(reason)}\"}\n\n"
    }

    // 去重键的查表。补读时交付过的游标，之后从缓冲队列里再取到同一条就丢掉——
    // 顺序是「先订阅、再读高水位」，所以这里只可能多、不可能少。
    static func delivered(ids!: ArrayList<String>, id!: String): Bool {
        if (id.size == Int64(0)) { return false }
        var i: Int64 = 0
        while (i < Int64(ids.size)) {
            if (ids[i] == id) { return true }
            i += 1
        }
        return false
    }

    static func parseLastEventId(raw: String): ResumeCursor {
        let parts = raw.split(SSE_ID_SEP)
        if (Int64(parts.size) != Int64(2)) { return ResumeCursor(valid: false) }
        let sid = parts[0]
        let seq = parts[1]
        if (sid.size == Int64(0) || sid.size > SSE_RESUME_ID_MAX) { return ResumeCursor(valid: false) }
        if (RemoteRequestGate.sanitizeId(sid) != sid) { return ResumeCursor(valid: false) }
        // 游标必须能与持久面的十进制 seq 对话，别的形状都不认。
        if (parseDecimal(seq).isNone()) { return ResumeCursor(valid: false) }
        return ResumeCursor(valid: true, sessionId: sid, seq: seq)
    }

    // 从直播帧里取它自带的持久游标。取不到就回空串——去重只在「同一个游标」上做，
    // 绝不按内容相似度猜，否则一条合法通知能被另一条长得像的帧吃掉。
    static func idOf(frame: String): String {
        var id = ""
        try {
            let params = JsonValue.fromStr(frame).asObject().get("params").getOrThrow().asObject()
            let sid = params.get("sessionId").getOrThrow().asString().getValue()
            let seqText = scalarText(params.get("seq").getOrThrow())
            if (sid.size > Int64(0) && seqText.size > Int64(0)) {
                id = "${sid}${SSE_ID_SEP}${seqText}"
            } else {
                id = ""
            }
        } catch (_: Exception) {
            id = ""
        }
        return id
    }
}

public class SseResume {
    public let frames: ArrayList<String>
    public let ids: ArrayList<String>

    init(frames!: ArrayList<String>, ids!: ArrayList<String>) {
        this.frames = frames
        this.ids = ids
    }

    static func empty(): SseResume {
        return SseResume(frames: ArrayList<String>(), ids: ArrayList<String>())
    }

    // 只补「游标之后」的持久事件，且只补一次一页（limit 由调用方给，越界即不补）。
    // 补读失败/会话不存在/游标坏掉都回空结果：建流路径上没有任何一条分支能抛。
    static func buildAuthorized(root!: String, lastEventId!: String, limit!: Int64,
                                gate!: RemoteRequestGate, context!: AuthenticationContext): SseResume {
        let cursor = SseFrame.parseLastEventId(lastEventId)
        if (!cursor.valid || !gate.streamAllows(context, "session/events", gate.streamWorkspace(), cursor.sessionId)) {
            return SseResume.empty()
        }
        return SseResume.build(root: root, lastEventId: lastEventId, limit: limit)
    }

    static func build(root!: String, lastEventId!: String, limit!: Int64): SseResume {
        if (lastEventId.size == Int64(0)) { return SseResume.empty() }
        if (limit < Int64(1) || limit > Int64(200)) { return SseResume.empty() }
        let cursor = SseFrame.parseLastEventId(lastEventId)
        if (!cursor.valid) { return SseResume.empty() }
        var page = ReplayPage(kind: REPLAY_KIND_REJECTED, reason: "")
        try {
            page = SessionEventReplay(root: root).page(sessionId: cursor.sessionId,
                afterSeq: cursor.seq, limit: limit.toString(), generation: "")
        } catch (_: Exception) {
            return SseResume.empty()
        }
        if (page.kind != REPLAY_KIND_PAGE) { return SseResume.empty() }
        let frames = ArrayList<String>()
        let ids = ArrayList<String>()
        for (ev in page.items) {
            frames.add(SseFrame.renderDurable(sessionId: cursor.sessionId, seq: ev.seqText,
                eventType: ev.eventType, data: ev.data))
            ids.add("${cursor.sessionId}${SSE_ID_SEP}${ev.seqText}")
        }
        return SseResume(frames: frames, ids: ids)
    }
}
