package core

import std.collection.ArrayList
import std.fs.*
import std.io.InputStream
import std.process.*
import std.sync.AtomicBool
import std.time.MonoTime

// 语音子进程驱动只接受固定 ASR 参数；日志记账不代表调用方已经取得执行授权。
// 两路管道后台有界读取，调用线程监督取消、从调用开始计算的总期限与进程退出。
let voicePollMs: Int64 = 50

public class VoiceResult {
    public let ok: Bool
    public let text: String
    public let exitCode: Int64
    public let timedOut: Bool
    public let cancelled: Bool
    public let failureKind: String   // "" | asr-not-found | source-missing | bad-args | asr-exit | timeout | cancelled | output-limit | io-error
    public let message: String
    public let elapsedMs: Int64

    public init(ok: Bool, text: String, exitCode: Int64, timedOut: Bool, cancelled: Bool,
                failureKind: String, message: String, elapsedMs: Int64) {
        this.ok = ok
        this.text = text
        this.exitCode = exitCode
        this.timedOut = timedOut
        this.cancelled = cancelled
        this.failureKind = failureKind
        this.message = message
        this.elapsedMs = elapsedMs
    }
}

public class VoiceLedger {
    let log: SessionLog
    public init(log: SessionLog) { this.log = log }
    public func transcribe(wav: String, lang: String): Unit {
        log.append("voice/transcribe", "${wav}::${lang}")
    }
}

func voiceElapsed(started: MonoTime): Int64 {
    return (MonoTime.now() - started).toMilliseconds()
}

class VoiceCapture {
    let bytes: Array<Byte>
    let failed: Bool
    init(bytes: Array<Byte>, failed: Bool) { this.bytes = bytes; this.failed = failed }
}

// stdout/stderr 各自最多保留 limit 字节；不使用按行读取，避免无换行输出绕过限额。
// 一旦溢出便通知监督线程终止子进程，不返回截断的转写结果。
func voiceReadBounded(pipe: InputStream, limit: Int64, exceeded: AtomicBool,
                      token: TurnToken, deadline: MonoTime, stopped: AtomicBool): VoiceCapture {
    let kept = ArrayList<Byte>()
    let buffer = Array<Byte>(4096, repeat: 0)
    var failed = false
    var exceededFlag = false
    var interrupted = false
    try {
        while (true) {
            // read 本身可能阻塞；主监督线程保持独立轮询并负责终止进程。
            if (stopped.load() || token.cancelled() || MonoTime.now() >= deadline) {
                interrupted = true
                break
            }
            let count = pipe.read(buffer)
            if (stopped.load() || token.cancelled() || MonoTime.now() >= deadline) {
                interrupted = true
                break
            }
            if (count == 0) { break }
            if (count > limit - kept.size) {
                exceededFlag = true
                break
            }
            for (i in 0..count) { kept.add(buffer[i]) }
        }
    } catch (_: Exception) { failed = true }
    if (failed || interrupted) { return VoiceCapture([], true) }
    if (exceededFlag) { exceeded.store(true); return VoiceCapture([], false) }
    return VoiceCapture(kept.toArray(), false)
}

public class VoiceExecutor {
    let asrBinary: String
    let ledger: VoiceLedger
    // 每一路独立限额，合计保留不超过两倍此值，另有固定大小读取缓冲。
    let maxOutputBytes: Int64

    public init(ledger!: VoiceLedger, asrBinary!: String = "",
                maxOutputBytes!: Int64 = 1048576) {
        this.asrBinary = asrBinary
        this.ledger = ledger
        this.maxOutputBytes = maxOutputBytes
    }

    public func transcribe(wavPath: String, lang!: String = "zh",
                           token!: TurnToken = TurnToken(),
                           timeoutMs!: Int64 = Int64(120000)): VoiceResult {
        let started = MonoTime.now()
        if (token.cancelled()) {
            return VoiceResult(false, "", Int64(-1), false, true,
                "cancelled", "voice-cancelled", voiceElapsed(started))
        }
        if (wavPath.size == 0) {
            return VoiceResult(false, "", Int64(-1), false, false,
                "bad-args", "voice-empty-path", voiceElapsed(started))
        }
        if (timeoutMs <= 0 || maxOutputBytes <= 0) {
            return VoiceResult(false, "", Int64(-1), false, false,
                "bad-args", "voice-invalid-args", voiceElapsed(started))
        }
        var srcExists = false
        try { srcExists = FileInfo(wavPath).isRegular() } catch (_: Exception) { srcExists = false }
        if (!srcExists) {
            return VoiceResult(false, "", Int64(-1), false, false,
                "source-missing", "voice-source-missing", voiceElapsed(started))
        }
        if (asrBinary.size == 0) {
            return VoiceResult(false, "", Int64(-1), false, false,
                "asr-not-found", "voice-asr-binary-not-configured", voiceElapsed(started))
        }
        ledger.transcribe(wavPath, lang)
        return spawnAsr(wavPath, lang, token, timeoutMs, started)
    }

