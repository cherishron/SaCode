package core
import std.fs.*
import std.unittest.*
import stdx.encoding.json.*
import std.time.*
import std.sync.*

class BlockingStartAction <: CancellationStartAction {
    let entered = AtomicBool(false)
    let release = AtomicBool(false)
    var calls: Int64 = 0
    public func start(): Bool {
        entered.store(true)
        var attempts = 0
        while (!release.load() && attempts < 1000) {
            sleep(2 * Duration.millisecond)
            attempts += 1
        }
        calls += 1
        return release.load()
    }
}

class ExecutionLaunchBarrier {
    let entered = AtomicBool(false)
    let release = AtomicBool(false)
    func waitUntilReleased(): Unit {
        entered.store(true)
        var attempts = 0
        while (!release.load() && attempts < 1000) {
            sleep(2 * Duration.millisecond)
            attempts += 1
        }
    }
}

func supervisorProposal(executable: String, argv: String, timeout: Int64): String {
    return "{\"workspaceRevision\":1,\"cwd\":\"${jsonEscapeText(canonicalize(".").toString())}\",\"executable\":\"${jsonEscapeText(executable)}\",\"argv\":${argv},\"timeoutMs\":${timeout},\"outputLimit\":64}"
}

@Test
func supervisorDefaultGateDoesNotConsumeAdmission() {
    let path = "${coreTestDir("supervisor-gate")}.log"; removeIfExists(path)
    let log = SessionLog(path); let lease = WriteLease(path); @Expect(lease.acquire(), true)
    SessionWorkspace(log).setDirectory(".")
    let service = ExecutionService(log, lease, "session-1", checkpoint: { => true })
    let state = executionTestApprove(service, service.propose("task-1", "request-1", supervisorProposal("cmd", "[\"/c\",\"echo ok\"]", 1000)), ApprovalDesk(log))
    @ExpectThrows[Exception](ExecutionSupervisor(service).run(state.id, state.revision))
    @Expect(service.describe(state.id).phase, "admitted")
    @Expect(lease.release(), true); removeIfExists(path)
}

@Test
func cancellationAndProcessStartUseOneSerializedCommitPoint() {
    let token = TurnToken()
    let action = BlockingStartAction()
    let starting = spawn { => token.runStartIfNotCancelled(action) }
    for (_ in 0..100) {
        if (action.entered.load()) { break }
        sleep(2 * Duration.millisecond)
    }
    @Expect(action.entered.load(), true)
    let cancellationReturned = AtomicBool(false)
    let cancelling = spawn { => token.cancel(); cancellationReturned.store(true) }
    sleep(20 * Duration.millisecond)
    @Expect(cancellationReturned.load(), false)
    action.release.store(true)
    @Expect(starting.get(2000 * Duration.millisecond), true)
    cancelling.get(2000 * Duration.millisecond)
    @Expect(cancellationReturned.load(), true)
    @Expect(token.cancelled(), true)
    let later = BlockingStartAction()
    @Expect(token.runStartIfNotCancelled(later), false)
    @Expect(later.calls, Int64(0))
}

@Test
func stopDuringStartingBeforeProcessCreationSettlesAsCancelled() {
    let path = coreTestDir("supervisor-stop-before-process") + ".log"
    removeIfExists(path); removeIfExists("${path}.lease", recursive: true)
    let log = SessionLog(path); let lease = WriteLease(path); @Expect(lease.acquire(), true)
    SessionWorkspace(log).setDirectory(".")
    let service = ExecutionService(log, lease, "session-1", checkpoint: { => true })
    let state = executionTestApprove(service, service.propose("task-1", "request-before-process",
        supervisorProposal("cmd", "[\"/c\",\"echo must-not-run\"]", 1000)), ApprovalDesk(log))
    let barrier = ExecutionLaunchBarrier()
    let sandbox = SandboxRuntime(provider: { argv, _ =>
        barrier.waitUntilReleased()
        argv
    })
    let runner = ExecutionSupervisor(service, providerReady: { => true },
        executor: ShellExecutor(sandboxRuntime: sandbox))
    let run = runner.start(state.id, state.revision)
    for (_ in 0..100) {
        if (barrier.entered.load()) { break }
        sleep(2 * Duration.millisecond)
    }
    @Expect(barrier.entered.load(), true)
    let starting = service.describe(state.id)
    @Expect(starting.phase, "starting")
    let stopping = service.stop(state.id, starting.revision)
    @Expect(stopping.phase, "stopping")
    barrier.release.store(true)
    let facts = run.wait(timeoutMs: 5000)
    @Expect(facts.cancelled, true)
    @Expect(facts.exitObserved, false)
    @Expect(service.describe(state.id).phase, "cancelled-before-start")
    @Expect(!service.describe(state.id).result.contains("exitCode"), true)
    @Expect(lease.release(), true); removeIfExists(path)
}

