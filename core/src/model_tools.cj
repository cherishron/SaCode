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
            if (call.id.size > 0 && call.id != id) { throw Exception("conflicting-tool-id") }
            call.id = id
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

public func modelToolResultData(id: String, content: String): String {
    return modelWireData("{\"role\":\"tool\",\"tool_call_id\":\"${jsonEscapeText(id)}\",\"content\":\"${jsonEscapeText(content)}\"}")
}
