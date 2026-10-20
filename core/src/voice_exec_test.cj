package core

import std.env.*
import std.fs.*
import std.io.InputStream
import std.process.*
import std.sync.AtomicBool
import std.time.MonoTime
import std.unittest.*

// 合成字节流与本地子进程，不访问麦克风、个人账户、网络或真实 ASR。
class VoiceExecTestStream <: InputStream {
    let bytes: Array<Byte>
    let chunkSize: Int64
    let token: TurnToken
    let cancelAt: Int64
    let delayMs: Int64
    let broken: Bool
    var reads: Int64 = 0
    var offset: Int64 = 0
    init(bytes: Array<Byte>, token!: TurnToken = TurnToken(), chunkSize!: Int64 = 4096,
         cancelAt!: Int64 = -1, delayMs!: Int64 = 0, broken!: Bool = false) {
        this.bytes = bytes; this.token = token; this.chunkSize = chunkSize
        this.cancelAt = cancelAt; this.delayMs = delayMs; this.broken = broken
    }
    public func read(buffer: Array<Byte>): Int64 {
        reads += 1
        if (broken) { throw Exception("voice-fixture-read-failed") }
        if (delayMs > 0) { sleep(delayMs * Duration.millisecond) }
        let count = min(min(buffer.size, chunkSize), bytes.size - offset)
        for (i in 0..count) { buffer[i] = bytes[offset + i] }
        offset += count
        if (reads == cancelAt) { token.cancel() }
        return count
    }
}

func voiceExecFixture(): (String, VoiceLedger) {
    if (!exists("target/tmp")) { Directory.create("target/tmp", recursive: true) }
    let root = Directory.createTemp("target/tmp").toString()
    return (root, VoiceLedger(SessionLog(root + "/session.log")))
}

func voiceExecChild(windows: String, posix: String): SubProcess {
    let onWindows = (getVariable("OS") ?? "") == "Windows_NT"
    return launch(if (onWindows) { "powershell.exe" } else { "/bin/sh" },
        if (onWindows) { ["-NoProfile", "-NonInteractive", "-Command", windows] } else { ["-c", posix] },
        stdIn: ProcessRedirect.Discard, stdOut: ProcessRedirect.Pipe, stdErr: ProcessRedirect.Pipe)
}

@Test
func voiceReadPreservesExactUtf8ByteLimit() {
    let bytes = "中文\n".toArray()
    let exceeded = AtomicBool(false)
    let result = voiceReadBounded(VoiceExecTestStream(bytes, chunkSize: 1), bytes.size, exceeded,
        TurnToken(), MonoTime.now() + Duration.second, AtomicBool(false))
    @Expect(result.failed, false)
    @Expect(String.fromUtf8(result.bytes), "中文\n")
    @Expect(exceeded.load(), false)
}

@Test
func voiceReadRejectsOverflowWithoutReturningPrefix() {
    for (size in [Int64(8), 16384]) {
        let exceeded = AtomicBool(false)
        let result = voiceReadBounded(VoiceExecTestStream(Array<Byte>(size, repeat: 120)), 7, exceeded,
            TurnToken(), MonoTime.now() + Duration.second, AtomicBool(false))
        @Expect(result.bytes.size, Int64(0))
        @Expect(exceeded.load(), true)
    }
}

@Test
func voiceReadPollsCancellationAfterEveryChunk() {
    let token = TurnToken()
    let stream = VoiceExecTestStream("abcdef".toArray(), token: token, chunkSize: 1, cancelAt: 2)
    let result = voiceReadBounded(stream, 64, AtomicBool(false), token,
        MonoTime.now() + Duration.second, AtomicBool(false))
    @Expect(stream.reads, Int64(2))
    @Expect(result.failed, true)
    @Expect(result.bytes.size, Int64(0))
}

@Test
func voiceReadDoesNotStartAfterCancelDeadlineOrSupervisorStop() {
    for (mode in 0..3) {
        let token = TurnToken()
        if (mode == 0) { token.cancel() }
        let deadline = if (mode == 1) { MonoTime.now() - Duration.second } else { MonoTime.now() + Duration.second }
        let stream = VoiceExecTestStream("abc".toArray())
        let result = voiceReadBounded(stream, 64, AtomicBool(false), token, deadline, AtomicBool(mode == 2))
        @Expect(stream.reads, Int64(0))
        @Expect(result.failed, true)
        @Expect(result.bytes.size, Int64(0))
    }
}

@Test
func voiceReadDiscardsChunkReturnedAfterDeadline() {
    let stream = VoiceExecTestStream("abc".toArray(), delayMs: 50)
    let result = voiceReadBounded(stream, 64, AtomicBool(false), TurnToken(),
        MonoTime.now() + 10 * Duration.millisecond, AtomicBool(false))
    @Expect(stream.reads, Int64(1))
    @Expect(result.failed, true)
    @Expect(result.bytes.size, Int64(0))
}

@Test
func voiceReadFailureIsNotSuccessfulEof() {
    let result = voiceReadBounded(VoiceExecTestStream([], broken: true), 64, AtomicBool(false),
        TurnToken(), MonoTime.now() + Duration.second, AtomicBool(false))
    @Expect(result.failed, true)
    @Expect(result.bytes.size, Int64(0))
}

