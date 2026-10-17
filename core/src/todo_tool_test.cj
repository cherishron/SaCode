package core
import std.unittest.*
import stdx.encoding.json.*

@Test
func todoToolSchemaAndCanonicalOutputMatchContract() {
    let log = SessionLog("todo-tool-unused.log")
    let tool = TodoTool(log, false)
    let schema = JsonValue.fromStr(tool.spec().params).asObject()
    @Expect(schema.get("additionalProperties").getOrThrow().asBool().getValue(), false)
    let out = JsonValue.fromStr(tool.execute("{\"todos\":[{\"content\":\"  任务  \",\"status\":\"in_progress\"},{\"content\":\"完成\",\"status\":\"completed\"}]}", true)).asObject()
    @Expect(out.get("todos").getOrThrow().asArray().get(0).getOrThrow().asObject().get("content").getOrThrow().asString().getValue(), "任务")
    let counts = out.get("counts").getOrThrow().asObject()
    @Expect(counts.get("pending").getOrThrow().asInt().getValue(), Int64(0))
    @Expect(counts.get("inProgress").getOrThrow().asInt().getValue(), Int64(1))
    @Expect(counts.get("completed").getOrThrow().asInt().getValue(), Int64(1))
    @Expect(log.eventCount(), Int64(1))
    @Expect(log.deriveMessages().size, Int64(0))
}

@Test
func todoToolRejectsUnknownKeysTypesAndNonAgentWithoutSnapshot() {
    let log = SessionLog("todo-tool-invalid-unused.log")
    let tool = TodoTool(log, false)
    for (args in ["{}", "[]", "{\"todos\":[],\"extra\":true}", "{\"todos\":null}",
        "{\"todos\":[{\"content\":3,\"status\":\"pending\"}]}",
        "{\"todos\":[{\"content\":\"任务\",\"status\":\"pending\",\"id\":1}]}",
        "{\"todos\":[{\"content\":\"任务\"}]}",
        "{\"todos\":[{\"content\":\"任务\",\"status\":\"other\"}]}"]) {
        var rejected = false
        try { tool.execute(args, true) } catch (_: Exception) { rejected = true }
        @Expect(rejected, true)
        @Expect(log.eventCount(), Int64(0))
    }
    var reason = ""
    try { tool.execute("{\"todos\":[]}", false) } catch (e: Exception) { reason = e.message }
    @Expect(reason, "todo-requires-agent-session")
    @Expect(log.eventCount(), Int64(0))
}

@Test
func todoToolRuntimeUsesSharedPipelineAndRespectsGuardAndOwnership() {
    let log = SessionLog("todo-tool-runtime-unused.log")
    let registry = ToolRegistry()
    registry.register(TodoTool(log, true).spec())
    let args = "{\"todos\":[{\"content\":\"甲\",\"status\":\"in_progress\"},{\"content\":\"乙\",\"status\":\"in_progress\"}]}"
    let direct = ToolRuntime(log, registry)
    @Expect(direct.execute("todo_write", args, "", true).why, "todo-requires-agent-session")
    @Expect(TodoStore(log).projectionJson(), "null")
    let agent = ToolRuntime(log, registry, agentOwned: true, todoAllowParallel: true)
    @Expect(agent.execute("todo_write", args, "", false).why, "guard-denied")
    @Expect(TodoStore(log).projectionJson(), "null")
    @Expect(agent.execute("todo_write", args, "", true).allowed, true)
    @Expect(TodoStore(log).list().size, Int64(2))
    @Expect(agent.lastDetail.verified, true)
}
