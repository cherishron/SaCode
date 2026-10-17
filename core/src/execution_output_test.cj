package core
import std.fs.*
import std.unittest.*
import stdx.encoding.json.*
import stdx.encoding.base64.*
import std.sync.*
import std.collection.*

@Test
func executionOutputRealProcessPersistsAndPagesAfterReload() {
    let path = "${coreTestDir("execution-output-real")}.log"; removeIfExists(path)
    let log = SessionLog(path); let lease = WriteLease(path); @Expect(lease.acquire(), true)
    SessionWorkspace(log).setDirectory(".")
    let service = ExecutionService(log, lease, "session-1")
    let state = executionTestApprove(service, service.propose("task-1", "request-1", supervisorProposal("cmd", "[\"/c\",\"echo out & echo err 1>&2\"]", 10000)), ApprovalDesk(log))
    let facts = ExecutionSupervisor(service, providerReady: { => true }, executor: ShellExecutor(sandboxRuntime: SandboxRuntime(provider: { argv, _ => argv }))).run(state.id, state.revision)
    @Expect(facts.exitObserved, true)
    let fresh = SessionLog(path); @Expect(fresh.load(), true)
    let restored = ExecutionService(fresh, lease, "session-1")
    @Expect(restored.describe(state.id).phase, "exited")
    var cursor = Int64(-1)
    var count = Int64(0)
    var ends = Int64(0)
    var text = ""
    while (true) {
        let page = JsonValue.fromStr(restored.output(state.id, cursor, Int64(1))).asObject()
        let rows = page.get("records").getOrThrow().asArray()
        @Expect(rows.size() <= 1, true)
        for (i in 0..rows.size()) {
            let row = rows.get(i).getOrThrow().asObject()
            count += 1
            if (row.get("endOfCapture").getOrThrow().asBool().getValue()) {
                ends += 1; @Expect(row.get("eof").getOrThrow().asBool().getValue(), true)
            } else { text += String.fromUtf8(fromBase64String(row.get("data").getOrThrow().asString().getValue()).getOrThrow()) }
        }
        cursor = page.get("nextCursor").getOrThrow().asInt().getValue()
        if (!page.get("hasMore").getOrThrow().asBool().getValue()) { break }
    }
    @Expect(count, Int64(4)); @Expect(ends, Int64(2))
    @Expect(text.contains("out") && text.contains("err"), true)
    @Expect(restored.recover(), Int64(0))
    @ExpectThrows[Exception](restored.output(state.id, Int64(-2), Int64(1)))
    @ExpectThrows[Exception](restored.output(state.id, cursor, Int64(17)))
    @ExpectThrows[Exception](restored.output("different-task", cursor, Int64(1)))
    @Expect(lease.release(), true); removeIfExists(path)
}

@Test
func executionOutputRejectsCorruptionAndFreezesOnPersistenceFailure() {
    let path = "${coreTestDir("execution-output-failure")}.log"; removeIfExists(path)
    let log = SessionLog(path); let lease = WriteLease(path); @Expect(lease.acquire(), true)
    SessionWorkspace(log).setDirectory(".")
    let save = AtomicBool(true)
    let service = ExecutionService(log, lease, "session-1", checkpoint: { => save.load() })
    let state = executionTestApprove(service, service.propose("task-1", "request-1", executionTestProposal()), ApprovalDesk(log))
    let token = TurnToken()
    let starting = service.beginStart(state.id, state.revision, token: token)
    let running = service.startedSupervised(state.id, starting.revision, "owned-test-process")
    service.captureOutput(state.id, "stdout", "中文".toArray())
    @ExpectThrows[Exception](service.finish(state.id, running.revision, Int64(0), false, false, true))
    service.captureOutput(state.id, "stdout", Array<Byte>(), endOfCapture: true, eof: true)
    @ExpectThrows[Exception](service.captureOutput(state.id, "stdout", "late".toArray()))
    @ExpectThrows[Exception](service.captureOutput(state.id, "other", "bad".toArray()))
    save.store(false)
    @ExpectThrows[Exception](service.captureOutput(state.id, "stderr", "unsaved".toArray()))
    @Expect(token.cancelled(), true)
    @ExpectThrows[Exception](service.output(state.id, Int64(-1), Int64(1)))
    @ExpectThrows[Exception](service.finish(state.id, running.revision, Int64(0), false, false, true))
    @Expect(lease.release(), true); removeIfExists(path)
}

@Test
func executionOutputReplayRejectsNonContiguousSequence() {
    let path = "${coreTestDir("execution-output-corrupt")}.log"; removeIfExists(path)
    let log = SessionLog(path); let lease = WriteLease(path); @Expect(lease.acquire(), true)
    SessionWorkspace(log).setDirectory(".")
    let service = ExecutionService(log, lease, "session-1", checkpoint: { => true })
    let state = executionTestApprove(service, service.propose("task-1", "request-1", executionTestProposal()), ApprovalDesk(log))
    let starting = service.beginStart(state.id, state.revision, token: TurnToken())
    service.startedSupervised(state.id, starting.revision, "owned-test-process")
    service.captureOutput(state.id, "stdout", "prefix".toArray())
    let events = log.snapshotEvents()
    let row = JsonValue.fromStr(events[events.size - 1].data).asObject()
    row.put("streamSequence", JsonInt(999))
    log.append("execution/output", row.toString())
    @ExpectThrows[Exception](service.output(state.id, Int64(-1), Int64(1)))
    @Expect(lease.release(), true); removeIfExists(path)
}

@Test
func executionOutputBytePagesPreserveUnicodeAndIncompleteCapture() {
    let path = "${coreTestDir("execution-output-unicode")}.log"; removeIfExists(path)
    let log = SessionLog(path); let lease = WriteLease(path); @Expect(lease.acquire(), true)
    SessionWorkspace(log).setDirectory(".")
    let service = ExecutionService(log, lease, "session-1", checkpoint: { => true })
    let state = executionTestApprove(service, service.propose("task-1", "request-1", executionTestProposal()), ApprovalDesk(log))
    let starting = service.beginStart(state.id, state.revision, token: TurnToken())
    let running = service.startedSupervised(state.id, starting.revision, "owned-test-process")
    var text = ""
    for (_ in 0..300) { text += "汉" }
    let bytes = text.toArray()
    @ExpectThrows[Exception](service.captureOutput(state.id, "stdout", bytes))
    service.captureOutput(state.id, "stdout", bytes[0..512])
    service.captureOutput(state.id, "stdout", bytes[512..bytes.size])
    service.captureOutput(state.id, "stdout", Array<Byte>(), endOfCapture: true, eof: true)
    service.captureOutput(state.id, "stderr", Array<Byte>(), endOfCapture: true, eof: false)
    let page = JsonValue.fromStr(service.output(state.id, Int64(-1), Int64(16))).asObject()
    let rows = page.get("records").getOrThrow().asArray()
    let restored = ArrayList<Byte>()
    for (i in 0..rows.size()) {
        let row = rows.get(i).getOrThrow().asObject()
        let data = fromBase64String(row.get("data").getOrThrow().asString().getValue()).getOrThrow()
        for (byte in data) { restored.add(byte) }
    }
    @Expect(String.fromUtf8(restored.toArray()), text)
    @ExpectThrows[Exception](service.finish(state.id, running.revision, Int64(0), false, false, true))
    let ended = service.finish(state.id, running.revision, Int64(0), false, false, false)
    @Expect(JsonValue.fromStr(ended.result).asObject().get("processSucceeded").getOrThrow().asBool().getValue(), false)
    @Expect(lease.release(), true); removeIfExists(path)
}
