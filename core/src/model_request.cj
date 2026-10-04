package core

// 从会话真源装配模型上下文。只接收标准消息事件，不将内部控制、审批、
// 流式增量或缺少 tool_call_id 的工具结果冒充 provider 对话消息。
public func modelRequestJson(model: String, events: Array<SessionEvent>): String {
    var messages = ""
    for (event in events) {
        var role = ""
        if (event.eventType == "system/message") { role = "system" }
        else if (event.eventType == "developer/message") { role = "developer" }
        else if (event.eventType == "user/message") { role = "user" }
        else if (event.eventType == "assistant/message") { role = "assistant" }
        if (role.size == 0) { continue }
        if (messages.size > 0) { messages += "," }
        messages += "{\"role\":\"${role}\",\"content\":\"${jsonEscapeText(event.data)}\"}"
    }
    return "{\"model\":\"${jsonEscapeText(model)}\",\"messages\":[${messages}],\"stream\":true,\"stream_options\":{\"include_usage\":true}}"
}
