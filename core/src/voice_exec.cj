package core

import std.fs.*
import std.io.*
import std.process.*
import std.time.MonoTime

// 语音真实驱动（H/W70）：可插拔 ASR 子进程实现。
//
// 设计：
//   - `VoiceExecutor(asrBinary, ledger)`：`asrBinary` 默认空字符串，调用方注入真实
//     whisper.cpp / vosk / sherpa-onnx 等可执行文件路径；
//   - `transcribe(wavPath, lang, token)`：spawn 子进程，传 wav 路径与语种，捕获 stdout
//     作为转写文本；stderr 仅诊断；
//   - 权限/审计闭环：`ledger.transcribe` 落 `voice/transcribe` 事件；真正执行后落
//     `voice/exec::<exitCode>`；
//   - fail-closed：二进制不存在、文件不存在、参数非法各自归一为结构化结果，不抛；
//   - 取消：`TurnToken` 在 spawn 前与等待期间生效。

let voicePollMs: Int64 = 50

public class VoiceResult {
    public let ok: Bool
    public let text: String
    public let exitCode: Int64
    public let timedOut: Bool
    public let cancelled: Bool
    public let failureKind: String   // "" | asr-not-found | source-missing | bad-args | asr-exit | timeout | cancelled
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

public class VoiceExecutor {
    let asrBinary: String
    let ledger: VoiceLedger
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
        let args = ["--wav", wav, "--lang", lang]
        let launched = launchAsr(args)
        if (launched.isNone()) {
            return VoiceResult(false, "", Int64(-1), false, false,
                "asr-not-found", "voice-asr-binary-not-found", voiceElapsed(started))
        }
        let proc = launched.getOrThrow()
        let stderrPipe = proc.stdErrPipe
        spawn { => readAllStream(stderrPipe) }
        let stdout = readAllStream(proc.stdOutPipe)

        var code: Int64 = Int64(-1)
        var timedOut = false
        var cancelled = false
        let deadline = MonoTime.now() + Duration.millisecond * timeoutMs
        while (true) {
            if (token.cancelled()) { cancelled = true; break }
            if ((deadline - MonoTime.now()).toMilliseconds() <= 0) { timedOut = true; break }
            try { code = proc.wait(timeout: voicePollMs * Duration.millisecond); break }
            catch (_: Exception) {}
        }
        if (cancelled || timedOut) {
            try { proc.terminate(force: true) } catch (_: Exception) {}
            try { code = proc.wait() } catch (_: Exception) { code = Int64(-1) }
        }
        if (cancelled) {
            return VoiceResult(false, "", code, false, true,
                "cancelled", "voice-cancelled", voiceElapsed(started))
        }
        if (timedOut) {
            return VoiceResult(false, "", code, true, false,
                "timeout", "voice-timeout", voiceElapsed(started))
        }
        ledger.log.append("voice/exec", "${code}")
        if (code == 0) {
            return VoiceResult(true, stdout, code, false, false, "", "", voiceElapsed(started))
        }
        return VoiceResult(false, stdout, code, false, false,
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
