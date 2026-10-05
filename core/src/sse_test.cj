package core

import std.unittest.*
import std.io.*
import std.sync.*
import std.collection.ArrayList
import std.env.*
import std.fs.*
import stdx.net.http.*
import std.process.*
import std.time.MonoTime
import std.convert.*
import stdx.encoding.json.*

// 可控分片流：耗尽后可抛异常，防止 DONE 后偷偷读取阻塞流。
class SseProbeStream <: InputStream & Resource {
    let bytes: Array<UInt8>
    let stride: Int64
    let mode: String
    var pos: Int64 = 0
    var reads: Int64 = 0
    var closes: Int64 = 0
    var shut = false
    init(data: String, stride!: Int64 = 8192, mode!: String = "eof") {
        bytes = data.toArray()
        this.stride = stride
        this.mode = mode
    }
    public func read(out: Array<UInt8>): Int64 {
        reads += 1
        if (pos == bytes.size) {
            if (mode == "timeout") { throw HttpTimeoutException("private response") }
            if (mode == "core-timeout") { throw TimeoutException() }
            if (mode == "error") { throw IOException("private response") }
            return 0
        }
        let n = min(min(out.size, stride), bytes.size - pos)
        for (i in 0..n) { out[i] = bytes[pos + i] }
        pos += n
        return n
    }
    public func close() { closes += 1; shut = true }
    public func isClosed(): Bool { shut }
}

@Test
func sseDoneNeverReadsAgainAndCloseIsIdempotent() {
    let s = SseProbeStream("data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n", mode: "error")
    let p = RealSseProvider(s, TurnToken())
    @Assert(p.next().isSome(), true)
    @Expect(p.next().isNone(), true)
    @Expect(p.next().isNone(), true)
    @Expect(p.doneReceived, true)
    @Expect(p.termination, "done")
    @Expect(s.reads, Int64(1))
    p.close()
    p.close()
    @Expect(s.closes, Int64(1))
}

@Test
func sseReadErrorsAreNotEofOrCancellation() {
    for (mode in ["timeout", "core-timeout", "error"]) {
        let t = TurnToken()
        let s = SseProbeStream("", mode: mode)
        let p = RealSseProvider(s, t)
        @ExpectThrows[Exception](p.next())
        @Expect(p.errorCode, if (mode == "error") { "read-error" } else { "timeout" })
        @Expect(p.termination, "error")
        @Expect(t.cancelled(), false)
        @Expect(s.closes, Int64(1))
        p.close()
    }
}

@Test
func sseUtf8SplitCrLfAndMultilineData() {
    let s = SseProbeStream("event: message\r\n: 注释\r\ndata: {\"choices\":\r\ndata: [{\"index\":0,\"delta\":{\"content\":\"你好data:\"},\"finish_reason\":\"stop\"}]}\r\n\r\ndata: [DONE]\r\n\r\n", stride: 1)
    let p = RealSseProvider(s, TurnToken())
    @Expect(p.next().getOrThrow().text, "你好data:")
    @Expect(p.next().getOrThrow().kind, "finish")
    @Expect(p.next().isNone(), true)
    @Expect(p.doneReceived, true)
    p.close()
}

@Test
func sseRejectsUnboundedLineAndDamagedUtf8() {
    let s = SseProbeStream(String.fromUtf8(Array<UInt8>(262145, repeat: 97)))
    let p = RealSseProvider(s, TurnToken())
    @ExpectThrows[Exception](p.next())
    @Expect(p.errorCode, "line-limit")
    @Expect(s.closes, Int64(1))
    let b = ByteBuffer()
    b.write([UInt8(255), UInt8(10)])
    let bad = RealSseProvider(b, TurnToken())
    @ExpectThrows[Exception](bad.next())
    @Expect(bad.errorCode, "protocol-error")
}

@Test
func sseToolIdentityOnlyAndRawContinuation() {
    let c = collectSse("data: {\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":3,\"id\":\"call\",\"function\":{\"name\":\"read\",\"arguments\":\"\"}}]}}]}\n\ndata: {\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":3,\"function\":{\"arguments\":\"  {bad JSON\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\ndata: [DONE]\n\n")
    @Assert(c.size, Int64(3))
    @Expect(c[0].text, "")
    @Expect(c[0].toolId, Some("call"))
    @Expect(c[1].toolIndex, Some(Int64(3)))
    @Expect(c[1].toolId, Option<String>.None)
    @Expect(c[1].text, "  {bad JSON")
}

