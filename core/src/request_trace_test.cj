package core
import std.unittest.*
import std.fs.*
import stdx.encoding.json.*

class TraceClock {
    var ms = Int64(0)
    var calls = Int64(0)
    var sent = ""
}
let traceBody = "{\"model\":\"selected\",\"messages\":[{\"role\":\"system\",\"content\":\"保持原文\\n不要编造\"},{\"role\":\"developer\",\"content\":\"工具规则\"},{\"role\":\"user\",\"content\":\"data:image/png;base64,SECRET_IMAGE\"}],\"api_key\":\"SECRET_KEY\",\"tools\":[],\"temperature\":0.4}"

@Test
func traceIsLazyAndPreDispatchCancellationWritesNothing() {
    let clock = TraceClock(); let token = TurnToken(); let log = SessionLog("trace-unused.log")
    let p = RequestTraceProvider(traceBody, "fixture", log, token, { _ => clock.calls += 1; AgentChunks([]) })
    @Expect(log.eventCount(), Int64(0)); @Expect(clock.calls, Int64(0))
    token.cancel(); @Expect(p.next().isNone(), true)
    @Expect(log.eventCount(), Int64(0)); @Expect(clock.calls, Int64(0)); @Expect(p.isClosed(), true)
}

@Test
func traceRecordsExactSentPromptRouteAndMeasuredTimingWithoutSecrets() {
    let clock = TraceClock(); let token = TurnToken(); let log = SessionLog("trace-unused.log")
    log.append("turn/start", "")
    let inner = AgentChunks([Chunk("text", "答复", ""), Chunk("usage", "7", ""), Chunk("finish", "", "stop")])
    let p = RequestTraceProvider(traceBody, "chosen-provider", log, token, { body => clock.sent = body; clock.ms = 25; inner },
        now: { => 1000 + clock.ms }, ticks: { => clock.ms })
    let chunk = p.next().getOrThrow(); log.append("stream/chunk", streamChunkJson(chunk))
    @Expect(chunk.requestSeq, Some(Int64(1))); @Expect(chunk.elapsedMs, Some(Int64(25)))
    clock.ms = 40; p.next(); clock.ms = 60; p.next(); p.close(); p.close()
    @Expect(inner.closes, Int64(1)); @Expect(clock.sent, traceBody)
    let projection = requestTraceProjection(log.snapshotEvents().toArray())
    @Expect(projection.contains("SECRET_KEY"), false); @Expect(projection.contains("SECRET_IMAGE"), false)
    @Expect(projection.contains("保持原文"), true); @Expect(projection.contains("chosen-provider"), true)
    let request = JsonValue.fromStr(projection).asObject().get("requests").getOrThrow().asArray().get(0).getOrThrow().asObject()
    let end = request.get("end").getOrThrow().asObject()
    @Expect(end.get("durationMs").getOrThrow().asInt().getValue(), Int64(60))
    @Expect(end.get("ttftMs").getOrThrow().asInt().getValue(), Int64(25))
    @Expect(request.get("output").getOrThrow().asString().getValue(), "答复")
    @Expect(log.deriveMessages().size, Int64(0))
}

@Test
func traceMetadataOnlyKeepsAuditWithoutPromptOrToolDescriptions() {
    let log = SessionLog("trace-metadata-unused.log")
    let p = RequestTraceProvider(traceBody, "fixture", log, TurnToken(),
        { _ => AgentChunks([Chunk("finish", "", "stop")]) }, metadataOnly: true)
    p.next(); p.close()
    @Expect(log.eventCount(), Int64(2))
    let view = requestTraceProjection(log.snapshotEvents().toArray())
    @Expect(view.contains("chosen-provider"), false)
    @Expect(view.contains("selected"), true)
    @Expect(view.contains("completed"), true)
    @Expect(view.contains("保持原文"), false)
    @Expect(view.contains("工具规则"), false)
    @Expect(view.contains("SECRET_KEY"), false)
    @Expect(view.contains("SECRET_IMAGE"), false)
    @Expect(view.contains("\"prompts\":null"), true)
}

