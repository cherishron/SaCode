package core

import std.env.getVariable
import std.sync.*
import std.unittest.*
import std.fs.*
import stdx.encoding.json.*

func withPrivateWorkspace(writable: Bool,
    action: (WindowsPrivateWorkspace, WindowsProcessLibrary, WindowsOwnedProfile) -> Unit): Unit {
    let profile = WindowsOwnedProfile()
    try {
        let library = WindowsProcessLibrary(getVariable("SACODE_WINDOWS_PROCESS_DLL").getOrThrow())
        try {
            let scope = WindowsPrivateWorkspace(library, profile, getVariable("SACODE_WINDOWS_SCOPE_PARENT").getOrThrow(),
                "sacode-workspace-cj-${ownProcessId()}-${windowsOwnedProfileSequence.fetchAdd(1)}", writable)
            try { action(scope, library, profile) }
            finally {
                let cleanup = runOwnedProcess(getVariable("SACODE_WORKSPACE_FIXTURE_NODE").getOrThrow(),
                    [getVariable("SACODE_WORKSPACE_CLEANUP_SCRIPT").getOrThrow(), scope.path], None, 5000, 1024,
                    { => false }, { _ => }).getOrThrow()
                @Expect(cleanup.exitCode, Int64(0))
                @Expect(cleanup.stdout.contains("SACODE_WORKSPACE_FIXTURE_CLEANUP confirmed"), true)
                scope.close()
                scope.close()
                @Expect(exists(scope.path), false)
            }
        } finally { library.close() }
    } finally { profile.close() }
}

func privateWorkspaceTask(scope: WindowsPrivateWorkspace, library: WindowsProcessLibrary,
    profile: WindowsOwnedProfile, script: String): ShellResult {
    let directory = scope.requireReady()
    let executable = getVariable("SystemRoot").getOrThrow() + "\\System32\\cmd.exe"
    let log = SessionLog(getVariable("TEMP").getOrThrow() + "\\private-task-${ownProcessId()}-${windowsOwnedProfileSequence.fetchAdd(1)}.log")
    let lease = WriteLease(log.path)
    @Expect(lease.acquire(), true)
    try {
        SessionWorkspace(log).setDirectory(directory)
        let service = ExecutionService(log, lease, "private-session")
        let proposal = "{\"workspaceRevision\":1,\"cwd\":\"${jsonEscapeText(directory)}\",\"executable\":\"${jsonEscapeText(executable)}\",\"argv\":[\"/d\",\"/s\",\"/c\",\"${jsonEscapeText(script)}\"],\"timeoutMs\":5000,\"outputLimit\":64}"
        let state = service.propose("private-task", "private-request", proposal)
        let desk = ApprovalDesk(log)
        let ticket = desk.askForCall("execution/start", service.approvalArguments(state.id))
        @Expect(desk.answer(ticket, "allowed-once"), true)
        let admitted = service.authorize(state.id, state.revision, ticket, desk)
        let provider = WindowsExecutionProcessProvider(library, profile,
            acProbeEnvironment(getVariable("LOCALAPPDATA").getOrThrow(), getVariable("SystemRoot").getOrThrow()),
            executable, directory)
        try {
            let facts = ExecutionSupervisor(service, providerReady: { => true }, processProvider: Some(provider)).run(
                admitted.id, admitted.revision)
            @Expect(service.describe(state.id).phase, "exited")
            return facts
        } finally { provider.cleanup() }
    } finally { lease.release() }
}

