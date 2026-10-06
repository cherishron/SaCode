package core
import std.fs.*
import std.unittest.*
import stdx.encoding.json.*
import std.env.getVariable
import std.convert.*
import std.io.*

func runtimeCall(name: String, args: String): ModelToolCall {
    let call = ModelToolCall(0)
    call.id = "runtime-call"
    call.name = name
    call.args = args
    return call
}

@Test
func modelRuntimeRejectsWriteWithoutTicketAndPreservesContent() {
    let root = "model-runtime-denial"
    removeIfExists(root, recursive: true)
    Directory.create(root)
    let log = SessionLog("${root}/session.log")
    let runtime = ModelToolRuntime(log, false, files: true, workingDirectory: root)
    let outcome = runtime.execute(runtimeCall("write", "{\"path\":\"denied.txt\",\"content\":\"must not appear\"}"))
    @Expect(outcome.allowed, false)
    @Expect(exists(Path("${root}/denied.txt")), false)
    @Expect(runtime.execute(runtimeCall("unknown", "{}")).allowed, false)
    removeIfExists(root, recursive: true)
}

@Test
func modelRuntimeUsesBoundSingleUseApprovalAndPreservesJsonWhitespace() {
    let root = "model-runtime-files"
    removeIfExists(root, recursive: true)
    Directory.create(root)
    File.writeTo("${root}/space name.txt", "original".toArray())
    let log = SessionLog("${root}/session.log")
    let desk = ApprovalDesk(log)
    let id = desk.ask("write")
    @Expect(desk.answer(id, "allowed-once"), true)
    let runtime = ModelToolRuntime(log, false, files: true, workingDirectory: root,
        desk: desk, approval: { _ => id })
    @Expect(runtime.execute(runtimeCall("read", "{\"path\":\"space name.txt\"}")).why, "original")
    let args = "{\"path\":\"space name.txt\",\"content\":\"  first\\nsecond  \"}"
    @Expect(runtime.execute(runtimeCall("write", args)).allowed, true)
    @Expect(String.fromUtf8(File.readFrom("${root}/space name.txt")), "  first\nsecond  ")
    @Expect(runtime.execute(runtimeCall("write", args)).allowed, false)
    // 参数 Schema 拒绝多余字段和非字符串正文。
    let invalid = runtime.execute(runtimeCall("read", "{\"path\":\"space name.txt\",\"extra\":true}"))
    @Expect(invalid.allowed, false)
    @Expect(invalid.why, "bad-args")
    removeIfExists(root, recursive: true)
}

@Test
func modelRunnerUsesInjectedRegistryAndLogsExactlyOneCorrelatedResult() {
    let log = SessionLog("model-runtime-loop-unused.log")
    log.append("user/message", "read a missing file")
    let runtime = ModelToolRuntime(log, false, files: true)
    let first = AgentChunks([
        Chunk("tool-call-delta", "{\"path\":\"model-runtime-missing.txt\"}", "", toolIndex: Some(0), toolId: Some("read-1"), toolName: Some("read")),
        Chunk("finish", "", "tool_calls")])
    let final = AgentChunks([Chunk("text", "file unavailable", ""), Chunk("finish", "", "stop")])
    let handle = ModelAgentRunner().start(first, { body =>
        let request = JsonValue.fromStr(body).asObject()
        @Expect(request.get("tools").getOrThrow().asArray().size(), Int64(10))
        @Expect(request.get("messages").getOrThrow().asArray().size(), Int64(3))
        final
    }, "test-model", TurnToken(), log, DeliveryQueue(64), false, toolRuntime: runtime)
    let result = handle.result()
    @Expect(result.settledToolCalls, Int64(1))
    @Expect(result.successfulToolCalls, Int64(0))
    var count = Int64(0)
    for (event in log.snapshotEvents()) { if (event.eventType == "tool/result") { count += 1 } }
    @Expect(count, Int64(1))
    @Expect(result.interrupted, false)
}

@Test
func goalRunnerRejectsDeniedToolsAsProgress() {
    let log = SessionLog("model-runtime-goal-unused.log")
    log.append("user/message", "keep working")
    let svc = GoalService(log)
    svc.create("write with approval")
    let runtime = ModelToolRuntime(log, false, files: true)
    let result = GoalRunner().run({ => AgentChunks([
        Chunk("tool-call-delta", "{\"path\":\"never-created.txt\",\"content\":\"denied\"}", "", toolIndex: Some(0), toolId: Some("denied-write"), toolName: Some("write")),
        Chunk("finish", "", "tool_calls")]) },
        { _ => AgentChunks([Chunk("finish", "", "stop")]) },
        "test-model", TurnToken(), log, DeliveryQueue(64), false, GoalScheduler(log, { => Int64(0) }), svc,
        Int64(8), Int64(100), Int64(1), { => false }, { => false }, toolRuntime: runtime)
    @Expect(result.stopReason, "no-progress")
    @Expect(result.rounds, Int64(1))
    @Expect(svc.snapshot().blockedReason, "goal-no-progress")
    @Expect(exists(Path("never-created.txt")), false)
}