@Test
func sseProtocolErrorDoesNotEchoServiceReply() {
    let s = SseProbeStream("data: {\"error\":{\"message\":\"private response\"}}\n\n")
    let p = RealSseProvider(s, TurnToken())
    var message = ""
    try { p.next() } catch (e: Exception) { message = e.message }
    @Expect(message, "upstream-error")
    @Expect(p.errorCode, "upstream-error")
    @Expect(p.doneReceived, false)
    @Expect(s.closes, Int64(1))
}

@Test
func sseEventAndQueueLimitsFailClosed() {
    let b = ByteBuffer()
    let part = String.fromUtf8(Array<UInt8>(200000, repeat: 32))
    for (_ in 0..6) { appendSse(b, "data: ${part}\n") }
    let p = RealSseProvider(b, TurnToken())
    @ExpectThrows[Exception](p.next())
    @Expect(p.errorCode, "event-limit")
    var tools = ""
    for (i in 0..1025) {
        if (i > 0) { tools += "," }
        tools += "{\"index\":${i},\"function\":{\"arguments\":\"x\"}}"
    }
    let q = ByteBuffer()
    appendSse(q, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"not delivered\",\"tool_calls\":[${tools}]}}]}\n\n")
    let many = RealSseProvider(q, TurnToken())
    @ExpectThrows[Exception](many.next())
    @Expect(many.errorCode, "event-limit")
}

@Test
func sseInvalidProtocolAndUsageFailClosed() {
    for (json in ["{}", "{\"choices\":{}}", "{\"usage\":{\"total_tokens\":-1}}",
        "{\"usage\":{\"prompt_tokens\":9223372036854775807,\"completion_tokens\":1}}",
        "{\"choices\":[{\"index\":0,\"delta\":{\"content\":42}}]}",
        "{\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"function\":{\"name\":\"read\"}}]}}]}"]) {
        let b = ByteBuffer()
        appendSse(b, "data: ${json}\n\n")
        let p = RealSseProvider(b, TurnToken())
        @ExpectThrows[Exception](p.next())
        @Expect(p.errorCode, "protocol-error")
    }
    let b = ByteBuffer()
    appendSse(b, "data: [DONE]\n\n")
    let p = RealSseProvider(b, TurnToken())
    @ExpectThrows[Exception](p.next())
    @Expect(p.doneReceived, true)
    @Expect(p.errorCode, "protocol-error")
}

@Test
func sseFinalUnterminatedLineAndUsageOnlyEof() {
    let b = ByteBuffer()
    appendSse(b, "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"total_tokens\":25,\"prompt_tokens\":17,\"completion_tokens\":5}}")
    let p = RealSseProvider(b, TurnToken())
    @Expect(p.next().getOrThrow().text, "25")
    @Expect(p.next().getOrThrow().kind, "finish")
    @Expect(p.next().isNone(), true)
    @Expect(p.termination, "eof")
    @Expect(p.doneReceived, false)
    p.close()
}

// RealSseProvider 解析测试：用 ByteBuffer 模拟 SSE 流，验证四种 Chunk kind 的逐帧映射。
// 不发真实 HTTP 请求；真实 API 验证靠 env STEPFUN_API_KEY 触发的集成用例。

func appendSse(buf: ByteBuffer, s: String) {
    unsafe { buf.write(s.rawData()) }
}

func makeSseStream(): ByteBuffer {
    let buf = ByteBuffer()
    appendSse(buf, "data: {\"choices\":[{\"delta\":{\"content\":\"hello\"},\"finish_reason\":null}]}\n\n")
    appendSse(buf, "data: {\"choices\":[{\"delta\":{\"content\":\" world\"},\"finish_reason\":null}]}\n\n")
    appendSse(buf, "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n")
    appendSse(buf, "data: {\"usage\":{\"prompt_tokens\":17,\"completion_tokens\":5}}\n\n")
    appendSse(buf, "data: [DONE]\n\n")
    return buf
}

