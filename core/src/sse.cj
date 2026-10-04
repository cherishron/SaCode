package core

import std.io.*
import std.collection.ArrayList
import stdx.net.http.*
import stdx.net.tls.*
import stdx.encoding.json.*

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
    public init(baseUrl: String, apiKey: String, requestJsonBody: String, token: TurnToken,
        readTimeout!: Duration = Duration.second * 30) {
        this.token = token
        // 系统 CA 验证，禁止重定向转发凭据。
        let c = ClientBuilder().tlsConfig(TlsClientConfig()).autoRedirect(false).build()
        try {
            let req = HttpRequestBuilder().post().url("${baseUrl}/chat/completions")
                .header("Authorization", "Bearer ${apiKey}")
                .header("Content-Type", "application/json")
                .body(requestJsonBody).readTimeout(readTimeout).build()
            let resp = c.send(req)
            if (resp.status != 200) {
                try { resp.close() } catch (_: Exception) {}
                throw Exception("http-status:${resp.status}")
            }
            this.body = resp.body
            this.clientOpt = Some(c)
            this.responseOpt = Some(resp)
        } catch (e: Exception) {
            try { c.close() } catch (_: Exception) {}
            if (e.message.startsWith("http-status:")) { throw Exception(e.message) }
            throw Exception("http-request-error")
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
