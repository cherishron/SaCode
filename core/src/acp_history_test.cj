package core
import std.unittest.*
import stdx.encoding.json.*

@Test
func acpHistoryReadsDurableTerminalWithoutSpawning() {
    let f = AcpTaskFixture("end_turn")
    try {
        let done = f.service.runTask(f.snapshot.id, f.snapshot.revision, "fixture task", timeoutMs: 5000)
        let history = AcpHistory(f.log, "s1")
        let list = JsonValue.fromStr(history.dispatch("acp/delegation/list", "{\"sessionId\":\"s1\"}")).asObject()
        @Expect(list.get("delegations").getOrThrow().asArray().size(), 1)
        let detail = JsonValue.fromStr(history.dispatch("acp/delegation/describe", "{\"sessionId\":\"s1\",\"delegationId\":\"${done.id}\"}")).asObject().get("delegation").getOrThrow().asObject()
        @Expect(detail.get("phase").getOrThrow().asString().getValue(), "completed")
        @Expect(detail.get("source").getOrThrow().asString().getValue(), "durable-history")
        @Expect(f.log.pendingCount(), 0)
    } finally { f.close() }
}

@Test
func acpHistoryRejectsSessionMismatchAndUnknownArguments() {
    let f = AcpTaskFixture("end_turn")
    try {
        let history = AcpHistory(f.log, "s1")
        @ExpectThrows[Exception](history.dispatch("acp/delegation/list", "{\"sessionId\":\"other\"}"))
        @ExpectThrows[Exception](history.dispatch("acp/delegation/list", "{\"sessionId\":\"s1\",\"start\":true}"))
        @ExpectThrows[Exception](history.dispatch("acp/delegation/describe", "{\"sessionId\":\"s1\",\"delegationId\":\"missing\"}"))
        @ExpectThrows[Exception](history.dispatch("acp/delegation/start", "{\"sessionId\":\"s1\"}"))
    } finally { f.close() }
}
