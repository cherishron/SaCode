package core

import std.env.getVariable
import std.sync.*
import std.unittest.*

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

func withAdapterProcess(script: String, limit: Int64,
    action: (WindowsNativeProcess, Future<ShellCapture>, Future<ShellCapture>) -> Unit): Unit {
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
            let stdout = spawn { => readShellBounded(process.pipe(1), limit: limit) }
            let stderr = spawn { => readShellBounded(process.pipe(2), limit: limit) }
            try { action(process, stdout, stderr) }
            finally {
                process.stop()
                adapterTree(process)
                // Do not close the native object/DLL while either reader still owns a call.
                stdout.get(3000 * Duration.millisecond)
                stderr.get(3000 * Duration.millisecond)
                process.close()
            }
        } finally { library.close() }
    } finally { profile.close() }
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