@Test
func windowsPrivateWorkspaceTaskWritesOnlyPrivateFilesAndRetainsPreview() {
    withPrivateWorkspace(true, { scope, library, profile =>
        @ExpectThrows[Exception](library.close())
        @ExpectThrows[Exception](profile.close())
        let original = getVariable("TEMP").getOrThrow() + "\\original-${ownProcessId()}.txt"
        File.writeTo(original, "ORIGINAL".toArray())
        // 显式合成夹具字节；这不是生产工作区快照或自动合入实现。
        File.writeTo(scope.requireReady() + "\\input.txt", File.readFrom(original))
        let facts = privateWorkspaceTask(scope, library, profile, "echo CHANGED>input.txt& echo RESULT>result.txt")
        @Expect(facts.exitCode, Int64(0))
        @Expect(facts.exitObserved && facts.outputComplete, true)
        @Expect(String.fromUtf8(File.readFrom(original)), "ORIGINAL")
        @Expect(String.fromUtf8(File.readFrom(scope.path + "\\input.txt")).contains("CHANGED"), true)
        @Expect(String.fromUtf8(File.readFrom(scope.path + "\\result.txt")).contains("RESULT"), true)
        var blocked = false
        try { scope.close() } catch (e: Exception) { blocked = e.message.startsWith("windows-workspace-revoke:") }
        @Expect(blocked, true)
        @Expect(scope.requireReady(), scope.path)
    })
}

@Test
func windowsPrivateWorkspaceReadOnlyTaskCannotOverwriteSeededFile() {
    withPrivateWorkspace(false, { scope, library, profile =>
        File.writeTo(scope.requireReady() + "\\input.txt", "UNCHANGED".toArray())
        let facts = privateWorkspaceTask(scope, library, profile, "echo CORRUPT>input.txt")
        @Expect(facts.exitCode != 0, true)
        @Expect(facts.exitObserved && facts.outputComplete, true)
        @Expect(String.fromUtf8(File.readFrom(scope.path + "\\input.txt")), "UNCHANGED")
    })
}

@Test
func windowsPrivateWorkspaceRejectedCreationReleasesBorrowedOwners() {
    let profile = WindowsOwnedProfile()
    try {
        let library = WindowsProcessLibrary(getVariable("SACODE_WINDOWS_PROCESS_DLL").getOrThrow())
        try {
            @ExpectThrows[Exception](WindowsPrivateWorkspace(library, profile, "relative",
                "sacode-workspace-cj-invalid", true))
            // finally 中两个 close 都必须成功，不能把失败创建留下的引用当成仍在用。
        } finally { library.close() }
    } finally { profile.close() }
}

func withWindowsSupervisor(name: String, script: String,
    action: (ExecutionSupervisor, ExecutionService, ExecutionSnapshot, SessionLog, WriteLease) -> Unit): Unit {
    let path = getVariable("TEMP").getOrThrow() + "\\supervisor-${name}-${ownProcessId()}.log"
    let log = SessionLog(path)
    let lease = WriteLease(path)
    @Expect(lease.acquire(), true)
    try {
        let directory = canonicalize(getVariable("SystemRoot").getOrThrow() + "\\System32").toString()
        let executable = directory + "\\cmd.exe"
        SessionWorkspace(log).setDirectory(directory)
        let service = ExecutionService(log, lease, "native-session")
        let proposal = "{\"workspaceRevision\":1,\"cwd\":\"${jsonEscapeText(directory)}\",\"executable\":\"${jsonEscapeText(executable)}\",\"argv\":[\"/d\",\"/s\",\"/c\",\"${jsonEscapeText(script)}\"],\"timeoutMs\":5000,\"outputLimit\":64}"
        let state = service.propose("native-task", "native-request", proposal)
        let desk = ApprovalDesk(log)
        let ticket = desk.askForCall("execution/start", service.approvalArguments(state.id))
        @Expect(desk.answer(ticket, "allowed-once"), true)
        let admitted = service.authorize(state.id, state.revision, ticket, desk)
        let profile = WindowsOwnedProfile()
        try {
            let library = WindowsProcessLibrary(getVariable("SACODE_WINDOWS_PROCESS_DLL").getOrThrow())
            try {
                let provider = WindowsExecutionProcessProvider(library, profile,
                    acProbeEnvironment(getVariable("LOCALAPPDATA").getOrThrow(), getVariable("SystemRoot").getOrThrow()),
                    executable, directory)
                try {
                    let runner = ExecutionSupervisor(service, providerReady: { => true }, processProvider: Some(provider))
                    action(runner, service, admitted, log, lease)
                } finally { provider.cleanup() }
            } finally { library.close() }
        } finally { profile.close() }
    } finally { lease.release() }
}

