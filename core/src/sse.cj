package core

import std.io.*
import std.collection.ArrayList
import stdx.net.http.*
import stdx.net.tls.*
import stdx.encoding.json.*

// 结构化打开结果：要么给出可用的 provider，要么给出结构化失败。
// 与构造器的抛出路径并存——既有调用方按 message 断言，不改它们的行为。
public class SseOpenResult {
    public let provider: Option<RealSseProvider>
    public let failure: Option<TransportFailure>
    init(provider: Option<RealSseProvider>, failure: Option<TransportFailure>) {
        this.provider = provider
        this.failure = failure
    }
}

// 读错误响应体用于摘要：上限 8KB，只保留可打印 ASCII（错误体可能含非 UTF-8 字节，
// 直接 String.fromUtf8 会抛；摘要只供日志阅读，转义是可接受的降级）。
func drainSummary(stream: InputStream, cap: Int64): String {
    let buf = Array<UInt8>(4096, repeat: 0)
    let all = ArrayList<Byte>()
    while (Int64(all.size) < cap) {
        let n = stream.read(buf)
        if (n <= 0) { break }
        var i: Int64 = 0
        while (i < n && Int64(all.size) < cap) {
            let b = buf[i]
            all.add(if (b < 32 || b >= 127) { UInt8(46) } else { b })
            i += 1
        }
    }
    return String.fromUtf8(all.toArray())
}

// 真实 SSE provider：默认验证证书，逐事件解析并排队全部增量。
// 读异常显式失败；取消优先于缓冲，usage 总量先于延迟交付的 finish。
public class RealSseProvider <: Provider & Resource {
    let token: TurnToken
    var body: InputStream
    let buf = Array<UInt8>(8192, repeat: 0)
    var lineBuf = ArrayList<UInt8>()
    var clientOpt: Option<Client> = None
    var responseOpt: Option<HttpResponse> = None
    var finished = false
    var closed = false
    var resourceClosed = false
    var terminal = "open"
    var failure = ""
    var receivedDone = false
    var payload = ""
    var hasData = false
    let pending = ArrayList<Chunk>()
    var pendingIndex: Int64 = 0
    var usage: Option<Int64> = None
    var finish: Option<String> = None
    public prop termination: String { get() { terminal } }
    public prop errorCode: String { get() { failure } }
    public prop doneReceived: Bool { get() { receivedDone } }

    // 生产构造器：发真实 HTTPS POST
    // 生产默认仍为 30 秒；请求级超时覆盖客户端配置，取消最迟在读返回后检查。
    // 失败仍在构造期抛（message 形态 http-status:<n> / http-request-error 不变，
    // 既有网络用例按该形态断言）；要拿结构化失败详情的调用方走 open()。
    public init(baseUrl: String, apiKey: String, requestJsonBody: String, token: TurnToken,
        readTimeout!: Duration = Duration.second * 30) {
        let opened = RealSseProvider.open(baseUrl, apiKey, requestJsonBody, token, readTimeout: readTimeout)
        if (let Some(f) <- opened.failure) {
            throw Exception(f.message())
        }
        let p = opened.provider.getOrThrow()
        this.token = token
        this.body = p.body
        this.clientOpt = p.clientOpt
        this.responseOpt = p.responseOpt
    }

    // 私有装配构造器：只给 open() 用
    private init(token: TurnToken, body: InputStream, client: Option<Client>, resp: Option<HttpResponse>) {
        this.token = token
        this.body = body
        this.clientOpt = client
        this.responseOpt = resp
    }

