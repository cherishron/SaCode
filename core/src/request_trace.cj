package core

import std.io.*
import std.time.*
import stdx.encoding.json.*

func requestTraceTicks(): () -> Int64 {
    let base = MonoTime.now()
    return { => (MonoTime.now() - base).toMilliseconds() }
}

// 请求观察器只接受正文，凭据由调用方闭包持有。记录白名单元数据，不持久化历史或图片字节。
// request/header 沿用上游「配置/工具不含系统提示」边界；request/prompt 是 SaCode 的只读取证扩展。
public class RequestTraceProvider <: Provider & Resource {
    let request: String
    let providerId: String
    let log: SessionLog
    let token: TurnToken
    let factory: (String) -> Provider
    let now: () -> Int64
    let ticks: () -> Int64
    let header: JsonObject
    let prompts: JsonArray
    var inner: ?Provider = None
    var requestSeq = Int64(-1)
    var started = Int64(0)
    var firstToken: ?Int64 = None
    var usage: ?String = None
    var ended = false
    var closed = false

    public init(request: String, providerId: String, log: SessionLog, token: TurnToken,
        factory: (String) -> Provider, now!: () -> Int64 = { => DateTime.nowUTC().toUnixTimeStamp().toMilliseconds() },
        ticks!: () -> Int64 = requestTraceTicks()) {
        this.request = request; this.providerId = providerId; this.log = log; this.token = token
        this.factory = factory; this.now = now; this.ticks = ticks
        let body = JsonValue.fromStr(request).asObject()
        let config = JsonObject()
        config.put("provider", JsonString(providerId))
        config.put("model", body.get("model").getOrThrow())
        for (key in ["temperature", "top_p", "max_tokens", "max_completion_tokens", "reasoning_effort", "tool_choice", "parallel_tool_calls"]) {
            if (let Some(value) <- body.get(key)) { config.put(key, value) }
        }
        let snapshot = JsonObject(); snapshot.put("config", config)
        snapshot.put("tools", body.get("tools") ?? JsonArray())
        this.header = snapshot
        let recorded = JsonArray()
        let messages = body.get("messages").getOrThrow().asArray()
        var i = Int64(0)
        while (let Some(value) <- messages.get(i)) {
            let message = value.asObject()
            let role = message.get("role").getOrThrow().asString().getValue()
            if (role == "system" || role == "developer") {
                // 当前共享请求构造器的提示是纯文本；未知结构拒绝，不能伪造为完整快照。
                let content = message.get("content").getOrThrow().asString().getValue()
                let prompt = JsonObject(); prompt.put("role", JsonString(role)); prompt.put("content", JsonString(content))
                recorded.add(prompt)
            }
            i += 1
        }
        this.prompts = recorded
    }

    private func begin(): Unit {
        started = ticks()
        var turn = Int64(-1)
        var step = Int64(0)
        for (event in log.snapshotEvents()) {
            if (event.eventType == "turn/start") { turn = event.seq; step = 0 }
            if (event.eventType == "request/header") { step += 1 }
        }
        let record = JsonObject()
        record.put("version", JsonInt(1)); record.put("time", JsonInt(now()))
        record.put("turnSeq", if (turn < 0) { JsonNull() } else { JsonInt(turn) })
        record.put("step", JsonInt(step)); record.put("reason", JsonString(if (step == 0) { "initial" } else { "series" }))
        record.put("header", header)
        requestSeq = log.append("request/header", record.toString()).seq
        let prompt = JsonObject(); prompt.put("requestSeq", JsonInt(requestSeq)); prompt.put("messages", prompts)
        log.append("request/prompt", prompt.toString())
    }

    private func finish(state: String, reason: String): Unit {
        if (requestSeq < 0 || ended) { return }
        ended = true
        let record = JsonObject()
        record.put("requestSeq", JsonInt(requestSeq)); record.put("time", JsonInt(now()))
        record.put("durationMs", JsonInt(max(Int64(0), ticks() - started)))
        record.put("ttftMs", if (let Some(value) <- firstToken) { JsonInt(value) } else { JsonNull() })
        record.put("state", JsonString(state)); record.put("finishReason", JsonString(reason))
        record.put("usageTokens", if (let Some(value) <- usage) { JsonString(value) } else { JsonNull() })
        log.append("request/end", record.toString())
    }

