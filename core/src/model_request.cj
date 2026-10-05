package core
import std.collection.ArrayList
import stdx.encoding.base64.*
import stdx.encoding.json.*

// 标准消息与具有关联 ID 的工具结果全部从同一会话日志重建。
public func modelRequestJson(model: String, events: Array<SessionEvent>, tools!: Array<ToolSpec> = [], attachStore!: ?AttachmentStore = None, supportsImages!: Bool = false): String {
    var messages = ""
    let pending = ArrayList<String>()
    // 引用事件服务的是紧跟其后的那条用户消息。「引用 → 请求字节」的物化只发生在这里：
    // 会话日志里始终只有引用与元数据，base64 不进真源（上游 attachment.en.md L5 与
    // L149-166 的 RequestImageAttachment 就是这么切的）。
    var pendingRefs = ArrayList<AttachmentRef>()
    for (event in events) {
        if (event.eventType == "attachment/record") {
            pendingRefs = parseAttachmentRefs(event.data)
            continue
        }
        var role = ""
        if (event.eventType == "system/message") { role = "system" }
        else if (event.eventType == "developer/message") { role = "developer" }
        else if (event.eventType == "user/message") { role = "user" }
        else if (event.eventType == "assistant/message") { role = "assistant" }
        if (event.eventType == "tool/result" || role == "assistant") {
            if (let Some(wire) <- modelWireMessage(event.data)) {
                let obj = JsonValue.fromStr(wire).asObject()
                if (obj.get("role").getOrThrow().asString().getValue() != (if (role == "assistant") { "assistant" } else { "tool" })) { throw Exception("bad-model-message-role") }
                if (role == "assistant") {
                    if (pending.size > 0) { throw Exception("unsettled-model-tool-calls") }
                    if (let Some(values) <- obj.get("tool_calls")) {
                        var index = Int64(0)
                        let calls = values.asArray()
                        while (let Some(value) <- calls.get(index)) {
                            let id = value.asObject().get("id").getOrThrow().asString().getValue()
                            if (id.size == 0 || pending.contains(id)) { throw Exception("bad-model-tool-id") }
                            pending.add(id)
                            index += 1
                        }
                    }
                } else {
                    let id = obj.get("tool_call_id").getOrThrow().asString().getValue()
                    var found = false
                    for (index in 0..pending.size) {
                        if (pending[index] == id) { pending.remove(at: index); found = true; break }
                    }
                    if (!found) { throw Exception("orphan-model-tool-result") }
                }
                obj.get("content").getOrThrow().asString()
                if (messages.size > 0) { messages += "," }
                messages += wire
                continue
            }
        }
        if (role.size == 0) { continue }
        if (pending.size > 0) { throw Exception("unsettled-model-tool-calls") }
        if (messages.size > 0) { messages += "," }
        if (role == "user") {
            if (pendingRefs.size > 0) {
                messages += userMessageWithRefs(event.data, pendingRefs, attachStore, supportsImages)
            } else {
                messages += "{\"role\":\"user\",\"content\":\"${jsonEscapeText(event.data)}\"}"
            }
            pendingRefs = ArrayList<AttachmentRef>()
        } else {
            messages += "{\"role\":\"${role}\",\"content\":\"${jsonEscapeText(event.data)}\"}"
        }
    }
    if (pending.size > 0) { throw Exception("unsettled-model-tool-calls") }
    var definitions = ""
    for (tool in tools) {
        // 参数 schema 必须是 JSON 对象，不将旧空格参数声明冒充模型 schema。
        JsonValue.fromStr(tool.params).asObject()
        if (definitions.size > 0) { definitions += "," }
        definitions += "{\"type\":\"function\",\"function\":{\"name\":\"${jsonEscapeText(tool.name)}\",\"description\":\"${jsonEscapeText(tool.description)}\",\"parameters\":${tool.params}}}"
    }
    let toolsPart = if (definitions.size > 0) { ",\"tools\":[${definitions}]" } else { "" }
    return "{\"model\":\"${jsonEscapeText(model)}\",\"messages\":[${messages}],\"stream\":true,\"stream_options\":{\"include_usage\":true}${toolsPart}}"
}

// 带引用事件的 user/message 走多 part 形态：文字一条，图片按引用顺序各一条。
// 通用文件没有 provider 侧通道，所以不把它塞成 vision part（引用依旧留在日志里）。
func userMessageWithRefs(text: String, refs: ArrayList<AttachmentRef>, attachStore: ?AttachmentStore, supportsImages: Bool): String {
    var parts = "{\"type\":\"text\",\"text\":\"${jsonEscapeText(text)}\"}"
    for (ref in refs) {
        if (ref.kind != "image") {
            continue
        }
        // 能力来自调用方解析的模型声明；缺声明不能凭模型名猜，更不能静默删图。
        if (!supportsImages) { throw Exception("model-image-not-supported") }
        if (let Some(store) <- attachStore) {
            let data = store.read(ref.attachmentId)
            parts += ",{\"type\":\"image_url\",\"image_url\":{\"url\":\"data:${jsonEscapeText(ref.mediaType)};base64,${toBase64String(data)}\"}}"
        } else {
            // 有引用却没有附件仓：宁可整轮失败，也不让模型看到一条被悄悄阉割的消息。
            throw Exception("attachment-store-absent")
        }
    }
    return "{\"role\":\"user\",\"content\":[${parts}]}"
}