@Test
func sseParseTextAndFinish() {
    let token = TurnToken()
    let stream = makeSseStream()
    let p = RealSseProvider(stream, token)
    let chunks = ArrayList<Chunk>()
    while (let Some(ch) <- p.next()) {
        chunks.add(ch)
    }
    // 期望：正文、总量、终态；usage 必须先于 finish。
    @Expect(chunks.size, Int64(4))
    @Expect(chunks[0].kind, "text")
    @Expect(chunks[0].text, "hello")
    @Expect(chunks[1].kind, "text")
    @Expect(chunks[1].text, " world")
    @Expect(chunks[2].kind, "usage")
    @Expect(chunks[2].text, "22")
    @Expect(chunks[3].kind, "finish")
    @Expect(chunks[3].reason, "stop")
    p.close()
}

@Test
func sseDoneTerminates() {
    let token = TurnToken()
    let stream = makeSseStream()
    let p = RealSseProvider(stream, token)
    var count: Int64 = 0
    while (let Some(_) <- p.next()) {
        count += 1
    }
    // [DONE] 后 next() 必须返回 None 且不无限循环
    @Expect(count, Int64(4))
    // 再次调用应该还是 None
    var afterDone = false
    match (p.next()) {
        case None => afterDone = false
        case Some(_) => afterDone = true
    }
    @Expect(afterDone, false)
    p.close()
}

@Test
func sseCancelMidStream() {
    let token = TurnToken()
    // 只写第一帧，之后流已结束（模拟「取不到更多帧」）
    let buf = ByteBuffer()
    appendSse(buf, "data: {\"choices\":[{\"delta\":{\"content\":\"hi\"},\"finish_reason\":null}]}\n\n")
    let p = RealSseProvider(buf, token)
    // 读第一帧
    var firstText = ""
    var firstOk = false
    match (p.next()) {
        case Some(ch) =>
            firstOk = (ch.kind == "text")
            firstText = ch.text
        case None => firstOk = false
    }
    @Expect(firstOk, true)
    @Expect(firstText, "hi")
    // 取消后再读：流已结束（buf 无更多数据），返回 None
    token.cancel()
    var afterCancel = false
    match (p.next()) {
        case None => afterCancel = false
        case Some(_) => afterCancel = true
    }
    @Expect(afterCancel, false)
    p.close()
}

@Test
func sseMalformedLineFails() {
    let token = TurnToken()
    let buf = ByteBuffer()
    appendSse(buf, ": SSE comment\n\n")
    appendSse(buf, "data: {bad json}\n\n")
    appendSse(buf, "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"},\"finish_reason\":null}]}\n\n")
    appendSse(buf, "data: [DONE]\n\n")
    let p = RealSseProvider(buf, token)
    @ExpectThrows[Exception](p.next())
    p.close()
}

// 回归用例：stepfun 真实流的帧形——每帧都带 usage、首帧 role-only、末帧 choices 为空数组。
// 曾经因「先查 usage」把 content 帧全吞成 usage 帧（真实 API 实测计数 18 帧 usage、0 帧 text）。
@Test
func sseUsageAlongsideChoicesNotEaten() {
    let token = TurnToken()
    let buf = ByteBuffer()
    appendSse(buf, "data: {\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"\"},\"finish_reason\":null}],\"usage\":{\"prompt_tokens\":17,\"completion_tokens\":0}}\n\n")
    appendSse(buf, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hi\"},\"finish_reason\":null}],\"usage\":{\"prompt_tokens\":17,\"completion_tokens\":1}}\n\n")
    appendSse(buf, "data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":17,\"completion_tokens\":1}}\n\n")
    appendSse(buf, "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":17,\"completion_tokens\":1}}\n\n")
    appendSse(buf, "data: [DONE]\n\n")
    let p = RealSseProvider(buf, token)
    let chunks = ArrayList<Chunk>()
    while (let Some(ch) <- p.next()) {
        chunks.add(ch)
    }
    // 累计 usage 只交付最新总数一次，不把各帧相加。
    @Expect(chunks.size, Int64(3))
    @Expect(chunks[0].kind, "text")
    @Expect(chunks[0].text, "hi")
    @Expect(chunks[1].kind, "usage")
    @Expect(chunks[1].text, "18")
    @Expect(chunks[2].kind, "finish")
    @Expect(chunks[2].reason, "stop")
    p.close()
}