@Test
func traceInitFailureRecordsOneSafeTerminalWithoutExceptionSecret() {
    let log = SessionLog("trace-unused.log")
    let p = RequestTraceProvider(traceBody, "fixture", log, TurnToken(), { _ => throw Exception("credential=PRIVATE") })
    var failure = ""
    try { p.next() } catch (e: Exception) { failure = e.message }
    p.close(); p.close()
    @Expect(failure, "request-provider-failed"); @Expect(log.eventCount(), Int64(3))
    let view = requestTraceProjection(log.snapshotEvents().toArray())
    @Expect(view.contains("PRIVATE"), false); @Expect(view.contains("failed"), true)
}

@Test
func traceIncompleteAndCancelledStreamsNeverInventCompletionOrTokenTime() {
    let log = SessionLog("trace-unused.log"); let token = TurnToken()
    let inner = AgentChunks([Chunk("usage", "2", "")])
    let p = RequestTraceProvider(traceBody, "fixture", log, token, { _ => inner })
    p.next(); token.cancel(); p.close()
    let view = requestTraceProjection(log.snapshotEvents().toArray())
    @Expect(view.contains("cancelled"), true); @Expect(view.contains("\"ttftMs\":null"), true)
    @Expect(inner.closes, Int64(1))
    let eofLog = SessionLog("trace-eof-unused.log")
    let eof = RequestTraceProvider(traceBody, "fixture", eofLog, TurnToken(), { _ => AgentChunks([]) })
    eof.next(); eof.close()
    @Expect(requestTraceProjection(eofLog.snapshotEvents().toArray()).contains("interrupted"), true)
}

@Test
func traceReplayPagingAndLegacyHistoryDoNotGuessMissingPrompt() {
    let log = SessionLog("trace-unused.log")
    log.append("system/message", "旧提示"); log.append("assistant/message", "旧答复")
    @Expect(requestTraceProjection(log.snapshotEvents().toArray()).contains("旧提示"), false)
    for (_ in 0..3) {
        let p = RequestTraceProvider(traceBody, "fixture", log, TurnToken(), { _ => AgentChunks([]) })
        p.next(); p.close()
    }
    let page = JsonValue.fromStr(requestTraceProjection(log.snapshotEvents().toArray(), limit: 2)).asObject()
    @Expect(page.get("more").getOrThrow().asBool().getValue(), true)
    let before = page.get("beforeSeq").getOrThrow().asInt().getValue()
    let older = JsonValue.fromStr(requestTraceProjection(log.snapshotEvents().toArray(), beforeSeq: before, limit: 2)).asObject()
    @Expect(older.get("more").getOrThrow().asBool().getValue(), false)
    @Expect(older.get("requests").getOrThrow().asArray().get(1).isNone(), true)
    @Expect(log.deriveMessages().size, Int64(2))
}

@Test
func traceRunningProjectionLeavesDurationAndPromptAbsenceExplicit() {
    let log = SessionLog("trace-unused.log")
    log.append("request/header", "{\"version\":1,\"header\":{\"config\":{\"model\":\"m\"},\"tools\":[]}}")
    let view = requestTraceProjection(log.snapshotEvents().toArray())
    @Expect(view.contains("\"end\":null"), true); @Expect(view.contains("\"prompts\":null"), true)
}

@Test
func traceFlushAndRestartRebuildExactSameEvidence() {
    let path = "request-trace-replay-fixture.log"
    removeIfExists(path, recursive: false)
    try {
        let log = SessionLog(path)
        let p = RequestTraceProvider(traceBody, "fixture", log, TurnToken(), { _ => AgentChunks([]) }, now: { => Int64(1000) }, ticks: { => Int64(10) })
        p.next(); p.close()
        let before = requestTraceProjection(log.snapshotEvents().toArray())
        log.flush()
        let cold = SessionLog(path); @Expect(cold.load(), true)
        @Expect(requestTraceProjection(cold.snapshotEvents().toArray()), before)
        @Expect(cold.deriveMessages().size, Int64(0))
    } finally { removeIfExists(path, recursive: false) }
}