@Test
func windowsSupervisorNativeExitOutputAndReplayUseOneLog() {
    withWindowsSupervisor("exit", "echo NATIVE_TASK_OUT& echo NATIVE_TASK_ERR 1>&2& exit /b 7",
        { runner, service, state, log, lease =>
            let facts = runner.run(state.id, state.revision)
            @Expect(facts.exitCode, Int64(7))
            @Expect(facts.stdout.contains("NATIVE_TASK_OUT") && facts.stderr.contains("NATIVE_TASK_ERR"), true)
            @Expect(facts.exitObserved && facts.outputComplete, true)
            @Expect(service.describe(state.id).phase, "exited")
            @ExpectThrows[Exception](runner.run(state.id, state.revision))
            let reloaded = SessionLog(log.path)
            @Expect(reloaded.load(), true)
            let replay = ExecutionService(reloaded, lease, "native-session")
            @Expect(replay.describe(state.id).phase, "exited")
            @Expect(replay.describe(state.id).result, service.describe(state.id).result)
            @Expect(replay.output(state.id, -1, 16).contains("stdout"), true)
            @ExpectThrows[Exception](ExecutionSupervisor(replay, providerReady: { => true }).run(
                state.id, replay.describe(state.id).revision))
        })
}

@Test
func windowsSupervisorNativeStopSettlesWithoutSuccess() {
    withWindowsSupervisor("stop", "for /L %i in (1,1,2147483647) do @rem",
        { runner, service, state, _, _ =>
            let run = runner.start(state.id, state.revision)
            for (_ in 0..200) {
                if (service.describe(state.id).phase == "running") { break }
                sleep(10 * Duration.millisecond)
            }
            let running = service.describe(state.id)
            @Expect(running.phase, "running")
            service.stop(state.id, running.revision)
            let facts = run.wait(timeoutMs: 5000)
            @Expect(facts.cancelled && facts.exitObserved && facts.outputComplete, true)
            let settled = service.describe(state.id)
            @Expect(settled.phase, "exited")
            @Expect(JsonValue.fromStr(settled.result).asObject().get("processSucceeded").getOrThrow().asBool().getValue(), false)
        })
}

@Test
func windowsArgumentEncodingPreservesQuotesSlashesAndEmpty() {
    @Expect(windowsProcessArgument(""), "\"\"")
    @Expect(windowsProcessArgument("a b"), "\"a b\"")
    @Expect(windowsProcessArgument("a\\"), "\"a\\\\\"")
    @Expect(windowsProcessArgument("a\"b"), "\"a\\\"b\"")
    @ExpectThrows[Exception](windowsProcessArgument("a\u{0}b"))
}

class WindowsFixtureRejectedProvider <: ExecutionProcessProvider {
    public func execute(_: ExecutionProcessRequest): ?ShellResult {
        throw Exception("fixture-provider-rejected")
    }
}

@Test
func windowsSupervisorProviderExceptionSettlesUnknownAndDefaultGatePreservesApproval() {
    withWindowsSupervisor("rejected", "echo MUST_NOT_RUN", { _, service, state, _, _ =>
        let provider = WindowsFixtureRejectedProvider()
        let gated = ExecutionSupervisor(service, processProvider: Some(provider))
        @ExpectThrows[Exception](gated.run(state.id, state.revision))
        @Expect(service.describe(state.id).phase, "admitted")
        let runner = ExecutionSupervisor(service, providerReady: { => true }, processProvider: Some(provider))
        @ExpectThrows[Exception](runner.run(state.id, state.revision))
        @Expect(service.describe(state.id).phase, "unknown")
        @Expect(service.describe(state.id).result, "provider-start-failed")
    })
}

func adapterExit(process: WindowsNativeProcess): UInt32 {
    for (_ in 0..200) {
        if (let Some(code) <- process.poll(timeoutMs: 50)) { return code }
    }
    throw Exception("adapter-test-exit-timeout")
}