// 截断 EOF 保留 interrupted；不发布完整助手历史。
@Test
func sseAbruptEofBeforeFinishLeavesInterruptedNotCancelled() {
    let log = SessionLog("core-test-sse-eof-before.log")
    let token = TurnToken()
    let buf = ByteBuffer()
    appendSse(buf, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hello\"},\"finish_reason\":null}]}\n\n")
    let p = RealSseProvider(buf, token)
    let r = TurnLoop().run(p, token, log, DeliveryQueue(8))
    // 只交付了 1 帧 text，没有 finish
    @Expect(r.delivered, Int64(1))
    @Expect(r.text, "hello")
    @Expect(r.finishReason, "")
    @Expect(r.interrupted, true)
    // 网络断开不自动取消：token 仍由用户掌握
    @Expect(r.cancelled, false)
    @Expect(token.cancelled(), false)
    cleanSse("eof-before")
}

// 流到 finish 后 abrupt EOF（无 [DONE]）：finish 已到，turn 干净收束，不算 interrupted。
// [DONE] 只是终止符，真正的终态信号是 finish_reason；有 finish 就不算被打断。
@Test
func sseAbruptEofAfterFinishCompletesCleanly() {
    let log = SessionLog("core-test-sse-eof-after.log")
    let token = TurnToken()
    let buf = ByteBuffer()
    appendSse(buf, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hi\"},\"finish_reason\":null}]}\n\n")
    appendSse(buf, "data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n")
    let p = RealSseProvider(buf, token)
    let r = TurnLoop().run(p, token, log, DeliveryQueue(8))
    @Expect(r.delivered, Int64(2))
    @Expect(r.text, "hi")
    @Expect(r.finishReason, "stop")
    @Expect(r.interrupted, false)
    @Expect(r.cancelled, false)
    cleanSse("eof-after")
}

func cleanSse(tag: String) {
    removeIfExists("core-test-sse-${tag}.log", recursive: false)
    removeIfExists("core-test-sse-${tag}.log.lease", recursive: false)
}

// 集成用例只读环境变量；缺 key 显式 SKIPPED，禁止 return 伪造通过。
@TestBuilder
func realModelSseSuite(): TestSuite {
    let cfg = Configuration()
    cfg.set(KeySkip.skip, (getVariable("STEPFUN_API_KEY") ?? "").size == 0)
    return TestSuite.builder("RealModelSse")
        .add(UnitTestCase.create("realModelSse", configuration: cfg) { realModelSse() })
        .build()
}

func realModelSse() {
    let key = getVariable("STEPFUN_API_KEY") ?? ""
    @Assert(key.size > 0)
    let token = TurnToken()
    let body = "{\"model\":\"step-3.7-flash\",\"messages\":[{\"role\":\"user\",\"content\":\"say hi in one word\"}],\"stream\":true}"
    let p = RealSseProvider("https://api.stepfun.com/step_plan/v1", key, body, token)
    var text = ""
    var hasFinish = false
    try {
        while (let Some(ch) <- p.next()) {
            if (ch.kind == "text") { text += ch.text }
            if (ch.kind == "finish") { hasFinish = true }
        }
    } finally { p.close() }
    @Expect(text.size > 0, true)
    @Expect(hasFinish, true)
    @Expect(p.doneReceived, true)
}

func collectSse(source: String): ArrayList<Chunk> {
    let b = ByteBuffer()
    appendSse(b, source)
    let p = RealSseProvider(b, TurnToken())
    let out = ArrayList<Chunk>()
    try { while (let Some(ch) <- p.next()) { out.add(ch) } }
    finally { p.close() }
    return out
}

@Test
func sseSameFrameTextAndAllTools() {
    let c = collectSse("data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"data:你好\",\"tool_calls\":[{\"index\":0,\"id\":\"a\",\"function\":{\"name\":\"read\",\"arguments\":\"{\"}},{\"index\":1,\"id\":\"b\",\"function\":{\"name\":\"write\",\"arguments\":\" raw \"}}]},\"finish_reason\":\"tool_calls\"}],\"usage\":{\"total_tokens\":22}}\n\ndata: [DONE]\n\n")
    @Assert(c.size, Int64(5))
    @Expect(c[0].text, "data:你好")
    @Expect(c[1].text, "{")
    @Expect(c[1].choiceIndex, Some(Int64(0)))
    @Expect(c[1].toolIndex, Some(Int64(0)))
    @Expect(c[1].toolId, Some("a"))
    @Expect(c[1].toolName, Some("read"))
    @Expect(c[2].toolIndex, Some(Int64(1)))
    @Expect(c[2].toolId, Some("b"))
    @Expect(c[2].toolName, Some("write"))
    @Expect(c[2].text, " raw ")
    @Expect(c[3].text, "22")
    @Expect(c[4].kind, "finish")
}