    func spawnAsr(wav: String, lang: String, token: TurnToken, timeoutMs: Int64,
                  started: MonoTime): VoiceResult {
        if (token.cancelled()) {
            return VoiceResult(false, "", -1, false, true, "cancelled", "voice-cancelled", voiceElapsed(started))
        }
        if (voiceElapsed(started) >= timeoutMs) {
            return VoiceResult(false, "", -1, true, false, "timeout", "voice-timeout", voiceElapsed(started))
        }
        let args = ["--wav", wav, "--lang", lang]
        let launched = launchAsr(args)
        if (launched.isNone()) {
            return VoiceResult(false, "", Int64(-1), false, false,
                "asr-not-found", "voice-asr-binary-not-found", voiceElapsed(started))
        }
        return collectAsr(launched.getOrThrow(), token, timeoutMs, started)
    }

    func collectAsr(proc: SubProcess, token: TurnToken, timeoutMs: Int64, started: MonoTime): VoiceResult {
        // 在任何 reader 启动之前固定总期限，不能从读取结束或进程退出后重新计时。
        let deadline = started + timeoutMs * Duration.millisecond
        let exceeded = AtomicBool(false)
        let stopped = AtomicBool(false)
        let stdoutPipe = proc.stdOutPipe
        let stderrPipe = proc.stdErrPipe
        let stdout = spawn { => voiceReadBounded(stdoutPipe, maxOutputBytes, exceeded, token, deadline, stopped) }
        let stderr = spawn { => voiceReadBounded(stderrPipe, maxOutputBytes, exceeded, token, deadline, stopped) }
        var code: Int64 = -1
        var exited = false
        var failure = ""
        var out: Option<VoiceCapture> = None
        var err: Option<VoiceCapture> = None
        while (true) {
            // 先判断取消和总期限，任何输出读取或进程退出均不能抢先返回成功。
            if (token.cancelled()) { failure = "cancelled"; break }
            let remaining = (deadline - MonoTime.now()).toMilliseconds()
            if (remaining <= 0) { failure = "timeout"; break }
            if (exceeded.load()) { failure = "output-limit"; break }
            out = stdout.tryGet()
            err = stderr.tryGet()
            if (token.cancelled()) { failure = "cancelled"; break }
            if (MonoTime.now() >= deadline) { failure = "timeout"; break }
            if (let Some(capture) <- out) {
                if (capture.failed) { failure = "io-error"; break }
            }
            if (let Some(capture) <- err) {
                if (capture.failed) { failure = "io-error"; break }
            }
            // reader 可能在上次检查后刚刚置位，收齐结果时也必须拒绝超限。
            if (exceeded.load()) { failure = "output-limit"; break }
            if (exited && out.isSome() && err.isSome()) { break }
            let interval = min(voicePollMs, remaining) * Duration.millisecond
            if (exited) { sleep(interval) }
            else {
                try { code = proc.wait(timeout: interval); exited = true }
                catch (_: Exception) {}
            }
        }
        if (failure.size > 0) {
            stopped.store(true)
            try { proc.terminate(force: true) } catch (_: Exception) {}
            // 清理也有界；不能在取消路径重新退回无期限 wait/get。
            if (!exited) {
                try { code = proc.wait(timeout: Duration.second); exited = true }
                catch (_: Exception) {}
            }
            try { stdout.get(Duration.millisecond * voicePollMs) } catch (_: Exception) {}
            try { stderr.get(Duration.millisecond * voicePollMs) } catch (_: Exception) {}
            return VoiceResult(false, "", code, failure == "timeout", failure == "cancelled",
                failure, "voice-${failure}", voiceElapsed(started))
        }
        var text = ""
        try { text = String.fromUtf8(out.getOrThrow().bytes) }
        catch (_: Exception) {
            return VoiceResult(false, "", code, false, false, "io-error", "voice-invalid-utf8", voiceElapsed(started))
        }
        // 解码也计入总期限；发布可用文本前再次检查，取消后不泄出部分转写。
        if (token.cancelled()) {
            return VoiceResult(false, "", code, false, true, "cancelled", "voice-cancelled", voiceElapsed(started))
        }
        if (MonoTime.now() >= deadline) {
            return VoiceResult(false, "", code, true, false, "timeout", "voice-timeout", voiceElapsed(started))
        }
        ledger.log.append("voice/exec", "${code}")
        if (code == 0) {
            return VoiceResult(true, text, code, false, false, "", "", voiceElapsed(started))
        }
        return VoiceResult(false, text, code, false, false,
            "asr-exit", "voice-asr-exit-${code}", voiceElapsed(started))
    }

    func launchAsr(args: Array<String>): Option<SubProcess> {
        try {
            let p = launch(asrBinary, args, stdIn: ProcessRedirect.Discard,
                stdOut: ProcessRedirect.Pipe, stdErr: ProcessRedirect.Pipe)
            return Some(p)
        } catch (_: Exception) {
            return None
        }
    }
}