    // 结构化打开：非 200 时**先读白名单头与正文摘要、再关响应**——
    // 原实现是先 close 再抛，响应头与正文都拿不到（§5.2 实测三段全缺的第一段），
    // 于是「遵守供应商恢复时间」只能由夹具喂绿。
    public static func open(baseUrl: String, apiKey: String, requestJsonBody: String, token: TurnToken,
        readTimeout!: Duration = Duration.second * 30): SseOpenResult {
        let c = ClientBuilder().tlsConfig(TlsClientConfig()).autoRedirect(false).build()
        var opened: Option<HttpResponse> = None
        try {
            let req = HttpRequestBuilder().post().url("${baseUrl}/chat/completions")
                .header("Authorization", "Bearer ${apiKey}")
                .header("Content-Type", "application/json")
                .body(requestJsonBody).readTimeout(readTimeout).build()
            let resp = c.send(req)
            opened = Some(resp)
            if (resp.status != 200) {
                let status = Int64(resp.status)
                // 只取白名单头，逐个点名（不遍历全部响应头：失败对象会落日志，
                // 不能变成第二条凭据通道）。
                // 顺序说明（2026-10-05 变异实测）：把 close() 提前到读取之前，
                // 本机 stdx 仍能读出 headers 与缓冲体（HttpBufferedBody），
                // 所以「先读后关」不构成可断言的不变量——真正的增量是把
                // 供应商证据**取出来并结构化**，而不是读取时序。此处仍按
                // 先读后关写，避免依赖 close 的实现细节。
                var pairs = ArrayList<(String, String)>()
                for (name in failureHeaderWhitelist) {
                    if (let Some(v) <- resp.headers.getFirst(name)) {
                        pairs.add((name, v))
                    }
                }
                let kept = whitelistedHeaders(pairs.toArray())
                let raw = drainSummary(resp.body, 8192)
                let redacted = redactBody(raw)
                try { resp.close() } catch (_: Exception) {}
                try { c.close() } catch (_: Exception) {}
                return SseOpenResult(None, Some(failureOf("http-status", true, status: status,
                    retryAfterSeconds: retryAfterFromHeaders(kept, 0), bodyLen: redacted[0],
                    summary: "http-status:${status}")))
            }
            return SseOpenResult(Some(RealSseProvider(token, resp.body, Some(c), Some(resp))), None)
        } catch (e: Exception) {
            try { c.close() } catch (_: Exception) {}
            if (let Some(resp) <- opened) {
                try { resp.close() } catch (_: Exception) {}
            }
            // 连接类失败：本批还分不出「未上线」与「已上线」（连接被拒/DNS/TLS 与
            // 读超时在异常文案里同名），如实标 unattributed 且 reachedUpstream=false，
            // 由 §5.2 末行口径不进任何一档计数——不默认算成模型故障。
            return SseOpenResult(None, Some(failureOf("transport", false, summary: "http-request-error")))
        }
    }

    // 测试构造器：直接包装 InputStream（绕过 HTTP）
    public init(body: InputStream, token: TurnToken) {
        this.token = token
        this.body = body
        this.clientOpt = None
    }

    public func next(): Option<Chunk> {
        while (true) {
            if (token.cancelled()) {
                terminal = "cancelled"
                finished = true
                pending.clear()
                lineBuf.clear()
                closeResources()
                return None
            }
            if (failure.size > 0) { throw Exception(failure) }
            if (closed) { return None }
            if (pendingIndex < pending.size) {
                let ch = pending[pendingIndex]
                pendingIndex += 1
                return Some(ch)
            }
            pending.clear()
            pendingIndex = 0
            if (finished) { return None }
            if (let Some(line) <- tryExtractLine()) {
                processLine(line)
                continue
            }
            if (lineBuf.size > 262144) { fail("line-limit") }
            let n = readChunk()
            if (token.cancelled()) { continue }
            if (n < 0 || n > buf.size) { fail("read-error") }
            if (n == 0) {
                if (lineBuf.size > 0) {
                    let last = toArray(lineBuf)
                    lineBuf.clear()
                    try { processLine(String.fromUtf8(last)) }
                    catch (_: Exception) {
                        if (failure.size > 0) { throw Exception(failure) }
                        fail("protocol-error")
                    }
                }
                if (!finished && hasData) { dispatch() }
                if (!finished) { complete(false) }
            } else {
                for (i in 0..n) { lineBuf.add(buf[i]) }
            }
        }
        return None
    }

