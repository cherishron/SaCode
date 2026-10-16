package core
import std.fs.*
import std.unittest.*
import stdx.encoding.json.*

func executionTestProposal(): String {
    let cwd = jsonEscapeText(canonicalize(".").toString())
    return "{\"workspaceRevision\":1,\"cwd\":\"${cwd}\",\"executable\":\"cmd\",\"argv\":[\"/c\",\"echo ok\"],\"timeoutMs\":1000,\"outputLimit\":4096}"
}
func executionTestApprove(service: ExecutionService, state: ExecutionSnapshot, desk: ApprovalDesk): ExecutionSnapshot {
    let ticket = desk.askForCall("execution/start", service.approvalArguments(state.id))
    @Expect(desk.answer(ticket, "allowed-once"), true)
    return service.authorize(state.id, state.revision, ticket, desk)
}

@Test
func executionCancelBeforeProcessCreationSettlesWithoutInventingExit() {
    let path = "${coreTestDir("execution-cancel-before-create")}.log"
    removeIfExists(path); removeIfExists("${path}.lease", recursive: true)
    let log = SessionLog(path); let lease = WriteLease(path)
    @Expect(lease.acquire(), true)
    SessionWorkspace(log).setDirectory(".")
    let service = ExecutionService(log, lease, "session-1", checkpoint: { => true })
    let state = executionTestApprove(service, service.propose("task-1", "request-1", executionTestProposal()), ApprovalDesk(log))
    let token = TurnToken()
    let starting = service.beginStart(state.id, state.revision, token: Some(token))
    let stopping = service.stop(starting.id, starting.revision)
    let settled = service.cancelledBeforeStart(stopping.id, stopping.revision)
    @Expect(settled.phase, "cancelled-before-start")
    @Expect(settled.result, "")
    @ExpectThrows[Exception](service.startFailed(settled.id, settled.revision, "provider-start-failed"))
    @Expect(service.recover(), Int64(0))
    @Expect(lease.release(), true); removeIfExists(path)
}

@Test
func executionSupervisedStartStopKeepsCancellationAndRejectsRecovery() {
    let path = "${coreTestDir("execution-supervised-start")}.log"
    removeIfExists(path); removeIfExists("${path}.lease", recursive: true)
    let log = SessionLog(path); let lease = WriteLease(path)
    @Expect(lease.acquire(), true)
    SessionWorkspace(log).setDirectory(".")
    let service = ExecutionService(log, lease, "session-1", checkpoint: { => true })
    let state = executionTestApprove(service, service.propose("task-1", "request-1", executionTestProposal()), ApprovalDesk(log))
    let token = TurnToken()
    let starting = service.beginStart(state.id, state.revision, token: token)
    let stopping = service.stop(state.id, starting.revision)
    @Expect(stopping.phase, "stopping"); @Expect(token.cancelled(), true)
    @ExpectThrows[Exception](service.finish(state.id, stopping.revision, Int64(0), false, true, true))
    @ExpectThrows[Exception](service.recover())
    let observed = service.startedSupervised(state.id, stopping.revision, "provider-owned-process")
    @Expect(observed.phase, "stopping")
    @Expect(service.stop(state.id, observed.revision).revision, observed.revision)
    let exited = service.finish(state.id, observed.revision, Int64(0), false, true, true)
    @Expect(JsonValue.fromStr(exited.result).asObject().get("processSucceeded").getOrThrow().asBool().getValue(), false)
    @Expect(lease.release(), true); removeIfExists(path)
}

@Test
func executionSupervisedStartFailureNeverInventsExit() {
    let path = "${coreTestDir("execution-supervised-failure")}.log"
    removeIfExists(path); removeIfExists("${path}.lease", recursive: true)
    let log = SessionLog(path); let lease = WriteLease(path)
    @Expect(lease.acquire(), true)
    SessionWorkspace(log).setDirectory(".")
    let service = ExecutionService(log, lease, "session-1", checkpoint: { => true })
    let state = executionTestApprove(service, service.propose("task-1", "request-1", executionTestProposal()), ApprovalDesk(log))
    let token = TurnToken()
    let starting = service.beginStart(state.id, state.revision, token: token)
    let failed = service.startFailed(state.id, starting.revision, "provider-start-failed")
    @Expect(failed.phase, "unknown"); @Expect(token.cancelled(), true)
    @Expect(!failed.result.contains("exitCode"), true)
    @Expect(service.recover(), Int64(0))
    @ExpectThrows[Exception](service.beginStart(state.id, failed.revision))
    @Expect(lease.release(), true); removeIfExists(path)
}

