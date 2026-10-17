package core

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
    let metadataOnly: Bool
    var inner: ?Provider = None
    var requestSeq = Int64(-1)
    var started = Int64(0)
    var firstToken: ?Int64 = None
    var usage: ?String = None
    var ended = false
    var closed = false

    public init(request: String, providerId: String, log: SessionLog, token: TurnToken,
        factory: (String) -> Provider, now!: () -> Int64 = { => DateTime.nowUTC().toUnixTimeStamp().toMilliseconds() },
        ticks!: () -> Int64 = requestTraceTicks(), metadataOnly!: Bool = false) {
        this.metadataOnly = metadataOnly
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
        // 生产审计只记录白名单元数据，不复制工具描述或提示词正文。
        if (!metadataOnly) { snapshot.put("tools", body.get("tools") ?? JsonArray()) }
        this.header = snapshot
        let recorded = JsonArray()
        let messages = body.get("messages").getOrThrow().asArray()
        var i = Int64(0)
        while (let Some(value) <- messages.get(i)) {
            let message = value.asObject()
            let role = message.get("role").getOrThrow().asString().getValue()
            if (!metadataOnly && (role == "system" || role == "developer")) {
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
        if (!metadataOnly) {
            let prompt = JsonObject(); prompt.put("requestSeq", JsonInt(requestSeq)); prompt.put("messages", prompts)
            log.append("request/prompt", prompt.toString())
        }
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
        } catch (e: Exception) {
            // 红脱敏：只把「HTTP 状态码 + 粗类目」记入 request/end，绝不写原始异常文案。
            // 原始异常可能含连接配置/请求片段，已在上游各层脱敏，这里再次收窄到稳定类目。
            let classified = classifyProviderError(e.message)
            let reason = if (classified[0] == "provider-error") { "provider-error" }
                else if (classified[1] > 0) { "provider-error:${classified[0]}:${classified[1]}" }
                else { "provider-error:${classified[0]}" }
            finish(if (token.cancelled()) { "cancelled" } else { "failed" }, reason)
            close()
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

// 红脱敏错误分类：只从异常文案里识别「HTTP 状态码 + 粗类目」，绝不写出原始异常正文。
// 异常到此已是上游各层脱敏后的稳定形态（http-status:<n> / http-request-error[:reason] / 短码），
// 这里再次收窄到 rate-limit / server / client / connection / timeout，认不出退回笼统 provider-error。
func classifyProviderError(message: String): (String, Int64) {
    let raw = message.trimAscii().toAsciiLower()
    if (raw.startsWith("http-status:")) {
        if (let Some(status) <- parseStatusDigits(raw[12..])) {
            let category = if (status == 429) { "rate-limit" }
                else if (status >= 500 && status <= 599) { "server" }
                else if (status >= 400 && status <= 499) { "client" }
                else { "server" }
            return (category, status)
        }
        return ("server", -1)
    }
    if (raw.startsWith("http-request-error:")) {
        let reason = raw[19..]
        if (reason.contains("rate") || reason.contains("ratelimit")) { return ("rate-limit", -1) }
        if (reason.contains("timeout")) { return ("timeout", -1) }
        if (reason.contains("connection") || reason.contains("dns") || reason.contains("tls") ||
            reason.contains("refused") || reason.contains("reset") || reason.contains("handshake") ||
            reason.contains("certificate")) { return ("connection", -1) }
        return ("connection", -1)
    }
    if (raw == "http-request-error") { return ("connection", -1) }
    if (raw == "timeout") { return ("timeout", -1) }
    if (raw == "read-error") { return ("connection", -1) }
    if (raw == "upstream-error") { return ("server", -1) }
    if (raw == "protocol-error" || raw == "line-limit" || raw == "event-limit") { return ("provider-error", -1) }
    return ("provider-error", -1)
}

// 仅解析十进制状态码，非数字或超长一律退回 None，绝不抛异常。
func parseStatusDigits(text: String): Option<Int64> {
    let bs = text.toArray()
    if (bs.size == 0 || bs.size > 4) { return None }
    var value: Int64 = 0
    for (b in bs) {
        if (b < 48 || b > 57) { return None }
        value = value * 10 + Int64(b - 48)
    }
    return Some(value)
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