func adapterTree(process: WindowsNativeProcess): Unit {
    for (_ in 0..500) {
        if (process.active() == 0) { return }
        sleep(10 * Duration.millisecond)
    }
    throw Exception("adapter-test-tree-timeout")
}

func withAdapterOwned(script: String, action: (WindowsNativeProcess) -> Unit): Unit {
    let profile = WindowsOwnedProfile()
    try {
        let library = WindowsProcessLibrary(getVariable("SACODE_WINDOWS_PROCESS_DLL").getOrThrow())
        try {
            let system = getVariable("SystemRoot").getOrThrow() + "\\System32"
            let application = system + "\\cmd.exe"
            let environment = acProbeEnvironment(getVariable("LOCALAPPDATA").getOrThrow(), getVariable("SystemRoot").getOrThrow())
            let creation = library.create(application, "\"${application}\" /d /c ${script}", system, environment, profile)
            if (creation.error != 0) {
                if (let Some(p) <- creation.process) { p.stop(); adapterTree(p); p.close() }
                throw Exception("adapter-test-create:${creation.error}")
            }
            let process = creation.process.getOrThrow()
            try { action(process) }
            finally {
                process.stop()
                adapterTree(process)
                process.close()
            }
        } finally { library.close() }
    } finally { profile.close() }
}

func withAdapterProcess(script: String, limit: Int64,
    action: (WindowsNativeProcess, Future<ShellCapture>, Future<ShellCapture>) -> Unit): Unit {
    withAdapterOwned(script, { process =>
        let stdout = spawn { => readShellBounded(process.pipe(1), limit: limit) }
        let stderr = spawn { => readShellBounded(process.pipe(2), limit: limit) }
        try { action(process, stdout, stderr) }
        finally {
            process.stop()
            adapterTree(process)
            stdout.get(3000 * Duration.millisecond)
            stderr.get(3000 * Duration.millisecond)
        }
    })
}

@Test
func windowsCollectorPreservesCallbacksExitAndBoundedOutput() {
    withAdapterOwned("\"for /L %i in (1,1,2000) do @echo collected-output\"", { process =>
        let created = AtomicBool(false)
        let started = AtomicBool(false)
        let result = collectWindowsProcess(process, TurnToken(), 5000, 32,
            { _ => created.store(true); @Expect(process.poll().isNone(), true) },
            { _ => @Expect(created.load(), true); started.store(true) })
        @Expect(created.load() && started.load(), true)
        @Expect(result.exitCode, Int64(0))
        @Expect(result.exitObserved && result.outputComplete && result.stdoutTruncated, true)
        @Expect(result.stdout.size <= 32, true)
        @Expect(result.cancelled || result.timedOut, false)
    })
}

@Test
func windowsCollectorCancelledBeforeResumeNeverCallsStarted() {
    withAdapterOwned("echo MUST_NOT_RUN", { process =>
        let token = TurnToken()
        token.cancel()
        let started = AtomicBool(false)
        let result = collectWindowsProcess(process, token, 5000, 32, { _ => }, { _ => started.store(true) })
        @Expect(started.load(), false)
        @Expect(result.cancelled && result.exitObserved && result.outputComplete, true)
        @Expect(result.stdout.size + result.stderr.size, Int64(0))
    })
}

@Test
func windowsCollectorTimeoutStopsActualProcessAndDrains() {
    withAdapterOwned("for /L %i in (1,1,2147483647) do @rem", { process =>
        let result = collectWindowsProcess(process, TurnToken(), 100, 32, { _ => }, { _ => })
        @Expect(result.timedOut && result.exitObserved && result.outputComplete, true)
        @Expect(result.cancelled, false)
        @Expect(process.active(), UInt32(0))
    })
}

@Test
func windowsCollectorFailedCreatedReceiptStopsWithoutResume() {
    withAdapterOwned("echo MUST_NOT_RUN", { process =>
        var rejected = false
        let started = AtomicBool(false)
        try {
            collectWindowsProcess(process, TurnToken(), 5000, 32,
                { _ => throw Exception("fixture-persist-failed") }, { _ => started.store(true) })
        } catch (e: Exception) { rejected = e.message == "fixture-persist-failed" }
        @Expect(rejected, true)
        @Expect(started.load(), false)
        @Expect(adapterExit(process), UInt32(143))
    })
}