@Test
func executionDurableCheckpointPreservesPrefixAndRejectsWrongLease() {
    let root = "${coreTestDir("execution-durable 中文")}"
    removeIfExists(root, recursive: true); Directory.create(root)
    let path = "${root}/session.log"
    let log = SessionLog(path); let lease = WriteLease(path)
    log.append("user/message", "首条持久消息")
    @Expect(log.durableCheckpoint(lease), false)
    @Expect(lease.acquire(), true)
    @Expect(log.durableCheckpoint(lease), true)
    let prefix = String.fromUtf8(File.readFrom(path))
    log.append("execution/test", "仅追加第二条")
    @Expect(log.durableCheckpoint(lease), true)
    @Expect(String.fromUtf8(File.readFrom(path)).startsWith(prefix), true)
    let fresh = SessionLog(path); @Expect(fresh.load(), true)
    @Expect(fresh.snapshotEvents().size, Int64(2))
    let other = WriteLease("${root}/other.log"); @Expect(other.acquire(), true)
    @Expect(log.durableCheckpoint(other), false)
    @Expect(other.release(), true); @Expect(lease.release(), true)
    removeIfExists(root, recursive: true)
}

@Test
func executionAdmissionIsIdempotentAndNotReplayedAfterRestart() {
    let root = "${coreTestDir("execution-admission-replay")}"
    removeIfExists(root, recursive: true); Directory.create(root)
    let path = "${root}/session.log"
    let log = SessionLog(path); let lease = WriteLease(path); @Expect(lease.acquire(), true)
    SessionWorkspace(log).setDirectory(".")
    let service = ExecutionService(log, lease, "session-1")
    let proposal = service.propose("task-1", "request-1", executionTestProposal())
    @Expect(service.propose("task-1", "request-1", executionTestProposal()).id, proposal.id)
    @ExpectThrows[Exception](service.propose("different", "request-1", executionTestProposal()))
    let admitted = executionTestApprove(service, proposal, ApprovalDesk(log))
    let fresh = SessionLog(path); @Expect(fresh.load(), true)
    let restored = ExecutionService(fresh, lease, "session-1")
    @ExpectThrows[Exception](restored.beginStart(admitted.id, admitted.revision))
    @Expect(restored.recover(), Int64(1))
    @Expect(restored.describe(admitted.id).phase, "awaiting-approval")
    let again = executionTestApprove(restored, restored.describe(admitted.id), ApprovalDesk(fresh))
    let starting = restored.beginStart(again.id, again.revision)
    @ExpectThrows[Exception](restored.beginStart(starting.id, starting.revision))
    let replay = SessionLog(path); @Expect(replay.load(), true)
    let recovered = ExecutionService(replay, lease, "session-1")
    @Expect(recovered.recover(), Int64(1))
    @Expect(recovered.describe(starting.id).phase, "unknown")
    @Expect(recovered.recover(), Int64(0))
    @ExpectThrows[Exception](ExecutionService(replay, lease, "other-session").describe(starting.id))
    let next = recovered.propose("task-2", "request-2", executionTestProposal())
    @Expect(next.id != starting.id, true)
    @Expect(lease.release(), true); removeIfExists(root, recursive: true)
}

@Test
func executionStopUsesRevisionAndDoesNotCancelOtherTask() {
    let root = "${coreTestDir("execution-stop")}"
    removeIfExists(root, recursive: true); Directory.create(root)
    let path = "${root}/session.log"; let log = SessionLog(path); let lease = WriteLease(path)
    @Expect(lease.acquire(), true)
    SessionWorkspace(log).setDirectory(".")
    let service = ExecutionService(log, lease, "session-1")
    let proposal = service.propose("task-1", "request-1", executionTestProposal())
    let admitted = executionTestApprove(service, proposal, ApprovalDesk(log))
    let starting = service.beginStart(admitted.id, admitted.revision)
    let token = TurnToken(); let other = TurnToken()
    let running = service.started(starting.id, starting.revision, "provider:pid:creation-id", token)
    let second = executionTestApprove(service, service.propose("task-2", "request-2", executionTestProposal()), ApprovalDesk(log))
    let secondStart = service.beginStart(second.id, second.revision)
    service.started(secondStart.id, secondStart.revision, "other-provider:pid:creation-id", other)
    @ExpectThrows[Exception](service.stop(running.id, starting.revision))
    @Expect(token.cancelled(), false)
    let stopping = service.stop(running.id, running.revision)
    @Expect(token.cancelled(), true); @Expect(other.cancelled(), false)
    let exited = service.finish(stopping.id, stopping.revision, Int64(0), false, true, true)
    @Expect(exited.phase, "exited")
    @Expect(JsonValue.fromStr(exited.result).asObject().get("processSucceeded").getOrThrow().asBool().getValue(), false)
    @ExpectThrows[Exception](service.beginStart(exited.id, exited.revision))
    @Expect(lease.release(), true); removeIfExists(root, recursive: true)
}