@Test
func modelToolsKeepFirstIdentityAcrossExplicitEmptySseIds() {
    let buf = ByteBuffer()
    appendSse(buf, "data: {\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"first-id\",\"function\":{\"name\":\"todo_write\",\"arguments\":\"{\"}}]},\"finish_reason\":null}]}\n\n")
    appendSse(buf, "data: {\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"\",\"function\":{\"name\":\"\",\"arguments\":\"\\\"todos\\\":[] }\"}}]},\"finish_reason\":null}]}\n\n")
    appendSse(buf, "data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"tool_calls\"}]}\n\n")
    appendSse(buf, "data: [DONE]\n\n")
    let provider = RealSseProvider(buf, TurnToken())
    let calls = ModelToolCalls()
    try {
        while (let Some(chunk) <- provider.next()) { if (chunk.kind == "tool-call-delta") { calls.push(chunk) } }
    } finally { provider.close() }
    @Expect(calls.complete()[0].id, "first-id")
    @Expect(calls.complete()[0].name, "todo_write")
    @Expect(calls.complete()[0].args, "{\"todos\":[] }")
    let missing = ModelToolCalls()
    missing.push(Chunk("tool-call-delta", "{}", "", toolIndex: Some(0), toolId: Some(""), toolName: Some("todo_write")))
    @ExpectThrows[Exception](missing.complete())
    @ExpectThrows[Exception](calls.push(Chunk("tool-call-delta", "", "", toolIndex: Some(0), toolId: Some("other-id"))))
}

// 真实远端单独门控：缺少凭据明确跳过，不用本地桩冒充实测。
@TestBuilder
func realModelToolRuntimeSuite(): TestSuite {
    let cfg = Configuration()
    cfg.set(KeySkip.skip, (getVariable("STEPFUN_API_KEY") ?? "").size == 0)
    return TestSuite.builder("RealModelToolRuntime")
        .add(UnitTestCase.create("realModelExecutesRegisteredTodo", configuration: cfg) {
            let log = SessionLog("real-model-runtime-unused.log")
            log.append("system/message", "Call todo_write exactly once with one pending item named verified-task. After the tool returns, say done without calling any further tool.")
            log.append("user/message", "Please record the task using the tool now.")
            let token = TurnToken()
            let runtime = ModelToolRuntime(log, false)
            let body = modelRequestJson("step-5-preview", log.snapshotEvents().toArray(), tools: runtime.specs())
            let required = body[0..body.size - 1] + ",\"tool_choice\":{\"type\":\"function\",\"function\":{\"name\":\"todo_write\"}}}"
            let key = getVariable("STEPFUN_API_KEY") ?? ""
            let base = "https://api.stepfun.com/step_plan/v1"
            let result = ModelAgentLoop().run(RequestTraceProvider(required, "stepfun", log, token, { request => RealSseProvider(base, key, request, token) }),
                { request => RequestTraceProvider(request, "stepfun", log, token, { body => RealSseProvider(base, key, body, token) }) }, "step-5-preview", token,
                log, DeliveryQueue(2048), false, maxSteps: Int64(4), toolRuntime: runtime)
            @Expect(result.finishReason, "stop")
            @Expect(result.interrupted, false)
            @Expect(result.successfulToolCalls, Int64(1))
            @Expect(result.settledToolCalls, Int64(1))
            @Assert(TodoStore(log).list().size == Int64(1))
            @Expect(TodoStore(log).list()[0].content, "verified-task")
            @Expect(Int64.parse(result.usage) > 0, true)
            let traces = JsonValue.fromStr(requestTraceProjection(log.snapshotEvents().toArray())).asObject().get("requests").getOrThrow().asArray()
            @Expect(traces.get(1).isSome(), true)
            @Expect(traces.get(2).isNone(), true)
            let firstTrace = traces.get(0).getOrThrow().asObject()
            @Expect(firstTrace.get("request").getOrThrow().asObject().get("header").getOrThrow().asObject().get("config").getOrThrow().asObject().get("model").getOrThrow().asString().getValue(), "step-5-preview")
            @Expect(firstTrace.get("prompts").getOrThrow().asArray().get(0).getOrThrow().asObject().get("content").getOrThrow().asString().getValue(), log.snapshotEvents()[0].data)
            @Expect(firstTrace.get("end").getOrThrow().asObject().get("state").getOrThrow().asString().getValue(), "completed")
        }).build()
}
