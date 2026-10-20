package core
import std.collection.*
import stdx.encoding.json.*

// 只按日志中的标准工具 ID 配对，不从显示正文推测工具名称或完成状态。
public class ToolCallProjection {
    public let id: String
    public let eventSeq: Int64
    public let callId: String
    public let name: String
    public let arguments: String
    public var resultMessageId = ""
    public var status = "running"
    public var result = ""
    public init(seq: Int64, callId: String, name: String, arguments: String) {
        id = "tool-event-${seq}"
        eventSeq = seq
        this.callId = callId; this.name = name; this.arguments = arguments
    }
    public func toJson(): String {
        let obj = JsonObject()
        obj.put("id", JsonString(id)); obj.put("callId", JsonString(callId))
        obj.put("eventSeq", JsonInt(eventSeq))
        obj.put("name", JsonString(name)); obj.put("arguments", JsonString(arguments))
        obj.put("resultMessageId", JsonString(resultMessageId)); obj.put("status", JsonString(status))
        // 正文已在 messageRows 中，关联元数据不重复携带大文件或截图说明。
        return obj.toString()
    }
}

func projectedToolResultStatus(content: String): String {
    // 模型工具执行器把拒绝/失败编码成标准结果对象的 error 字段。
    // 非 JSON 正文或成功 JSON 都不是错误；不解析 ok:/denied: 等显示前缀。
    try {
        let obj = JsonValue.fromStr(content).asObject()
        if (let Some(value) <- obj.get("error")) {
            var reason = ""
            try { reason = value.asString().getValue() } catch (_: Exception) { return "failed" }
            if (reason == "cancelled") { return "cancelled" }
            if (reason == "approval-denied" || reason == "approval-mode-denied" || reason == "approval-not-granted:denied" || reason == "approval-not-allowed-once" || reason == "guard-denied") { return "denied" }
            return "failed"
        }
    } catch (_: Exception) {}
    return "completed"
}

public func projectToolCalls(events: Array<SessionEvent>, active!: Bool = false): ArrayList<ToolCallProjection> {
    let calls = ArrayList<ToolCallProjection>()
    var pending = HashMap<String, ToolCallProjection>()
    for (event in events) {
        if (event.eventType == "turn/start" || event.eventType == "turn/end" || event.eventType == "turn/cancelled") {
            // 重启/终态不替没有结果的调用捏造成功，也不跨轮复用模型 ID。
            for ((_, call) in pending) { call.status = "unknown" }
            pending = HashMap<String, ToolCallProjection>()
        } else if (event.eventType == "tool/call") {
            try {
                let obj = JsonValue.fromStr(event.data).asObject()
                let id = obj.get("id").getOrThrow().asString().getValue()
                let fn = obj.get("function").getOrThrow().asObject()
                let name = fn.get("name").getOrThrow().asString().getValue()
                let args = fn.get("arguments").getOrThrow().asString().getValue()
                if (id.size == 0 || name.size == 0) { continue }
                if (let Some(previous) <- pending.get(id)) { previous.status = "unknown" }
                let call = ToolCallProjection(event.seq, id, name, args)
                pending[id] = call; calls.add(call)
            } catch (_: Exception) { /* 旧版无身份调用保持为历史消息，不猜关联。 */ }
        } else if (event.eventType == "tool/result") {
            if (let Some(wire) <- modelWireMessage(event.data)) {
                try {
                    let obj = JsonValue.fromStr(wire).asObject()
                    let id = obj.get("tool_call_id").getOrThrow().asString().getValue()
                    if (let Some(call) <- pending.get(id)) {
                        if (call.resultMessageId.size > 0) { continue }
                        call.resultMessageId = "event-${event.seq}"
                        call.result = obj.get("content").getOrThrow().asString().getValue()
                        call.status = projectedToolResultStatus(call.result)
                        pending.remove(id)
                    }
                } catch (_: Exception) { /* 损坏的关联不污染其他调用。 */ }
            }
        }
    }
    if (!active) { for ((_, call) in pending) { call.status = "unknown" } }
    return calls
}