@Test
func windowsAdapterUsesActualPipesExitAndResourceOwnership() {
    withAdapterProcess("\"echo CJ_OUT& echo CJ_ERR 1>&2\"", 65536, { process, stdout, stderr =>
        @Expect(process.pid > 0, true)
        @Expect(process.poll().isNone(), true)
        var profileBlocked = false
        try { process.profile.close() } catch (e: Exception) { profileBlocked = e.message == "windows-profile-in-use" }
        @Expect(profileBlocked, true)
        var libraryBlocked = false
        try { process.library.close() } catch (e: Exception) { libraryBlocked = e.message == "windows-process-library-in-use" }
        @Expect(libraryBlocked, true)
        @Expect(process.resume(TurnToken()), true)
        @Expect(adapterExit(process), UInt32(0))
        let out = stdout.get(3000 * Duration.millisecond)
        let err = stderr.get(3000 * Duration.millisecond)
        @Expect(out.text.contains("CJ_OUT"), true)
        @Expect(err.text.contains("CJ_ERR"), true)
        @Expect(out.complete && err.complete, true)
    })
}

@Test
func windowsAdapterCancelledStartNeverResumesAndPipesReachEof() {
    withAdapterProcess("echo MUST_NOT_RUN", 65536, { process, stdout, stderr =>
        let token = TurnToken()
        token.cancel()
        @Expect(process.resume(token), false)
        @Expect(adapterExit(process), UInt32(143))
        let out = stdout.get(3000 * Duration.millisecond)
        let err = stderr.get(3000 * Duration.millisecond)
        @Expect(out.text.size + err.text.size, Int64(0))
        @Expect(out.complete && err.complete, true)
    })
}

@Test
func windowsAdapterKeepsDrainingAfterCaptureLimit() {
    withAdapterProcess("for /L %i in (1,1,2000) do @echo adapter-output", 32, { process, stdout, stderr =>
        @Expect(process.resume(TurnToken()), true)
        @Expect(adapterExit(process), UInt32(0))
        let out = stdout.get(3000 * Duration.millisecond)
        let err = stderr.get(3000 * Duration.millisecond)
        @Expect(out.truncated, true)
        @Expect(out.text.size <= 32, true)
        @Expect(out.complete && err.complete, true)
    })
}

@Test
func windowsAdapterConcurrentStopUnblocksBothReadersAndConfirmsExit() {
    withAdapterProcess("for /L %i in (1,1,2147483647) do @rem", 32, { process, stdout, stderr =>
        let token = TurnToken()
        @Expect(process.resume(token), true)
        let stopping = spawn { => token.cancel(); process.stop() }
        stopping.get(3000 * Duration.millisecond)
        @Expect(adapterExit(process), UInt32(143))
        adapterTree(process)
        @Expect(stdout.get(3000 * Duration.millisecond).complete, true)
        @Expect(stderr.get(3000 * Duration.millisecond).complete, true)
    })
}

@Test
func windowsAdapterFailedCreateReleasesProfileAndLibraryReferences() {
    let profile = WindowsOwnedProfile()
    try {
        let library = WindowsProcessLibrary(getVariable("SACODE_WINDOWS_PROCESS_DLL").getOrThrow())
        try {
            let system = getVariable("SystemRoot").getOrThrow() + "\\System32"
            let missing = "${system}\\SaCode-missing-${ownProcessId()}.exe"
            let result = library.create(missing, "\"${missing}\"", system,
                acProbeEnvironment(getVariable("LOCALAPPDATA").getOrThrow(), getVariable("SystemRoot").getOrThrow()), profile)
            if (let Some(process) <- result.process) { process.stop(); adapterTree(process); process.close() }
            @Expect(result.error != 0, true)
            @Expect(result.process.isNone(), true)
            // Both close calls below must succeed: a failed create must not retain references.
        } finally { library.close() }
    } finally { profile.close() }
}
