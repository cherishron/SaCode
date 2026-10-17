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