@Test
func sseSelectsIndexZeroNotArrayPosition() {
    let c = collectSse("data: {\"choices\":[{\"index\":1,\"delta\":{\"content\":\"wrong\"}},{\"index\":0,\"delta\":{\"content\":\"right\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
    @Assert(c.size, Int64(2))
    @Expect(c[0].text, "right")
}

@Test
func sseDoneDiscardsTrailingBuffer() {
    let c = collectSse("data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\ndata: {bad json}\n\n")
    @Expect(c.size, Int64(1))
}

@Test
func sseCancelDiscardsAlreadyBufferedEvents() {
    let b = ByteBuffer()
    appendSse(b, "data: {\"choices\":[{\"delta\":{\"content\":\"first\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"second\"}}]}\n\n")
    let t = TurnToken()
    let p = RealSseProvider(b, t)
    @Assert(p.next().isSome(), true)
    t.cancel()
    @Expect(p.next().isNone(), true)
    p.close()
}

@Test
func sseUpstreamErrorFailsSafely() {
    @ExpectThrows[Exception](collectSse("data: {\"error\":{\"message\":\"secret service reply\"}}\n\n"))
}

@Test
func sseLengthMapsToMaxTokensAndInvalidatesTools() {
    let c = collectSse("data: {\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"a\",\"function\":{\"name\":\"read\",\"arguments\":\"{\"}}]},\"finish_reason\":\"length\"}]}\n\ndata: [DONE]\n\n")
    let asm = Assembly()
    for (ch in c) { asm.push(ch) }
    @Expect(asm.finishReason, "max-tokens")
    @Expect(asm.toolCalls.size, Int64(0))
}

func withSseNetwork(check: (String, String) -> Unit) {
    // 看门狗预算要显式声明：本组里最长的用例（长流溢出逐字段重放）实测 23.45 秒，
    // 而夹具默认 20 秒硬时限——不声明就是在时限上赌运气，实测红过一次（夹具中途 exit(2)，
    // 后续连接被拒 10061）。仓颉侧 launch 传不了子进程环境变量，所以走命令行声明。
    let proc = launch("node", ["../scripts/sse-contract-server.cjs", "--watchdog-ms", "60000"],
        stdIn: ProcessRedirect.Pipe, stdOut: ProcessRedirect.Pipe, stdErr: ProcessRedirect.Inherit)
    try {
        let reader = StringReader(proc.stdOutPipe)
        let port = reader.readln().getOrThrow()
        let tlsPort = reader.readln().getOrThrow()
        check("http://127.0.0.1:${port}", "https://127.0.0.1:${tlsPort}")
    } finally {
        try { proc.stdInPipe.write("stop\n".toArray()); proc.wait(timeout: Duration.second * 3) }
        catch (_: Exception) {
            try { proc.terminate(force: true) } catch (_: Exception) {}
            proc.wait()
        }
    }
}

@Test
func sseNetworkHttpErrorsSafe() {
    withSseNetwork { base, _ =>
        for (status in ["401", "429", "500"]) {
            let start = MonoTime.now()
            var message = ""
            try { let p = RealSseProvider("${base}/${status}", "fixture-only", "{}", TurnToken()); p.close() }
            catch (e: Exception) { message = e.message }
            @Expect(message, "http-status:${status}")
            @Expect((MonoTime.now() - start).toMilliseconds() < 2000, true)
            println("NETWORK ${status} ms=${(MonoTime.now() - start).toMilliseconds()}")
        }
    }
}

@Test
func sseNetworkRedirectNeverForwardsCredentials() {
    withSseNetwork { base, _ =>
        let start = MonoTime.now()
        var message = ""
        try { let p = RealSseProvider("${base}/redirect", "fixture-only", "{}", TurnToken()); p.close() }
        catch (e: Exception) { message = e.message }
        @Expect(message, "http-status:307")
        let c = ClientBuilder().build()
        try {
            let resp = c.get("${base}/stats")
            @Expect(StringReader(resp.body).readToEnd(), "0,0")
            resp.close()
        } finally { c.close() }
        @Expect((MonoTime.now() - start).toMilliseconds() < 2000, true)
        println("NETWORK redirect ms=${(MonoTime.now() - start).toMilliseconds()}")
    }
}

@Test
func sseNetworkDefaultTlsRejectsSelfSigned() {
    withSseNetwork { _, secure =>
        let start = MonoTime.now()
        var message = ""
        try { let p = RealSseProvider("${secure}/normal", "fixture-only", "{}", TurnToken()); p.close() }
        catch (e: Exception) { message = e.message }
        @Expect(message, "http-request-error")
        @Expect((MonoTime.now() - start).toMilliseconds() < 3000, true)
        println("NETWORK TLS ms=${(MonoTime.now() - start).toMilliseconds()}")
    }
}

@Test
func sseNetworkBlockedReadTimesOut() {
    withSseNetwork { base, _ =>
        let p = RealSseProvider("${base}/stall", "fixture-only", "{}", TurnToken(),
            readTimeout: Duration.millisecond * 500)
        try {
            @Assert(p.next().getOrThrow().text, "first")
            let start = MonoTime.now()
            var message = ""
            try { p.next() } catch (e: Exception) { message = e.message }
            @Expect(message, "timeout")
            @Expect(p.termination, "error")
            @Expect(p.doneReceived, false)
            @Expect((MonoTime.now() - start).toMilliseconds() < 2000, true)
            println("NETWORK timeout ms=${(MonoTime.now() - start).toMilliseconds()}")
        } finally { p.close() }
    }
}

@Test
func sseNetworkBlockedReadCancellationDropsLateFrame() {
    withSseNetwork { base, _ =>
        let t = TurnToken()
        let p = RealSseProvider("${base}/cancel", "fixture-only", "{}", t,
            readTimeout: Duration.millisecond * 500)
        try {
            @Assert(p.next().getOrThrow().text, "first")
            let entered = AtomicBool(false)
            let f = spawn { => entered.store(true); p.next().isNone() }
            while (!entered.load()) { sleep(Duration.millisecond) }
            sleep(Duration.millisecond * 100)
            let start = MonoTime.now()
            t.cancel()
            @Expect(f.get(), true)
            @Expect(p.next().isNone(), true)
            @Expect(p.termination, "cancelled")
            @Expect(p.doneReceived, false)
            @Expect((MonoTime.now() - start).toMilliseconds() < 900, true)
            println("NETWORK cancel ms=${(MonoTime.now() - start).toMilliseconds()}")
        } finally { p.close() }
    }
}

@Test
func sseNetworkDisconnectNeverCompletes() {
    withSseNetwork { base, _ =>
        let t = TurnToken()
        let p = RealSseProvider("${base}/disconnect", "fixture-only", "{}", t)
        let asm = Assembly()
        let start = MonoTime.now()
        try {
            try { while (let Some(ch) <- p.next()) { asm.push(ch) } }
            catch (e: Exception) { @Expect(e.message, "read-error") }
            @Expect(asm.assembledText(), "first")
            @Expect(asm.interrupted, true)
            @Expect(asm.finishReason, "")
            @Expect(p.doneReceived, false)
            @Expect(t.cancelled(), false)
            @Expect((MonoTime.now() - start).toMilliseconds() < 2000, true)
            println("NETWORK disconnect ms=${(MonoTime.now() - start).toMilliseconds()}")
        } finally { p.close() }
    }
}

@Test
func sseNetworkNormalTextUsageFinishDone() {
    withSseNetwork { base, _ =>
        let p = RealSseProvider("${base}/normal", "fixture-only", "{}", TurnToken())
        let chunks = ArrayList<Chunk>()
        let start = MonoTime.now()
        try {
            while (let Some(ch) <- p.next()) { chunks.add(ch) }
            @Assert(chunks.size, Int64(3))
            @Expect(chunks[0].text, "first")
            @Expect(chunks[1].kind, "usage")
            @Expect(chunks[1].text, "22")
            @Expect(chunks[2].kind, "finish")
            @Expect(chunks[2].reason, "stop")
            @Expect(p.doneReceived, true)
            @Expect(p.termination, "done")
            println("NETWORK normal ms=${(MonoTime.now() - start).toMilliseconds()}")
        } finally { p.close() }
    }
}

// 每 97 帧仅消费一帧，确定性模拟慢消费者；取消点发生在投递之后。
class LongSlowSink <: FrameSink {
    let q = DeliveryQueue(3)
    let token: TurnToken
    let cancelAt: Int64
    var offered: Int64 = 0
    var consumed: Int64 = 0
    var peak: Int64 = 0
    let prefix = ArrayList<String>()
    init(token: TurnToken, cancelAt: Int64) { this.token = token; this.cancelAt = cancelAt }
    public func offer(frame: String): Bool {
        offered += 1
        if (offered <= 3) { prefix.add(frame) }
        let ok = q.offer(frame)
        if (q.frames.size > peak) { peak = q.frames.size }
        if (offered % 97 == 0) { consumed += q.drain(1).size }
        if (offered == cancelAt) { token.cancel() }
        return ok
    }
}

func verifyLongPersisted(base: String, cancelled: Bool) {
    let tag = if (cancelled) { "long-cancel" } else { "long-complete" }
    cleanSse(tag)
    let log = SessionLog("core-test-sse-${tag}.log")
    let token = TurnToken()
    let sink = LongSlowSink(token, if (cancelled) { Int64(257) } else { Int64(-1) })
    let p = RealSseProvider("${base}/long", "fixture-only", "{}", token)
    try {
        let r = TurnLoop().run(p, token, log, sink)
        let count = if (cancelled) { Int64(257) } else { Int64(10006) }
        @Assert(r.delivered, count)
        @Expect(r.cancelled, cancelled)
        @Expect(sink.q.overflow() > 0, true)
        @Expect(sink.peak <= 3, true)
        @Expect(sink.consumed + sink.q.size() + sink.q.overflow(), count)
        @Assert(log.flush(), true)
        let loaded = SessionLog("core-test-sse-${tag}.log")
        @Assert(loaded.load(), true)
        @Expect(loaded.durableCount(), log.eventCount())
        let client = ClientBuilder().build()
        var expected = ""
        try {
            let resp = client.get("${base}/long-expected")
            try { expected = StringReader(resp.body).readToEnd() } finally { resp.close() }
        } finally { client.close() }
        let lines = expected.split("\n")
        let events = loaded.snapshotEvents()
        var cursor: Int64 = 0
        var restored: Int64 = 0
        var expectedText = ""
        // 分页游标是 SessionEvent.seq；跳过非流记录，不另存帧真源。
        while (cursor < events.size) {
            let end = min(cursor + 113, events.size)
            for (i in cursor..end) {
                let ev = events[i]
                @Assert(ev.seq, i)
                if (ev.eventType != "stream/chunk") { continue }
                @Assert(ev.data.startsWith("{"), true)
                let actual = JsonValue.fromStr(ev.data).asObject()
                let want = JsonValue.fromStr(lines[restored]).asObject()
                for (key in ["kind", "text", "reason", "choiceIndex", "toolIndex", "toolId", "toolName"]) {
                    @Assert(actual[key].toString(), want[key].toString())
                }
                if (restored < 3) {
                    @Expect("${actual["kind"].asString().getValue()}:${actual["text"].asString().getValue()}", sink.prefix[restored])
                }
                if (want["kind"].asString().getValue() == "text") {
                    expectedText += want["text"].asString().getValue()
                }
                restored += 1
            }
            cursor = end
        }
        @Expect(restored, count)
        @Expect(r.text, expectedText)
        var assistant: Int64 = 0
        for (ev in events) { if (ev.eventType == "assistant/message") { assistant += 1 } }
        @Expect(assistant, if (cancelled) { Int64(0) } else { Int64(1) })
        // 流记录不进模型历史；取消结算的 tool/result 仍按现有规则可见。
        for (msg in loaded.deriveMessages()) { @Expect(msg.startsWith("stream/chunk:"), false) }
        println("LONG HTTP cancelled=${cancelled} chunks=${restored} cap=3 peak=${sink.peak} overflow=${sink.q.overflow()} consumed=${sink.consumed} queued=${sink.q.size()} durable=${loaded.durableCount()} cursor=${cursor}")
    } finally { p.close(); cleanSse(tag) }
}

@Test
func sseNetworkLongStreamOverflowReplaysEveryPersistedField() {
    withSseNetwork { base, _ => verifyLongPersisted(base, false) }
}

@Test
func sseNetworkLongCancelledPrefixReplaysWithoutAssistant() {
    withSseNetwork { base, _ => verifyLongPersisted(base, true) }
}

@Test
func sseRejectsContentAfterFinishReason() {
    @ExpectThrows[Exception](collectSse("data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"late\"}}]}\n\ndata: [DONE]\n\n"))
}

