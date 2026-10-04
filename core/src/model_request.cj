package core
import std.collection.ArrayList
import stdx.encoding.json.*

// 标准消息与具有关联 ID 的工具结果全部从同一会话日志重建。
public func modelRequestJson(model: String, events: Array<SessionEvent>, tools!: Array<ToolSpec> = []): String {
    var messages = ""
    let pending = ArrayList<String>()
    for (event in events) {
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
        messages += "{\"role\":\"${role}\",\"content\":\"${jsonEscapeText(event.data)}\"}"
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