@Test
func executionCheckpointFailureAndBadTailNeverAdmit() {
    let root = "${coreTestDir("execution-checkpoint-failure")}"
    removeIfExists(root, recursive: true); Directory.create(root)
    let path = "${root}/session.log"; let log = SessionLog(path); let lease = WriteLease(path)
    @Expect(lease.acquire(), true)
    SessionWorkspace(log).setDirectory(".")
    let service = ExecutionService(log, lease, "session-1", checkpoint: { => false })
    @ExpectThrows[Exception](service.propose("task-1", "request-1", executionTestProposal()))
    @ExpectThrows[Exception](service.list())
    @ExpectThrows[Exception](service.beginStart("execution-1", Int64(1)))
    @Expect(log.flushedCount, Int64(0))
    File.writeTo(path, "0\\tbroken-tail".toArray())
    @Expect(log.durableCheckpoint(lease), false)
    @Expect(lease.release(), true); removeIfExists(root, recursive: true)
}

@Test
func executionRejectsLegacyApprovalAndConcurrentDuplicateStart() {
    let root = "${coreTestDir("execution-concurrent")}"
    removeIfExists(root, recursive: true); Directory.create(root)
    let path = "${root}/session.log"; let log = SessionLog(path); let lease = WriteLease(path)
    @Expect(lease.acquire(), true)
    SessionWorkspace(log).setDirectory(".")
    let service = ExecutionService(log, lease, "session-1")
    let proposal = service.propose("task-1", "request-1", executionTestProposal())
    let desk = ApprovalDesk(log)
    let legacy = desk.ask("execution/start"); desk.answer(legacy, "allowed-once")
    @ExpectThrows[Exception](service.authorize(proposal.id, proposal.revision, legacy, desk))
    let admitted = executionTestApprove(service, proposal, desk)
    let one = spawn { => try { service.beginStart(admitted.id, admitted.revision); true } catch (_: Exception) { false } }
    let two = spawn { => try { service.beginStart(admitted.id, admitted.revision); true } catch (_: Exception) { false } }
    @Expect(one.get() != two.get(), true)
    let fresh = SessionLog(path); @Expect(fresh.load(), true)
    let restored = ExecutionService(fresh, lease, "session-1")
    let token = TurnToken()
    @ExpectThrows[Exception](restored.started(admitted.id, restored.describe(admitted.id).revision, "reused-pid", token))
    @Expect(token.cancelled(), true)
    @Expect(lease.release(), true); removeIfExists(root, recursive: true)
}

@Test
func executionReplayRejectsChangedProposalAndUnknownVersion() {
    let root = "${coreTestDir("execution-corrupt")}"
    removeIfExists(root, recursive: true); Directory.create(root)
    let path = "${root}/session.log"; let log = SessionLog(path); let lease = WriteLease(path)
    @Expect(lease.acquire(), true)
    SessionWorkspace(log).setDirectory(".")
    let service = ExecutionService(log, lease, "session-1")
    service.propose("task-1", "request-1", executionTestProposal())
    let obj = JsonValue.fromStr(log.snapshotEvents()[1].data).asObject()
    obj.put("revision", JsonInt(2)); obj.put("phase", JsonString("admitted"))
    obj.put("proposal", JsonString("{}"))
    log.append("execution/state", obj.toString())
    @ExpectThrows[Exception](service.list())
    obj.put("version", JsonInt(999))
    let alien = SessionLog("unused-execution-version.log")
    alien.append("execution/state", obj.toString())
    @ExpectThrows[Exception](ExecutionService(alien, lease, "session-1").list())
    @Expect(lease.release(), true); removeIfExists(root, recursive: true)
}

@Test
func executionWorkspaceSwitchAfterApprovalRejectsStart() {
    let root = "${coreTestDir("execution-workspace-switch")}"
    removeIfExists(root, recursive: true); Directory.create(root)
    let path = "${root}/session.log"; let log = SessionLog(path); let lease = WriteLease(path)
    @Expect(lease.acquire(), true)
    SessionWorkspace(log).setDirectory(".")
    SessionWorkspace(log).setDirectory(".")
    let service = ExecutionService(log, lease, "session-1")
    let admitted = executionTestApprove(service, service.propose("task-1", "request-1", executionTestProposal()), ApprovalDesk(log))
    SessionWorkspace(log).setDirectory(root)
    @ExpectThrows[Exception](service.beginStart(admitted.id, admitted.revision))
    @Expect(service.describe(admitted.id).phase, "admitted")
    @Expect(lease.release(), true); removeIfExists(root, recursive: true)
}
