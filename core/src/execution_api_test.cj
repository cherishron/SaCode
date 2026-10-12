package core
import std.fs.*
import std.unittest.*
import stdx.encoding.json.*

@Test
func executionApiExactApprovalAndUnavailableStart() {
    let path = "${coreTestDir("execution-api-test")}.log"; removeIfExists(path)
    let log = SessionLog(path); let lease = WriteLease(path); @Expect(lease.acquire(), true)
    SessionWorkspace(log).setDirectory(".")
    let service = ExecutionService(log, lease, "current", checkpoint: { => true })
    let desk = ApprovalDesk(log); let api = ExecutionApi(service, desk, "current")
    let input = JsonObject()
    input.put("sessionId", JsonString("current")); input.put("taskId", JsonString("task-1"))
    input.put("requestId", JsonString("request-1")); input.put("proposal", JsonString(executionTestProposal()))
    let proposed = JsonValue.fromStr(api.dispatch("execution/propose", input.toString())).asObject()
    let id = proposed.get("executionId").getOrThrow().asString().getValue()
    @Expect(JsonValue.fromStr(api.dispatch("execution/propose", input.toString())).asObject().get("executionId").getOrThrow().asString().getValue(), id)
    let ticket = desk.askForCall("execution/start", proposed.get("approvalArguments").getOrThrow().asString().getValue())
    @Expect(desk.answer(ticket, "allowed-once"), true)
    let authorize = JsonObject()
    authorize.put("sessionId", JsonString("current")); authorize.put("executionId", JsonString(id))
    authorize.put("revision", JsonInt(1)); authorize.put("proposalDigest", proposed.get("proposalDigest").getOrThrow())
    authorize.put("approvalId", JsonInt(ticket))
    let admitted = JsonValue.fromStr(api.dispatch("execution/authorize", authorize.toString())).asObject()
    @Expect(admitted.get("phase").getOrThrow().asString().getValue(), "admitted")
    @ExpectThrows[Exception](api.dispatch("execution/authorize", authorize.toString()))
    let command = JsonObject()
    command.put("sessionId", JsonString("current")); command.put("executionId", JsonString(id)); command.put("revision", JsonInt(2))
    @ExpectThrows[Exception](api.dispatch("execution/start", command.toString()))
    @Expect(service.describe(id).phase, "admitted")
    @Expect(JsonValue.fromStr(api.dispatch("execution/stop", command.toString())).asObject().get("phase").getOrThrow().asString().getValue(), "cancelled-before-start")
    command.put("sessionId", JsonString("other"))
    @ExpectThrows[Exception](api.dispatch("execution/stop", command.toString()))
    @ExpectThrows[Exception](api.dispatch("execution/other", "{}"))
    @ExpectThrows[Exception](api.dispatch("execution/describe", "{\"sessionId\":\"current\",\"executionId\":\"x\",\"extra\":true}"))
    @Expect(lease.release(), true); removeIfExists(path)
}