@Test
func supervisorReadinessFlagCannotReplaceSandboxProvider() {
    let path = "${coreTestDir("supervisor-no-sandbox")}.log"
    removeIfExists(path)
    let log = SessionLog(path)
    let lease = WriteLease(path)
    @Expect(lease.acquire(), true)
    try {
        SessionWorkspace(log).setDirectory(".")
        let service = ExecutionService(log, lease, "session-1", checkpoint: { => true })
        let state = executionTestApprove(service, service.propose("task-1", "request-1",
            supervisorProposal("cmd", "[\"/c\",\"echo must-not-run\"]", 1000)), ApprovalDesk(log))
        @ExpectThrows[Exception](ExecutionSupervisor(service, providerReady: { => true }).run(state.id, state.revision))
        @Expect(service.describe(state.id).phase, "unknown")
        @Expect(service.describe(state.id).result, "provider-start-failed")
        var started = false
        for (event in log.snapshotEvents()) {
            if (event.data.contains("owned-subprocess:")) { started = true }
        }
        @Expect(started, false)
    } finally { lease.release(); removeIfExists(path) }
}

@Test
func supervisorRealExitAndFailedLaunchStayDistinct() {
    let path = "${coreTestDir("supervisor-real")}.log"; removeIfExists(path)
    let log = SessionLog(path); let lease = WriteLease(path); @Expect(lease.acquire(), true)
    SessionWorkspace(log).setDirectory(".")
    let service = ExecutionService(log, lease, "session-1", checkpoint: { => true })
    let runner = ExecutionSupervisor(service, providerReady: { => true }, executor: ShellExecutor(sandboxRuntime: SandboxRuntime(provider: { argv, _ => argv })))
    let state = executionTestApprove(service, service.propose("task-1", "request-1", supervisorProposal("cmd", "[\"/c\",\"echo out & echo err 1>&2 & exit /b 7\"]", 3000)), ApprovalDesk(log))
    let facts = runner.run(state.id, state.revision)
    @Expect(facts.exitObserved, true); @Expect(facts.exitCode, Int64(7))
    @Expect(facts.stdout.contains("out"), true); @Expect(facts.stderr.contains("err"), true)
    @Expect(service.describe(state.id).phase, "exited")
    @ExpectThrows[Exception](runner.run(state.id, state.revision))
    let missing = executionTestApprove(service, service.propose("task-2", "request-2", supervisorProposal("not-a-real-supplied-program.exe", "[]", 1000)), ApprovalDesk(log))
    @ExpectThrows[Exception](runner.run(missing.id, missing.revision))
    @Expect(service.describe(missing.id).phase, "unknown")
    @Expect(lease.release(), true); removeIfExists(path)
}

@Test
func supervisorRealTimeoutRecordsObservedExit() {
    let path = "${coreTestDir("supervisor-timeout")}.log"; removeIfExists(path)
    let log = SessionLog(path); let lease = WriteLease(path); @Expect(lease.acquire(), true)
    SessionWorkspace(log).setDirectory(".")
    let service = ExecutionService(log, lease, "session-1", checkpoint: { => true })
    let state = executionTestApprove(service, service.propose("task-1", "request-1", supervisorProposal("powershell", "[\"-NoProfile\",\"-NonInteractive\",\"-Command\",\"Start-Sleep -Seconds 5\"]", 200)), ApprovalDesk(log))
    let facts = ExecutionSupervisor(service, providerReady: { => true }, executor: ShellExecutor(sandboxRuntime: SandboxRuntime(provider: { argv, _ => argv }))).run(state.id, state.revision)
    @Expect(facts.timedOut, true); @Expect(facts.exitObserved, true)
    let saved = JsonValue.fromStr(service.describe(state.id).result).asObject()
    @Expect(saved.get("processSucceeded").getOrThrow().asBool().getValue(), false)
    @Expect(lease.release(), true); removeIfExists(path)
}