    func fail(code: String): Nothing {
        failure = code
        terminal = "error"
        finished = true
        pending.clear()
        lineBuf.clear()
        payload = ""
        closeResources()
        throw Exception(code)
    }

    func readChunk(): Int64 {
        try { return body.read(buf) }
        catch (_: HttpTimeoutException) {
            if (token.cancelled()) { return 0 }
            fail("timeout")
        } catch (_: TimeoutException) {
            if (token.cancelled()) { return 0 }
            fail("timeout")
        } catch (_: Exception) {
            if (token.cancelled()) { return 0 }
            fail("read-error")
        }
    }

    // 从 lineBuf 里找第一个 \n，切出一行（去掉 \r\n），剩余留在 lineBuf
    func tryExtractLine(): Option<String> {
        var i: Int64 = 0
        while (i < Int64(lineBuf.size)) {
            if (lineBuf[i] == 10) { // \n
                if (i > 262144) { fail("line-limit") }
                let lineBytes = extractAndShift(i)
                try { return Some(String.fromUtf8(lineBytes)) }
                catch (_: Exception) { fail("protocol-error") }
            }
            i += 1
        }
        return None
    }

    // 从 lineBuf 取出 [0, end) 的字节（去掉尾部 \r），将 [end+1, size) 留在 lineBuf
    func extractAndShift(end: Int64): Array<UInt8> {
        var actualEnd = end
        if (actualEnd > 0 && lineBuf[actualEnd - 1] == 13) { // \r
            actualEnd -= 1
        }
        let out = Array<UInt8>(actualEnd, repeat: 0)
        for (j in 0..actualEnd) {
            out[j] = lineBuf[j]
        }
        let remaining = ArrayList<UInt8>()
        var i = end + 1
        while (i < Int64(lineBuf.size)) {
            remaining.add(lineBuf[i])
            i += 1
        }
        lineBuf = remaining
        return out
    }

    func processLine(line: String) {
        if (line.size > 262144) { fail("line-limit") }
        if (line.size == 0) {
            if (hasData) { dispatch() }
            return
        }
        if (line.startsWith(":")) { return }
        if (line == "data" || line.startsWith("data:")) {
            var value = if (line == "data") { "" } else { line[5..] }
            if (value.startsWith(" ")) { value = value[1..] }
            if (payload.size + value.size + 1 > 1048576) { fail("event-limit") }
            if (hasData) { payload += "\n" }
            payload += value
            hasData = true
        }
    }

    func dispatch() {
        let data = payload
        payload = ""
        hasData = false
        if (data.trimAscii() == "[DONE]") { complete(true); return }
        try { parsePayload(data) }
        catch (_: Exception) {
            if (failure.size > 0) { throw Exception(failure) }
            fail("protocol-error")
        }
    }

    func enqueue(ch: Chunk) {
        if (pending.size >= 1024) { fail("event-limit") }
        pending.add(ch)
    }

    func complete(done: Bool) {
        receivedDone = done
        if (done && finish.isNone()) { fail("protocol-error") }
        finished = true
        terminal = if (done) { "done" } else { "eof" }
        lineBuf.clear()
        if (let Some(n) <- usage) { enqueue(Chunk("usage", "${n}", "")) }
        if (let Some(reason) <- finish) { enqueue(Chunk("finish", "", reason, choiceIndex: Some(0))) }
        closeResources()
    }

    func isNull(v: JsonValue): Bool {
        match (v.kind()) { case JsNull => true; case _ => false }
    }

    func integer(obj: JsonObject, key: String): Option<Int64> {
        if (let Some(v) <- obj.get(key)) {
            if (isNull(v)) { return None }
            let n = v.asInt().getValue()
            if (n < 0) { fail("protocol-error") }
            return Some(n)
        }
        return None
    }

    func stringField(obj: JsonObject, key: String): Option<String> {
        if (let Some(v) <- obj.get(key)) {
            if (isNull(v)) { return None }
            return Some(v.asString().getValue())
        }
        return None
    }

