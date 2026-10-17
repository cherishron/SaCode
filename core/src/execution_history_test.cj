package core
import std.fs.*
import std.unittest.*
import stdx.encoding.json.*

func executionHistoryTestProposal(): String {
    let cwd = jsonEscapeText(canonicalize(".").toString())
    return "{\"workspaceRevision\":1,\"cwd\":\"${cwd}\",\"executable\":\"cmd\",\"argv\":[],\"timeoutMs\":1000,\"outputLimit\":4096}"
}

@Test
func executionHistoryIsBoundedReadOnlyAndRestoresCancelledTasks() {
    let path = "${coreTestDir("execution-history")}.log"
    let log = SessionLog(path); let lease = WriteLease(path)
    @Expect(lease.acquire(), true)
    SessionWorkspace(log).setDirectory(".")
    let service = ExecutionService(log, lease, "current")
    let api = ExecutionApi(service, ApprovalDesk(log), "current")
    @Expect(ExecutionApi.readOnly("execution/list"), true)
    let empty = JsonValue.fromStr(api.dispatch("execution/list", ##"{"sessionId":"current","cursor":-1,"limit":1}"##)).asObject()
    @Expect(empty.get("records").getOrThrow().asArray().size(), 0)
    let first = service.propose("task-1", "request-1", executionHistoryTestProposal())
    let second = service.propose("task-2", "request-2", executionHistoryTestProposal())
    service.stop(first.id, first.revision)
    let before = log.snapshotEvents().size
    let page = JsonValue.fromStr(api.dispatch("execution/list", ##"{"sessionId":"current","cursor":-1,"limit":1}"##)).asObject()
    let row = page.get("records").getOrThrow().asArray().get(0).getOrThrow().asObject()
    @Expect(row.get("executionId").getOrThrow().asString().getValue(), first.id)
    @Expect(row.get("phase").getOrThrow().asString().getValue(), "cancelled-before-start")
    @Expect(row.get("proposal").isNone(), true)
    @Expect(row.get("approvalArguments").isNone(), true)
    @Expect(page.get("hasMore").getOrThrow().asBool().getValue(), true)
    @Expect(log.snapshotEvents().size, before)
    lease.release()
    let restored = SessionLog(path); @Expect(restored.load(), true)
    let replay = ExecutionApi(ExecutionService(restored, WriteLease(path), "current"), ApprovalDesk(restored), "current")
    let last = JsonValue.fromStr(replay.dispatch("execution/list", ##"{"sessionId":"current","cursor":0,"limit":16}"##)).asObject()
    @Expect(last.get("records").getOrThrow().asArray().get(0).getOrThrow().asObject().get("executionId").getOrThrow().asString().getValue(), second.id)
    @Expect(last.get("hasMore").getOrThrow().asBool().getValue(), false)
    @ExpectThrows[Exception](replay.dispatch("execution/list", ##"{"sessionId":"other","cursor":-1,"limit":1}"##))
    @ExpectThrows[Exception](replay.dispatch("execution/list", ##"{"sessionId":"current","cursor":-2,"limit":1}"##))
    @ExpectThrows[Exception](replay.dispatch("execution/list", ##"{"sessionId":"current","cursor":-1,"limit":17}"##))
    @ExpectThrows[Exception](replay.dispatch("execution/list", ##"{"sessionId":"current","cursor":2,"limit":1}"##))
    @ExpectThrows[Exception](replay.dispatch("execution/list", ##"{"sessionId":"current","cursor":-1,"limit":1,"start":true}"##))
}