@Test
func traceModelLoopContinuationUsesIndependentImmutableSnapshots() {
    let log = SessionLog("trace-unused.log"); let token = TurnToken()
    log.append("system/message", "实际规则")
    let first = RequestTraceProvider(modelRequestJson("m", log.snapshotEvents().toArray()), "fixture", log, token,
        { _ => AgentChunks([Chunk("tool-call-delta", "{\"todos\":[]}", "", toolIndex: Some(Int64(0)), toolId: Some("t1"), toolName: Some("todo_write")), Chunk("finish", "", "tool_calls")]) })
    let result = ModelAgentLoop().run(first, { body => RequestTraceProvider(body, "fixture", log, token,
        { _ => AgentChunks([Chunk("text", "完成", ""), Chunk("finish", "", "stop")]) }) }, "m", token, log, DeliveryQueue(32), false)
    @Expect(result.interrupted, false)
    let rows = JsonValue.fromStr(requestTraceProjection(log.snapshotEvents().toArray())).asObject().get("requests").getOrThrow().asArray()
    @Expect(rows.get(1).isSome(), true); @Expect(rows.get(2).isNone(), true)
    @Expect(rows.get(0).getOrThrow().asObject().get("toolCalls").getOrThrow().asArray().get(0).isSome(), true)
    @Expect(rows.get(1).getOrThrow().asObject().get("output").getOrThrow().asString().getValue(), "完成")
}

@Test
func traceClassifiesProviderErrorWithoutLeakingRawText() {
    let log = SessionLog("trace-classify.log")
    // 非 200：429 → rate-limit 且带状态码；5xx → server。
    let rateP = RequestTraceProvider(traceBody, "fixture", log, TurnToken(), { _ => throw Exception("http-status:429") })
    try { rateP.next() } catch (_: Exception) {}
    rateP.close()
    @Expect(requestTraceProjection(log.snapshotEvents().toArray()).contains("provider-error:rate-limit:429"), true)
    let srvP = RequestTraceProvider(traceBody, "fixture", log, TurnToken(), { _ => throw Exception("http-status:503") })
    try { srvP.next() } catch (_: Exception) {}
    srvP.close()
    @Expect(requestTraceProjection(log.snapshotEvents().toArray()).contains("provider-error:server:503"), true)
    // 传输层失败：拒绝握手 / 超时 → connection / timeout，不带状态码。
    let connP = RequestTraceProvider(traceBody, "fixture", log, TurnToken(), { _ => throw Exception("http-request-error:connection-refused") })
    try { connP.next() } catch (_: Exception) {}
    connP.close()
    @Expect(requestTraceProjection(log.snapshotEvents().toArray()).contains("provider-error:connection"), true)
    let toP = RequestTraceProvider(traceBody, "fixture", log, TurnToken(), { _ => throw Exception("timeout") })
    try { toP.next() } catch (_: Exception) {}
    toP.close()
    @Expect(requestTraceProjection(log.snapshotEvents().toArray()).contains("provider-error:timeout"), true)
    // 上游错误体 / 中途断连 → server / connection。
    let upP = RequestTraceProvider(traceBody, "fixture", log, TurnToken(), { _ => throw Exception("upstream-error") })
    try { upP.next() } catch (_: Exception) {}
    upP.close()
    @Expect(requestTraceProjection(log.snapshotEvents().toArray()).contains("provider-error:server"), true)
    // 任意原始文案：退回笼统 provider-error，且绝不抄出敏感片段。
    let secretP = RequestTraceProvider(traceBody, "fixture", log, TurnToken(), { _ => throw Exception("raw-contains-SECRET_TOKEN_xyz") })
    try { secretP.next() } catch (_: Exception) {}
    secretP.close()
    let secretView = requestTraceProjection(log.snapshotEvents().toArray())
    @Expect(secretView.contains("provider-error"), true)
    @Expect(secretView.contains("SECRET_TOKEN_xyz"), false)
}