@Test
func supervisorRealCancellationAndBoundedOutput() {
    let path = "${coreTestDir("supervisor-cancel")}.log"; removeIfExists(path)
    let log = SessionLog(path); let lease = WriteLease(path); @Expect(lease.acquire(), true)
    SessionWorkspace(log).setDirectory(".")
    let service = ExecutionService(log, lease, "session-1", checkpoint: { => true })
    let runner = ExecutionSupervisor(service, providerReady: { => true }, executor: ShellExecutor(sandboxRuntime: SandboxRuntime(provider: { argv, _ => argv })))
    let state = executionTestApprove(service, service.propose("task-1", "request-1", supervisorProposal("powershell", "[\"-NoProfile\",\"-NonInteractive\",\"-Command\",\"Start-Sleep -Seconds 5\"]", 10000)), ApprovalDesk(log))
    let result = spawn { => runner.run(state.id, state.revision) }
    var running = service.describe(state.id)
    for (_ in 0..100) {
        running = service.describe(state.id)
        if (running.phase == "running") { break }
        sleep(20 * Duration.millisecond)
    }
    @Expect(running.phase, "running")
    @Expect(running.result.startsWith("owned-subprocess:"), true)
    service.stop(state.id, running.revision)
    let facts = result.get()
    @Expect(facts.cancelled, true); @Expect(facts.exitObserved, true)
    @Expect(service.describe(state.id).phase, "exited")
    let large = executionTestApprove(service, service.propose("task-2", "request-2", supervisorProposal("powershell", "[\"-NoProfile\",\"-NonInteractive\",\"-Command\",\"[Console]::Write(('x'*10000));[Console]::Error.Write(('y'*10000))\"]", 3000)), ApprovalDesk(log))
    let output = runner.run(large.id, large.revision)
    @Expect(output.stdout.toArray().size, Int64(64)); @Expect(output.stderr.toArray().size, Int64(64))
    @Expect(output.stdoutTruncated && output.stderrTruncated && output.outputComplete, true)
    @Expect(lease.release(), true); removeIfExists(path)
}

@Test
func supervisorAsyncReturnsStartingAndStopsOwnedProcess() {
    let path = "${coreTestDir("supervisor-async")}.log"
    removeIfExists(path); removeIfExists("${path}.lease")
    let log = SessionLog(path); let lease = WriteLease(path); @Expect(lease.acquire(), true)
    SessionWorkspace(log).setDirectory(".")
    let service = ExecutionService(log, lease, "session-1", checkpoint: { => true })
    let runner = ExecutionSupervisor(service, providerReady: { => true }, executor: ShellExecutor(sandboxRuntime: SandboxRuntime(provider: { argv, _ => argv })))
    let state = executionTestApprove(service, service.propose("task-1", "request-async",
        supervisorProposal("powershell", "[\"-NoProfile\",\"-NonInteractive\",\"-Command\",\"Start-Sleep -Seconds 5\"]", 10000)), ApprovalDesk(log))
    let run = runner.start(state.id, state.revision)
    @Expect(run.starting.phase, "starting")
    @ExpectThrows[Exception](runner.start(state.id, state.revision))
    for (_ in 0..100) {
        if (service.describe(state.id).phase == "running") { break }
        sleep(20 * Duration.millisecond)
    }
    @Expect(service.describe(state.id).phase, "running")
    run.cancel()
    let facts = run.wait(timeoutMs: 5000)
    @Expect(run.settled(), true)
    @Expect(facts.cancelled, true)
    @Expect(facts.exitObserved, true)
    @Expect(service.describe(state.id).phase, "exited")
    @Expect(lease.release(), true); removeIfExists(path)
}