    // 单响应选择 index=0；旧端点缺 index 视为 0，其他 choice 跳过不拼接。
    func parsePayload(data: String) {
        let obj = JsonValue.fromStr(data).asObject()
        if (let Some(err) <- obj.get("error")) {
            if (!isNull(err)) { fail("upstream-error") }
        }
        var recognized = false
        if (let Some(v) <- obj.get("usage")) {
            recognized = true
            if (!isNull(v)) {
                let u = v.asObject()
                if (let Some(n) <- integer(u, "total_tokens")) { usage = Some(n) }
                else {
                    let pt = integer(u, "prompt_tokens")
                    let ct = integer(u, "completion_tokens")
                    if (pt.isNone() || ct.isNone()) { fail("protocol-error") }
                    let p = pt.getOrThrow()
                    let c = ct.getOrThrow()
                    if (p > Int64.Max - c) { fail("protocol-error") }
                    usage = Some(p + c)
                }
            }
        }
        if (let Some(v) <- obj.get("choices")) {
            recognized = true
            var selected = false
            let choices = v.asArray()
            var pos: Int64 = 0
            while (let Some(item) <- choices.get(pos)) {
                pos += 1
                let choice = item.asObject()
                if ((integer(choice, "index") ?? 0) != 0) { continue }
                if (selected) { fail("protocol-error") }
                selected = true
                parseChoice(choice)
            }
        }
        if (!recognized) { fail("protocol-error") }
    }

    func parseChoice(choice: JsonObject) {
        if (let Some(v) <- choice.get("delta")) {
            let delta = v.asObject()
            if (let Some(text) <- stringField(delta, "content")) {
                if (text.size > 0) {
                    if (finish.isSome()) { fail("protocol-error") }
                    enqueue(Chunk("text", text, "", choiceIndex: Some(0)))
                }
            }
            if (let Some(vt) <- delta.get("tool_calls")) {
                let tools = vt.asArray()
                var pos: Int64 = 0
                while (let Some(item) <- tools.get(pos)) {
                    pos += 1
                    if (finish.isSome()) { fail("protocol-error") }
                    let tc = item.asObject()
                    let index = integer(tc, "index")
                    if (index.isNone()) { fail("protocol-error") }
                    let id = stringField(tc, "id")
                    var name: Option<String> = None
                    var args = ""
                    if (let Some(fn) <- tc.get("function")) {
                        let f = fn.asObject()
                        name = stringField(f, "name")
                        args = stringField(f, "arguments") ?? ""
                    }
                    // arguments 原串；空分片也保留首帧 id/name。
                    enqueue(Chunk("tool-call-delta", args, "", choiceIndex: Some(0),
                        toolIndex: index, toolId: id, toolName: name))
                }
            }
        }
        if (let Some(reason) <- stringField(choice, "finish_reason")) {
            if (reason.size == 0 || finish.isSome()) { fail("protocol-error") }
            finish = Some(if (reason == "length") { "max-tokens" } else { reason })
        }
    }

    func closeResources() {
        if (resourceClosed) { return }
        resourceClosed = true
        if (let Some(r) <- responseOpt) {
            try { r.close() } catch (_: Exception) {}
        } else if (let Some(r) <- (body as Resource)) {
            try { r.close() } catch (_: Exception) {}
        }
        if (let Some(c) <- clientOpt) { try { c.close() } catch (_: Exception) {} }
    }

    public func isClosed(): Bool { resourceClosed }

    public func close() {
        if (closed) { return }
        closed = true
        if (terminal == "open") { terminal = "closed" }
        pending.clear()
        lineBuf.clear()
        payload = ""
        closeResources()
    }
}

func toArray(b: ArrayList<UInt8>): Array<UInt8> {
    let arr = Array<UInt8>(b.size, repeat: 0)
    for (i in 0..b.size) {
        arr[i] = b[i]
    }
    return arr
}