    public func next(): ?Chunk {
        if (closed || ended) { return None }
        if (token.cancelled()) { close(); return None }
        try {
            if (inner.isNone()) { begin(); inner = Some(factory(request)) }
            if (let Some(chunk) <- inner.getOrThrow().next()) {
                let elapsed = max(Int64(0), ticks() - started)
                if (firstToken.isNone() && ((chunk.kind == "text" && chunk.text.size > 0) || chunk.kind == "tool-call-delta")) { firstToken = Some(elapsed) }
                if (chunk.kind == "usage") { usage = Some(chunk.text) }
                if (chunk.kind == "finish") {
                    finish(if (token.cancelled()) { "cancelled" } else { if (chunk.reason == "stop" || chunk.reason == "tool_calls") { "completed" } else { "interrupted" } }, chunk.reason)
                }
                return Some(Chunk(chunk.kind, chunk.text, chunk.reason, choiceIndex: chunk.choiceIndex,
                    toolIndex: chunk.toolIndex, toolId: chunk.toolId, toolName: chunk.toolName,
                    requestSeq: Some(requestSeq), elapsedMs: Some(elapsed)))
            }
            finish(if (token.cancelled()) { "cancelled" } else { "interrupted" }, "eof")
            close()
            return None
        } catch (_: Exception) {
            finish(if (token.cancelled()) { "cancelled" } else { "failed" }, "provider-error")
            close()
            // 外部 SDK 的异常正文可能含连接配置，不能被模型循环抄进持久日志。
            throw Exception("request-provider-failed")
        }
    }

    public func close(): Unit {
        if (closed) { return }
        closed = true
        finish(if (token.cancelled()) { "cancelled" } else { "interrupted" }, "closed")
        if (let Some(value) <- inner) { if (let Some(resource) <- (value as Resource)) { resource.close() } }
    }
    public func isClosed(): Bool { return closed }
}

// 只从日志回放请求证据；没有请求头的旧历史不会获得推测出的配置或提示词。
// beforeSeq 是稳定的事件序号，-1 表示最新尾页；最多 50 个请求。
public func requestTraceProjection(events: Array<SessionEvent>, beforeSeq!: Int64 = -1, limit!: Int64 = 50): String {
    if (beforeSeq < -1 || limit < 1 || limit > 50) { throw Exception("bad-trace-page") }
    let selected = JsonArray()
    var headers = Int64(0)
    for (event in events) { if (event.eventType == "request/header" && (beforeSeq < 0 || event.seq < beforeSeq)) { headers += 1 } }
    let skip = max(Int64(0), headers - limit)
    var index = Int64(0)
    var earliest = Int64(-1)
    for (event in events) {
        if (event.eventType != "request/header" || (beforeSeq >= 0 && event.seq >= beforeSeq)) { continue }
        index += 1
        if (index <= skip) { continue }
        if (earliest < 0) { earliest = event.seq }
        let record = JsonObject()
        record.put("seq", JsonInt(event.seq)); record.put("request", JsonValue.fromStr(event.data))
        record.put("prompts", JsonNull()); record.put("end", JsonNull())
        var output = ""
        let calls = JsonArray()
        for (part in events) {
            if (part.seq <= event.seq) { continue }
            if (part.eventType == "request/header") { break }
            if (part.eventType == "request/prompt" || part.eventType == "request/end" || part.eventType == "stream/chunk") {
                let obj = JsonValue.fromStr(part.data).asObject()
                let owner = obj.get("requestSeq")
                if (owner.isNone() || owner.getOrThrow().asInt().getValue() != event.seq) { continue }
                if (part.eventType == "request/prompt") { record.put("prompts", obj.get("messages").getOrThrow()) }
                if (part.eventType == "request/end") { record.put("end", obj) }
                if (part.eventType == "stream/chunk" && obj.get("kind").getOrThrow().asString().getValue() == "text") {
                    output += obj.get("text").getOrThrow().asString().getValue()
                }
            }
            if (part.eventType == "tool/call") { calls.add(JsonValue.fromStr(part.data)) }
        }
        record.put("output", JsonString(output)); record.put("toolCalls", calls)
        selected.add(record)
    }
    let result = JsonObject(); result.put("requests", selected)
    result.put("beforeSeq", if (earliest >= 0) { JsonInt(earliest) } else { JsonNull() })
    result.put("more", JsonBool(skip > 0))
    return result.toString()
}
