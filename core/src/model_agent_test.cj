package core
import std.collection.ArrayList
import std.io.*
import std.unittest.*
import stdx.encoding.json.*

class AgentChunks <: Provider & Resource {
    let chunks: Array<Chunk>
    var index = Int64(0)
    public var closes = Int64(0)
    public init(chunks: Array<Chunk>) { this.chunks = chunks }
    public func next(): Option<Chunk> {
        if (index >= chunks.size) { return None }
        let value = chunks[index]
        index += 1
        return Some(value)
    }
    public func close(): Unit { closes += 1 }
    public func isClosed(): Bool { return closes > 0 }
}

@Test
func modelAgentExecutesSplitTodoAndContinuesFromLoggedResult() {
    let log = SessionLog("model-agent-unused.log")
    log.append("user/message", "制定任务计划")
    let first = AgentChunks([
        Chunk("text", "先规划。", ""),
        Chunk("tool-call-delta", "{\"todos\":[{\"content\":\"  中文", "", toolIndex: Some(0), toolId: Some("call-todo"), toolName: Some("todo_write")),
        Chunk("tool-call-delta", "任务  \",\"status\":\"in_progress\"}]}", "", toolIndex: Some(0)),
        Chunk("usage", "3", ""), Chunk("finish", "", "tool_calls")])
    let final = AgentChunks([Chunk("text", "已经规划。", ""), Chunk("usage", "4", ""), Chunk("finish", "", "stop")])
    let requests = ArrayList<String>()
    let next: (String) -> Provider = { body => requests.add(body); final }
    let result = ModelAgentLoop().run(first, next, "test-model", TurnToken(), log, DeliveryQueue(32), false)
    @Expect(result.interrupted, false)
    @Expect(result.finishReason, "stop")
    @Expect(result.usage, "7")
    @Expect(result.settledToolCalls, Int64(1))
    @Expect(first.closes, Int64(1))
    @Expect(final.closes, Int64(1))
    @Expect(requests.size, Int64(1))
    let body = JsonValue.fromStr(requests[0]).asObject()
    let messages = body.get("messages").getOrThrow().asArray()
    let assistant = messages.get(1).getOrThrow().asObject()
    @Expect(assistant.get("role").getOrThrow().asString().getValue(), "assistant")
    @Expect(assistant.get("tool_calls").getOrThrow().asArray().get(0).getOrThrow().asObject().get("id").getOrThrow().asString().getValue(), "call-todo")
    @Expect(messages.get(2).getOrThrow().asObject().get("tool_call_id").getOrThrow().asString().getValue(), "call-todo")
    @Expect(body.get("tools").getOrThrow().asArray().get(0).getOrThrow().asObject().get("function").getOrThrow().asObject().get("name").getOrThrow().asString().getValue(), "todo_write")
    @Expect(TodoStore(log).list()[0].content, "中文任务")
    @Expect(log.deriveMessages()[1], "assistant/message: 先规划。")
    @Expect(log.deriveMessages()[3], "assistant/message: 已经规划。")
}

// 步边界送达即时补充：与轮次边界「只摘一条」不同，一个 pre-step 边界要把
// next-step 全部摘走，并且送达是另写一条 user/message——队列事件本身不进模型可见历史。
// 文本用纯 ASCII：本用例钉的是「有没有落进请求体」，不能被 JSON 转义形态干扰。
@Test
func inboxSteeredMessageLandsAtNextStepBoundary() {
    let log = SessionLog("model-agent-steer-unused.log")
    log.append("user/message", "先做第一步")
    let inbox = AgentInbox(log)
    inbox.queue("q1", "follow-up-42", "rpc-s1")
    inbox.steerFromQueue("q1")
    @Expect(inbox.sizeOf("next-step"), Int64(1))
    let first = AgentChunks([
        Chunk("tool-call-delta", "{\"todos\":[{\"content\":\"步边界\",\"status\":\"in_progress\"}]}", "", toolIndex: Some(0), toolId: Some("call-s"), toolName: Some("todo_write")),
        Chunk("finish", "", "tool_calls")])
    let final = AgentChunks([Chunk("text", "收到补充。", ""), Chunk("finish", "", "stop")])
    let requests = ArrayList<String>()
    let next: (String) -> Provider = { body => requests.add(body); final }
    let result = ModelAgentLoop().run(first, next, "test-model", TurnToken(), log, DeliveryQueue(32), false)
    @Expect(requests.size, Int64(1))
    @Expect(requests[0].contains("follow-up-42"), true)
    @Expect(log.deriveMessages().contains("user/message: follow-up-42"), true)
    // 摘走发生在 runner 自己新建的那份投影里：手里的旧 handle 不是活视图，
    // 要看清单只能按日志重放，这正好也是「日志是唯一真源」的一条旁证。
    let after = AgentInbox(log)
    @Expect(after.sizeOf("next-step"), Int64(0))
    @Expect(after.sizeOf("next-turn"), Int64(0))
    @Expect(after.badCount, Int64(0))
    @Expect(result.finishReason, "stop")
}

@Test
func modelAgentTruncationAndCancellationNeverExecutePartialTodos() {
    for (reason in ["max-tokens", ""]) {
        let log = SessionLog("model-agent-partial-unused.log")
        let first = AgentChunks([Chunk("tool-call-delta", "{\"todos\":[", "", toolIndex: Some(0), toolId: Some("partial"), toolName: Some("todo_write")), Chunk("finish", "", reason)])
        let next: (String) -> Provider = { _ => throw Exception("must-not-request") }
        let result = ModelAgentLoop().run(first, next, "test", TurnToken(), log, DeliveryQueue(8), false)
        @Expect(TodoStore(log).projectionJson(), "null")
        @Expect(result.settledToolCalls, Int64(0))
    }
    let token = TurnToken()
    token.cancel()
    let first = AgentChunks([])
    let next: (String) -> Provider = { _ => throw Exception("must-not-request") }
    let result = ModelAgentLoop().run(first, next, "test", token, SessionLog("model-agent-cancel-unused.log"), DeliveryQueue(8), false)
    @Expect(result.cancelled, true)
    @Expect(first.closes, Int64(1))
}

@Test
func modelToolsRejectConflictingIdsAndRestoreIndexOrder() {
    let calls = ModelToolCalls()
    calls.push(Chunk("tool-call-delta", "{}", "", toolIndex: Some(1), toolId: Some("b"), toolName: Some("todo_write")))
    calls.push(Chunk("tool-call-delta", "{}", "", toolIndex: Some(0), toolId: Some("a"), toolName: Some("todo_write")))
    @Expect(calls.complete()[0].id, "a")
    var rejected = false
    try { calls.push(Chunk("tool-call-delta", "", "", toolIndex: Some(0), toolId: Some("other"))) } catch (_: Exception) { rejected = true }
    @Expect(rejected, true)
}

@Test
func modelRequestRejectsOrphanResultsAndPendingCalls() {
    let call = ModelToolCall(0)
    call.id = "a"
    call.name = "todo_write"
    call.args = "{}"
    let assistant = modelWireData("{\"role\":\"assistant\",\"content\":\"\",\"tool_calls\":[${call.wireJson()}]}")
    for (events in [[SessionEvent(0, "tool/result", modelToolResultData("a", "{}"))], [SessionEvent(0, "assistant/message", assistant)]]) {
        var rejected = false
        try { modelRequestJson("test", events) } catch (_: Exception) { rejected = true }
        @Expect(rejected, true)
    }
}
