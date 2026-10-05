package core
import std.collection.ArrayList
import stdx.encoding.base64.*
import stdx.encoding.json.*

// 只读当前会话已引用的图片：历史消息与当前 inbox 是授权范围，已移除队列不是。
public func sessionImageJson(log: SessionLog, store: AttachmentStore, attachmentId: String): String {
    let refs = ArrayList<AttachmentRef>()
    for (row in projectMessageRows(log.snapshotEvents().toArray())) {
        for (ref in row.attachments) { refs.add(ref) }
    }
    let inbox = AgentInbox(log)
    for (target in ["next-turn", "next-step"]) {
        for (message in inbox.snapshot(target)) {
            for (ref in message.attachments) { refs.add(ref) }
        }
    }
    var picked: Option<AttachmentRef> = None
    for (ref in refs) {
        if (ref.attachmentId == attachmentId && ref.kind == "image") { picked = Some(ref); break }
    }
    if (let Some(ref) <- picked) {
        if (!(ref.mediaType == "image/png" || ref.mediaType == "image/jpeg" || ref.mediaType == "image/gif") ||
            ref.bytes < 1 || ref.bytes > AttachmentLimits.localBackend().maxImageBytes) {
            throw Exception("attachment-image-rejected")
        }
        let data = store.read(attachmentId) // 每次权威读都复核内容摘要。
        if (Int64(data.size) != ref.bytes) { throw Exception("attachment-image-rejected") }
        let obj = JsonObject()
        obj.put("attachmentId", JsonString(ref.attachmentId))
        obj.put("mediaType", JsonString(ref.mediaType))
        obj.put("data", JsonString(toBase64String(data)))
        return obj.toString()
    }
    throw Exception("attachment-image-not-referenced")
}
