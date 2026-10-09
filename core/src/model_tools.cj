package core
import std.collection.ArrayList
import stdx.encoding.json.*

// 关联工具调用留在标准 assistant/message 中，保持模型历史可由日志重建。
let modelWirePrefix = "\u{001e}SaCodeModel/1:"
public func modelWireData(message: String): String { return modelWirePrefix + message }
public func modelWireMessage(data: String): Option<String> {
    if (data.startsWith(modelWirePrefix)) { return Some(data[modelWirePrefix.size..data.size]) }
    return None
}
public func modelSurfaceText(data: String): String {
    if (let Some(wire) <- modelWireMessage(data)) {
        try {
            let obj = JsonValue.fromStr(wire).asObject()
            return obj.get("content").getOrThrow().asString().getValue()
        } catch (_: Exception) {}
    }
    return data
}

public class ModelToolCall {
    public let index: Int64
    public var id = ""
    public var name = ""
    public var args = ""
    public init(index: Int64) { this.index = index }
    public func wireJson(): String {
        return "{\"id\":\"${jsonEscapeText(id)}\",\"type\":\"function\",\"function\":{\"name\":\"${jsonEscapeText(name)}\",\"arguments\":\"${jsonEscapeText(args)}\"}}"
    }
}

// 索引装配，不把分片误认成多次调用；取消/长度截断时调用方不得执行这些参数。
public class ModelToolCalls {
    let calls = ArrayList<ModelToolCall>()
    public func push(chunk: Chunk): Unit {
        let index = chunk.toolIndex.getOrThrow()
        if (index < 0 || index >= 32 || (chunk.choiceIndex ?? 0) != 0) { throw Exception("bad-tool-index") }
        var found: Option<ModelToolCall> = None
        for (call in calls) { if (call.index == index) { found = Some(call) } }
        let call = if (let Some(previous) <- found) { previous } else {
            let fresh = ModelToolCall(index)
            calls.add(fresh)
            fresh
        }
        if (let Some(id) <- chunk.toolId) {
            // StepFun 的续片显式携带空 id；它表示该帧不提供身份，不能清空首帧 ID。
            // 不同的非空 ID 仍拒绝，全部帧都无身份则由 complete 拒绝。
            if (id.size > 0) {
                if (call.id.size > 0 && call.id != id) { throw Exception("conflicting-tool-id") }
                call.id = id
            }
        }
        if (let Some(name) <- chunk.toolName) { call.name += name }
        call.args += chunk.text
        if (call.args.size > 1048576 || call.name.size > 256 || call.id.size > 256) { throw Exception("tool-call-limit") }
    }
    public func complete(): Array<ModelToolCall> {
        let ordered = ArrayList<ModelToolCall>()
        for (index in 0..calls.size) {
            var found = false
            for (call in calls) {
                if (call.index != index) { continue }
                if (call.id.size == 0 || call.name.size == 0) { throw Exception("incomplete-tool-call") }
                for (previous in ordered) { if (previous.id == call.id) { throw Exception("duplicate-tool-id") } }
                ordered.add(call)
                found = true
            }
            if (!found) { throw Exception("incomplete-tool-index") }
        }
        return ordered.toArray()
    }
}

// refs 只随日志内部字段落盘，不进 provider 的工具消息 schema：截图字节归附件仓，
// 工具结果本体仍是字符串，重放时由请求侧按引用重新物化。
public func modelToolResultData(id: String, content: String, refs!: ArrayList<AttachmentRef> = ArrayList()): String {
    let attachments = JsonArray()
    for (ref in refs) { attachments.add(ref.toJsonObject()) }
    let extra = if (refs.size > 0) { ",\"attachments\":${attachments.toString()}" } else { "" }
    return modelWireData("{\"role\":\"tool\",\"tool_call_id\":\"${jsonEscapeText(id)}\",\"content\":\"${jsonEscapeText(content)}\"${extra}}")
}