@Test
func voiceTimeoutDoesNotWaitForSilentStdoutEof() {
    let (root, ledger) = voiceExecFixture()
    try {
        let proc = voiceExecChild("Start-Sleep -Seconds 8", "exec sleep 8")
        let result = VoiceExecutor(ledger: ledger).collectAsr(proc, TurnToken(), 200, MonoTime.now())
        @Expect(result.failureKind, "timeout")
        @Expect(result.timedOut, true)
        @Expect(result.text, "")
        @Expect(result.elapsedMs < 4000, true)
    } finally { removeIfExists(root, recursive: true) }
}

@Test
func voiceCancelDoesNotWaitForPartialStdoutEof() {
    let (root, ledger) = voiceExecFixture()
    try {
        let proc = voiceExecChild("[Console]::Out.Write('partial'); Start-Sleep -Seconds 8", "printf partial; exec sleep 8")
        let token = TurnToken()
        let cancel = spawn { => sleep(200 * Duration.millisecond); token.cancel() }
        let result = VoiceExecutor(ledger: ledger).collectAsr(proc, token, 10000, MonoTime.now())
        cancel.get(Duration.second)
        @Expect(result.failureKind, "cancelled")
        @Expect(result.cancelled, true)
        @Expect(result.text, "")
        @Expect(result.elapsedMs < 4000, true)
    } finally { removeIfExists(root, recursive: true) }
}

@Test
func voiceStdoutAndStderrIndependentlyEnforceLimits() {
    let (root, ledger) = voiceExecFixture()
    try {
        for ((windows, posix) in [
            ("[Console]::Out.Write(('x' * 8192)); Start-Sleep -Seconds 8", "printf '%8192s' x; exec sleep 8"),
            ("[Console]::Out.Write('ok'); [Console]::Error.Write(('x' * 8192)); Start-Sleep -Seconds 8", "printf ok; printf '%8192s' x >&2; exec sleep 8")]) {
            let result = VoiceExecutor(ledger: ledger, maxOutputBytes: 64).collectAsr(
                voiceExecChild(windows, posix), TurnToken(), 10000, MonoTime.now())
            @Expect(result.failureKind, "output-limit")
            @Expect(result.ok, false)
            @Expect(result.text, "")
            @Expect(result.elapsedMs < 4000, true)
        }
    } finally { removeIfExists(root, recursive: true) }
}

@Test
func voiceBothStreamsMayEachReachTheirLimit() {
    let (root, ledger) = voiceExecFixture()
    try {
        let proc = voiceExecChild("[Console]::Out.Write('out'); [Console]::Error.Write('err')", "printf out; printf err >&2")
        let result = VoiceExecutor(ledger: ledger, maxOutputBytes: 3).collectAsr(proc, TurnToken(), 10000, MonoTime.now())
        @Expect(result.ok, true)
        @Expect(result.text, "out")
        @Expect(result.exitCode, Int64(0))
    } finally { removeIfExists(root, recursive: true) }
}

@Test
func voiceNonzeroExitIsNotSuccessfulTranscription() {
    let (root, ledger) = voiceExecFixture()
    try {
        let proc = voiceExecChild("[Console]::Out.Write('partial'); exit 7", "printf partial; exit 7")
        let result = VoiceExecutor(ledger: ledger).collectAsr(proc, TurnToken(), 10000, MonoTime.now())
        @Expect(result.ok, false)
        @Expect(result.failureKind, "asr-exit")
        @Expect(result.exitCode, Int64(7))
    } finally { removeIfExists(root, recursive: true) }
}

@Test
func voiceCancelledTokenWinsOverExpiredDeadline() {
    let (root, ledger) = voiceExecFixture()
    try {
        let token = TurnToken(); token.cancel()
        let proc = voiceExecChild("Start-Sleep -Seconds 8", "exec sleep 8")
        let result = VoiceExecutor(ledger: ledger).collectAsr(proc, token, 1, MonoTime.now() - Duration.second)
        @Expect(result.failureKind, "cancelled")
        @Expect(result.timedOut, false)
    } finally { removeIfExists(root, recursive: true) }
}

@Test
func voiceInvalidLimitsAndExpiredBudgetDoNotLaunch() {
    let (root, ledger) = voiceExecFixture()
    try {
        let exec = VoiceExecutor(ledger: ledger, asrBinary: "missing-voice-fixture")
        @Expect(exec.transcribe("missing.wav", timeoutMs: 0).failureKind, "bad-args")
        @Expect(VoiceExecutor(ledger: ledger, maxOutputBytes: 0).transcribe("missing.wav").failureKind, "bad-args")
        @Expect(exec.transcribe("").message, "voice-empty-path")
        let token = TurnToken(); token.cancel()
        @Expect(exec.transcribe("missing.wav", token: token).failureKind, "cancelled")
        let result = exec.spawnAsr("missing.wav", "zh", TurnToken(), 1, MonoTime.now() - Duration.second)
        @Expect(result.failureKind, "timeout")
        @Expect(result.text, "")
    } finally { removeIfExists(root, recursive: true) }
}
