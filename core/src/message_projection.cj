package core
import std.collection.ArrayList
import stdx.encoding.json.*

// 一次事件快照同时生成正文与附件关联；不能按文本匹配（同正文可出现多次）。
public class MessageProjectionRow {
    public let id: String
    public let eventType: String
    public let text: String
    public let attachments: ArrayList<AttachmentRef>
    public init(event: SessionEvent, refs: ArrayList<AttachmentRef>) {
        id = "event-${event.seq}"
        eventType = event.eventType
        text = if (eventType == "assistant/message" || eventType == "tool/result") { modelSurfaceText(event.data) } else { event.data }
        attachments = refs
    }
    public func line(): String { return "${eventType}: ${text}" }
    public func toJson(): String {
        let obj = JsonObject()
        obj.put("id", JsonString(id)); obj.put("eventType", JsonString(eventType)); obj.put("text", JsonString(text))
        let refs = JsonArray()
        for (ref in attachments) { refs.add(ref.toJsonObject()) }
        obj.put("attachments", refs)
        return obj.toString()
    }
}

public func projectMessageRows(events: Array<SessionEvent>): ArrayList<MessageProjectionRow> {
    let rows = ArrayList<MessageProjectionRow>()
    var pending = ArrayList<AttachmentRef>()
    for (event in events) {
        if (event.eventType == "attachment/record") { pending = parseAttachmentRefs(event.data); continue }
        if (!isSurfaceEvent(event.eventType)) { continue }
        var refs = if (event.eventType == "user/message") { pending } else { ArrayList<AttachmentRef>() }
        // 工具结果（如桌面截图）的引用挂在 wire 里：投影要认同一份引用，
        // UI 才拿得到「这张图属于本会话」的读取授权，而不是凭空造第二个真源。
        if (event.eventType == "tool/result") {
            if (let Some(wire) <- modelWireMessage(event.data)) {
                let obj = JsonValue.fromStr(wire).asObject()
                if (let Some(attachments) <- obj.get("attachments")) { refs = parseAttachmentRefs(attachments.toString()) }
            }
        }
        rows.add(MessageProjectionRow(event, refs))
        if (event.eventType == "user/message") { pending = ArrayList<AttachmentRef>() }
    }
    return rows
}
