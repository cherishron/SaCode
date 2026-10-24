package host

import core.*
import std.collection.*
import std.fs.*
import std.sync.*
import stdx.encoding.json.*

class VoiceRpcRecording {
    let path: String
    let digest: String
    let bytes: Int64
    let identity: FileInfo
    init(path: String, digest: String, bytes: Int64) {
        this.path = path
        this.digest = digest
        this.bytes = bytes
        identity = FileInfo(path)
    }
}

class VoiceRpcOperation {
    let id: String
    let kind: String
    let requestId: String
    let binding: String
    let token = TurnToken()
    let draft: JsonValue
    var state = "admitted"
    var text = ""
    var failure = ""
    var sourceDigest = ""
    var model = ""
    var language = ""
    var recordingId = ""
    var elapsedMs: Int64 = 0
    var usage = ""
    var finishReason = ""
    var terminalRecorded = false
    var settled = false
    var slotHeld = false
    var transcription: ?Future<VoiceResult> = None
    var enhancement: ?EnhanceHandle = None
    var charge: ?EnhanceCharge = None
    init(sessionId: String, kind: String, requestId: String, binding: String, draft: JsonValue) {
        id = sha256Hex("${sessionId}:${kind}:${requestId}".toArray())
        this.kind = kind
        this.requestId = requestId
        this.binding = binding
        this.draft = draft
    }
    func terminal(): Bool {
        return state == "succeeded" || state == "failed" || state == "cancelled"
    }
    func refresh(): Unit {
        if (terminal()) {
            return
        }
        if (let Some(future) <- transcription) {
            try {
                if (let Some(result) <- future.tryGet()) {
                    elapsedMs = result.elapsedMs
                    if (token.cancelled() || result.cancelled) {
                        state = "cancelled"
                        failure = "cancelled"
                    } else if (result.ok && result.text.trimAscii().size > 0) {
                        state = "succeeded"
                        text = result.text
                    } else {
                        state = "failed"
                        failure = if (result.failureKind.size > 0) {
                            result.failureKind
                        } else {
                            "empty-transcript"
                        }
                    }
                }
            } catch (_: Exception) {
                state = "failed"
                failure = "transcribe-error"
            }
        }
        if (let Some(handle) <- enhancement) {
            let result = handle.tryOutcome()
            if (!result.running) {
                usage = result.usage
                finishReason = result.finishReason
                if (token.cancelled() || result.cancelled) {
                    state = "cancelled"
                    failure = "cancelled"
                } else if (result.ok && result.text.trimAscii().size > 0) {
                    state = "succeeded"
                    text = result.text
                } else {
                    state = "failed"
                    failure = "enhance-failed"
                }
            }
        }
    }
    func json(includeText: Bool): JsonObject {
        refresh()
        let out = JsonObject()
        out.put("operationId", JsonString(id));
        out.put("kind", JsonString(kind))
        out.put("requestId", JsonString(requestId));
        out.put("state", JsonString(state))
        out.put("draft", draft)
        // Core 的 ASR 失败清理不保证管道/进程树已释放，不能仅凭 future 结束谎报 released。
        out.put("resourceState",
            JsonString(if (!terminal()) {
                "pending"
            } else if (kind == "transcribe" && state != "succeeded") {
                "unknown"
            } else {
                "released"
            }))
        out.put("settlementState", JsonString(if (settled) {
            "settled"
        } else {
            "pending"
        }))
        if (let Some(receipt) <- charge) {
            out.put("usageVerdict", JsonString(receipt.verdict))
        }
        let available = state == "succeeded" && settled
        out.put("resultAvailable", JsonBool(available))
        if (failure.size > 0) {
            out.put("failureKind", JsonString(failure))
        }
        if (recordingId.size > 0) {
            out.put("recordingId", JsonString(recordingId))
        }
        if (language.size > 0) {
            out.put("language", JsonString(language))
        }
        if (model.size > 0) {
            out.put("model", JsonString(model))
        }
        if (includeText && available) {
            out.put("text", JsonString(text));
            out.put("sourceDigest", JsonString(sourceDigest))
            out.put("elapsedMs", JsonInt(elapsedMs));
            out.put("usage", JsonString(usage))
            out.put("finishReason", JsonString(finishReason))
        }
        return out
    }
}

// 仅供调度方装配，不注册 main/IPC，不采集、不自动发送，不把草稿当 user/message。
// log/desk/lease/meter 必须是同一真实会话；可信窗口归属由上游调度验证。
// 每会话长寿命持有，切换/关闭时 cancel，保留旧实例至 settle 完成，不重绑新日志。
public class VoiceRpc {
    private let log: SessionLog
    private let desk: ApprovalDesk
    private let lease: WriteLease
    private let meter: TokenMeter
    private let sessionId: String
    private let asrBinary: String
    // 本会话隔离根（与 SessionCatalog 同一 CWD 的父目录）。采集适配层把已封存 WAV 落在此目录下的固定子目录，
    // 宿主只按固定命名拼读取，不接受任意路径、URL 或 shell 参数。
    private let sessionRoot: String
    private let enhanceSettings: ?ModelSettingsSnapshot
    private let openEnhance: (String, String, String, TurnToken) -> Provider
    private let acquireEnhance: () -> Bool
    private let releaseEnhance: () -> Unit
    private let mutex = Mutex()
    private let operations = HashMap<String, VoiceRpcOperation>()
    private let requests = HashMap<String, String>()
    private let recordings = HashMap<String, VoiceRpcRecording>()
    private var closed = false

    // 配置快照、ASR 和共享槽只接受可信 Host 注入，不从 renderer 或环境拼接。
    // acquire/release 必须与 prompt/enhance 共用一个槽；缺接线默认拒绝，不双启动。
    public init(log: SessionLog, desk: ApprovalDesk, lease: WriteLease, sessionId: String, meter: TokenMeter,
        asrBinary!: String = "", sessionRoot!: String = "", enhanceSettings!: ?ModelSettingsSnapshot = None,
        acquireEnhance!: () -> Bool = {=> false}, releaseEnhance!: () -> Unit = {=>},
        openEnhance!: (String, String, String, TurnToken) -> Provider = {
            baseUrl, key, request, token => RealSseProvider(baseUrl, key, request, token,
                readTimeout: 90 * Duration.second)
        }) {
        voiceRpcId(sessionId, 256)
        this.log = log
        this.desk = desk
        this.lease = lease
        this.meter = meter
        this.sessionId = sessionId
        this.asrBinary = asrBinary
        this.sessionRoot = sessionRoot
        this.enhanceSettings = enhanceSettings
        this.openEnhance = openEnhance
        this.acquireEnhance = acquireEnhance
        this.releaseEnhance = releaseEnhance
    }

    public static func handles(method: String): Bool {
        return method == "voice/record" || method == "voice/transcribe" || method == "voice/enhance" || method ==
            "voice/describe"
    }
    public func belongsTo(activeId: String, session: SessionLog): Bool {
        return !closed && activeId == sessionId && refEq(session, log)
    }

    // 非 RPC：仅可信自有音频封存/导入适配器可注册已校验格式与隔离范围的 WAV。
    // 不复制/转换/删除文件；适配器须保证注册至任务结束期间音频不可被替换。
    public func registerRecording(recordingId: String, wavPath: String, digest: String): Unit {
        synchronized(mutex) {
            if (closed) {
                throw Exception("voice-closed")
            }
            voiceRpcId(recordingId, 64)
            if (recordings.size >= 32 || recordings.contains(recordingId)) {
                throw Exception("voice-recording-conflict")
            }
            let path = canonicalize(wavPath).toString()
            let info = FileInfo(path)
            if (!Path(wavPath).isAbsolute() || !info.isRegular() || info.size < 1 || info.size > 26214400 ||
                digest.size != 64) {
                throw Exception("voice-bad-recording")
            }
            let recording = VoiceRpcRecording(path, digest, info.size)
            verifyRecording(recording)
            recordings[recordingId] = recording
        }
    }

    // 桌面采集适配层把已封存 WAV 写到本会话隔离目录后，由宿主按固定命名登记为可转写录音。
    // 只接受会话内 `voice/v1/<recordingId>.wav` 单一命名；不接受路径、URL 或 shell 参数。
    private func importRecording(obj: JsonObject): String {
        voiceRpcFields(obj, ["sessionId", "action", "requestId", "recordingId", "digest", "bytes"], ["durationMs"])
        if (voiceRpcStr(obj, "action") != "import") {
            throw Exception("voice-bad-arguments")
        }
        voiceRpcId(voiceRpcStr(obj, "requestId"), 128)
        let recordingId = voiceRpcId(voiceRpcStr(obj, "recordingId"), 64)
        for (b in recordingId.toArray()) {
            if (!((b >= 65 && b <= 90) || (b >= 97 && b <= 122) || (b >= 48 && b <= 57) || b == 95 || b == 45)) {
                throw Exception("voice-bad-arguments")
            }
        }
        let digest = voiceRpcStr(obj, "digest")
        if (digest.size != 64) { throw Exception("voice-bad-recording") }
        for (b in digest.toArray()) {
            if (!((b >= 48 && b <= 57) || (b >= 97 && b <= 102))) { throw Exception("voice-bad-recording") }
        }
        let bytes = obj.get("bytes").getOrThrow().asInt().getValue()
        if (bytes < 44 || bytes > 26214400) { throw Exception("voice-bad-recording") }
        if (sessionRoot.size == 0) { throw Exception("voice-recording-not-found") }
        let path = "${sessionRoot}/voice/v1/${recordingId}.wav"
        if (!exists(path)) { throw Exception("voice-recording-not-found") }
        // 同 id 重复登记且摘要/字节不一致时拒绝，避免把已登记录音替换成另一段音频。
        if (recordings.contains(recordingId)) {
            let existing = recordings[recordingId]
            if (existing.digest != digest || existing.bytes != bytes) {
                throw Exception("voice-recording-conflict")
            }
            return recordingResult(recordingId, obj)
        }
        registerRecording(recordingId, path, digest)
        checkpoint()
        return recordingResult(recordingId, obj)
    }

    private func recordingResult(recordingId: String, obj: JsonObject): String {
        let rec = recordings[recordingId]
        let out = JsonObject()
        out.put("recordingId", JsonString(recordingId))
        out.put("digest", JsonString(rec.digest))
        out.put("bytes", JsonInt(rec.bytes))
        out.put("format", JsonString("wav"))
        if (obj.get("durationMs").isSome()) {
            out.put("durationMs", JsonInt(obj.get("durationMs").getOrThrow().asInt().getValue()))
        }
        return out.toString()
    }

    // 非 RPC：先固定审批提案，调度方通过既有 approval/answer 作答。票据与完整动作绑定。
    public func prepareApproval(method: String, params: String): Int64 {
        synchronized(mutex) {
            let obj = parse(method, params)
            if (method == "voice/record") {
                throw Exception("voice-record-not-available")
            }
            if (method != "voice/transcribe" && method != "voice/enhance") {
                throw Exception("unsupported:voice-method")
            }
            validateStart(method, obj)
            checkpoint()
            let id = desk.askForCall(method, binding(method, obj))
            checkpoint()
            return id
        }
    }

    public func dispatch(method: String, params: String, token!: TurnToken = TurnToken()): String {
        synchronized(mutex) {
            let obj = parse(method, params)
            if (token.cancelled()) {
                throw Exception("voice-cancelled")
            }
            if (method == "voice/record") {
                return importRecording(obj)
            }
            if (method == "voice/describe") {
                return describe(obj)
            }
            let action = voiceRpcStr(obj, "action")
            if (action == "cancel") {
                voiceRpcFields(obj, ["sessionId", "action", "operationId"], ["requestId"])
                let op = lookup(voiceRpcStr(obj, "operationId"))
                if ("voice/${op.kind}" != method) {
                    throw Exception("voice-operation-not-found")
                }
                op.refresh()
                if (!op.terminal()) {
                    op.token.cancel();
                    op.state = "cancel-requested"
                }
                let result = op.json(false);
                result.put("cancelRequested", JsonBool(true))
                return result.toString()
            }
            validateStart(method, obj)
            let expected = binding(method, obj)
            // 客户端拿不到录音摘要与 ASR 二进制，无法自行固定票据；由宿主按规范参数发号，
            // 与 prepareApproval 同义：票据与完整动作绑定，作答后带 approvalId 重试。
            if (obj.get("approvalId").isNone()) {
                checkpoint()
                let id = desk.askForCall(method, expected)
                checkpoint()
                let out = JsonObject()
                out.put("state", JsonString("pending-approval"))
                out.put("approvalId", JsonInt(id))
                out.put("recordingId", JsonString(voiceRpcStr(obj, "recordingId")))
                return out.toString()
            }
            let requestId = voiceRpcStr(obj, "requestId")
            if (let Some(id) <- requests.get(requestId)) {
                let op = operations[id]
                if (op.binding != expected) {
                    throw Exception("voice-request-conflict")
                }
                return op.json(false).toString()
            }
            // 已持久准入但进程内结果丢失时，不自动再次收费或执行。
            let requestKey = sha256Hex("${sessionId}:${requestId}".toArray())
            for (event in log.snapshotEvents()) {
                if (event.eventType == "voice/admitted" && event.data == requestKey) {
                    throw Exception("voice-result-unknown")
                }
            }
            if (operations.size >= 32) {
                throw Exception("voice-capacity")
            }
            for ((_, op) in operations) {
                op.refresh()
                if ("voice/${op.kind}" == method && (!op.terminal() || !op.settled)) {
                    throw Exception("voice-in-flight")
                }
            }
            if (method == "voice/transcribe") {
                verifyRecording(recordings[voiceRpcStr(obj, "recordingId")])
            }
            var key = ""
            if (method == "voice/enhance") {
                key = enhanceKey()
            }
            if (token.cancelled()) {
                throw Exception("voice-cancelled")
            }
            checkpoint()
            var slotHeld = false
            if (method == "voice/enhance") {
                if (!acquireEnhance()) {
                    throw Exception("voice-enhance-slot-unavailable")
                }
                slotHeld = true
            }
            try {
                if (desk.consumeExactForCall(obj.get("approvalId").getOrThrow().asInt().getValue(), method, expected) !=
                    "allowed-once") {
                    throw Exception("not-authorized:voice-approval")
                }
                let kind = if (method == "voice/transcribe") {
                    "transcribe"
                } else {
                    "enhance"
                }
                let draft = if (obj.get("draft").isSome()) {
                    obj.get("draft").getOrThrow()
                } else {
                    JsonNull()
                }
                let op = VoiceRpcOperation(sessionId, kind, requestId, expected, draft)
                operations[op.id] = op
                requests[requestId] = op.id
                log.append("voice/admitted", requestKey)
                try {
                    checkpoint()
                    if (token.cancelled()) {
                        throw Exception("voice-cancelled")
                    }
                    if (method == "voice/transcribe") {
                        startTranscribe(op, obj)
                    } else {
                        startEnhance(op, obj, key);
                        op.slotHeld = true
                    }
                } catch (e: Exception) {
                    op.state = if (token.cancelled()) {
                        "cancelled"
                    } else {
                        "failed"
                    }
                    op.failure = "start-failed"
                    if (e.message == "voice-persistence-failed" || e.message == "voice-cancelled" || e.message ==
                        "voice-source-changed") {
                        throw e
                    }
                    throw Exception("voice-start-failed")
                }
                slotHeld = false
                let result = op.json(false);
                result.put("sessionId", JsonString(sessionId))
                return result.toString()
            } finally {
                if (slotHeld) {
                    releaseEnhance()
                }
            }
        }
    }

    public func request(method: String, body: String, idText: String, activeId: String, session: SessionLog,
        token!: TurnToken = TurnToken()): Bool {
        if (!VoiceRpc.handles(method)) {
            return false
        }
        try {
            if (!belongsTo(activeId, session)) {
                throw Exception("voice-session-changed")
            }
            if (body.size > 16384) {
                throw Exception("voice-capacity")
            }
            let params = JsonValue.fromStr(body).asObject().get("params").getOrThrow().asObject().toString()
            let result = dispatch(method, params, token: token)
            emit(okFrame(idText, result))
        } catch (e: Exception) {
            let reason = if (e.message.startsWith("voice-") || e.message == "not-authorized:voice-approval") {
                e.message
            } else {
                "voice-request-rejected"
            }
            emit(errFrame(idText, if (reason == "voice-bad-arguments") {
                -32602
            } else {
                -32003
            }, reason))
        }
        return true
    }

    // 会话切换/关闭的收束接缝；不复用主 turn token，关闭后仍允许调度方 settle 原账。
    public func cancel(): Unit {
        synchronized(mutex) {
            closed = true
            for ((_, op) in operations) {
                op.refresh();
                if (!op.terminal()) {
                    op.token.cancel()
                }
            }
        }
    }
    // 仅由宿主主线程主动调用；describe 不写日志、不驱动结算。
    public func settle(): Bool {
        synchronized(mutex) {
            var done = true
            for ((_, op) in operations) {
                op.refresh()
                if (!op.terminal()) {
                    done = false
                    continue
                }
                if (op.settled) {
                    continue
                }
                if (let Some(charge) <- op.charge) {
                    if (!charge.settle()) {
                        done = false
                        continue
                    }
                }
                if (!op.terminalRecorded) {
                    log.append("voice/settled", "${op.id}:${op.state}")
                    op.terminalRecorded = true
                }
                checkpoint()
                op.settled = true
                if (op.slotHeld) {
                    releaseEnhance()
                    op.slotHeld = false
                }
            }
            return done
        }
    }

    private func parse(method: String, params: String): JsonObject {
        if (!VoiceRpc.handles(method)) {
            throw Exception("unsupported:voice-method")
        }
        if (closed) {
            throw Exception("voice-closed")
        }
        if (params.size > 12288) {
            throw Exception("voice-capacity")
        }
        let obj = JsonValue.fromStr(params).asObject()
        if (voiceRpcStr(obj, "sessionId") != sessionId) {
            throw Exception("voice-session-changed")
        }
        return obj
    }
    private func checkpoint(): Unit {
        if (log.isDurableFrozen() || !log.durableCheckpoint(lease)) {
            throw Exception("voice-persistence-failed")
        }
    }
    private func validateStart(method: String, obj: JsonObject): Unit {
        if (method == "voice/transcribe") {
            voiceRpcFields(obj, ["sessionId", "action", "requestId", "recordingId", "language"],
                ["approvalId", "providerId", "timeoutMs", "draft"])
            let id = voiceRpcId(voiceRpcStr(obj, "recordingId"), 64)
            if (!recordings.contains(id)) {
                throw Exception("voice-recording-not-found")
            }
            let language = voiceRpcStr(obj, "language")
            if (language != "zh" && language != "auto") {
                throw Exception("voice-bad-arguments")
            }
            if (obj.get("providerId").isSome() && voiceRpcStr(obj, "providerId") != "local-asr") {
                throw Exception("voice-provider-not-configured")
            }
            let timeout = voiceRpcTimeout(obj)
            if (timeout < 1 || timeout > 120000) {
                throw Exception("voice-bad-arguments")
            }
            if (asrBinary.size == 0) {
                throw Exception("voice-asr-not-configured")
            }
        } else {
            voiceRpcFields(obj, ["sessionId", "action", "requestId", "text"],
                ["approvalId", "draft", "sourceTranscriptOperationId"])
            let text = voiceRpcStr(obj, "text")
            if (text.trimAscii().size == 0 || text.size > 8000) {
                throw Exception("voice-bad-arguments")
            }
            if (enhanceSettings.isNone()) {
                throw Exception("voice-model-not-configured")
            }
            let config = enhanceSettings.getOrThrow()
            ModelSettings.validate(config.baseUrl, config.model, config.credentialRef)
            if (obj.get("sourceTranscriptOperationId").isSome()) {
                let source = lookup(voiceRpcStr(obj, "sourceTranscriptOperationId"))
                if (source.kind != "transcribe") {
                    throw Exception("voice-operation-not-found")
                }
            }
        }
        if (voiceRpcStr(obj, "action") != "start") {
            throw Exception("voice-bad-arguments")
        }
        voiceRpcId(voiceRpcStr(obj, "requestId"), 128)
        if (obj.get("draft").isSome()) {
            let draft = obj.get("draft").getOrThrow().asObject()
            voiceRpcFields(draft, ["draftId", "revision"], [])
            voiceRpcId(voiceRpcStr(draft, "draftId"), 128)
            if (draft.get("revision").getOrThrow().asInt().getValue() < 0) {
                throw Exception("voice-bad-arguments")
            }
        }
    }
    private func binding(method: String, obj: JsonObject): String {
        // 数组固定顺序，审批不依赖 JsonObject 的未承诺序列化键顺序。
        let values = JsonArray()
        values.add(JsonString(sessionId));
        values.add(JsonString(method));
        values.add(JsonString(voiceRpcStr(obj, "requestId")))
        if (method == "voice/transcribe") {
            let id = voiceRpcStr(obj, "recordingId");
            let recording = recordings[id]
            for (value in [id, recording.digest, asrBinary, voiceRpcStr(obj, "language")]) {
                values.add(JsonString(value))
            }
            values.add(JsonInt(recording.bytes));
            values.add(JsonInt(voiceRpcTimeout(obj)))
        } else {
            let config = enhanceSettings.getOrThrow()
            for (value in [sha256Hex(voiceRpcStr(obj, "text").toArray()), config.baseUrl, config.model,
                config.credentialRef]) {
                values.add(JsonString(value))
            }
            values.add(JsonString(if (obj.get("sourceTranscriptOperationId").isSome()) {
                voiceRpcStr(obj, "sourceTranscriptOperationId")
            } else {
                ""
            }))
        }
        if (obj.get("draft").isSome()) {
            let draft = obj.get("draft").getOrThrow().asObject()
            values.add(JsonString(voiceRpcStr(draft, "draftId")));
            values.add(draft.get("revision").getOrThrow())
        }
        return values.toString()
    }
    private func verifyRecording(recording: VoiceRpcRecording): Unit {
        let info = FileInfo(recording.path)
        if (!info.isRegular() || info != recording.identity || info.size != recording.bytes || info.size > 26214400) {
            throw Exception("voice-source-changed")
        }
        let bytes = ArrayList<Byte>()
        try (file = File(recording.path, Read)) {
            let buffer = Array<Byte>(8192, repeat: 0)
            var count = file.read(buffer)
            while (count > 0) {
                if (bytes.size + count > recording.bytes) {
                    throw Exception("voice-source-changed")
                }
                for (i in 0..count) {
                    bytes.add(buffer[i])
                }
                count = file.read(buffer)
            }
        }
        if (bytes.size != recording.bytes || sha256Hex(bytes.toArray()) != recording.digest ||
            FileInfo(recording.path) != recording.identity || FileInfo(recording.path).size != recording.bytes) {
            throw Exception("voice-source-changed")
        }
    }
    private func startTranscribe(op: VoiceRpcOperation, obj: JsonObject): Unit {
        op.recordingId = voiceRpcStr(obj, "recordingId")
        op.language = voiceRpcStr(obj, "language")
        let source = recordings[op.recordingId];
        op.sourceDigest = source.digest
        verifyRecording(source)
        let ledger = VoiceLedger(log);
        let binary = asrBinary;
        let language = op.language;
        let timeout = voiceRpcTimeout(obj)
        op.transcription = Some(spawn {
            => VoiceExecutor(ledger: ledger, asrBinary: binary).transcribe(source.path, lang: language, token: op.token,
                timeoutMs: timeout)
        })
        op.state = "running"
    }
    private func enhanceKey(): String {
        let config = enhanceSettings.getOrThrow()
        var key = ""
        if (config.credentialRef.size > 0) {
            if (let Some(credential) <- CredentialStore.forUser().resolve(config.credentialRef)) {
                key = credential.value
            }
        }
        if (key.size == 0 && !config.baseUrl.startsWith("http://127.0.0.1:") &&
            !config.baseUrl.startsWith("http://localhost:")) {
            throw Exception("voice-credential-unavailable")
        }
        return key
    }
    private func startEnhance(op: VoiceRpcOperation, obj: JsonObject, key: String): Unit {
        let config = enhanceSettings.getOrThrow()
        let text = voiceRpcStr(obj, "text");
        let request = enhanceRequestJson(config.model, text)
        op.sourceDigest = sha256Hex(text.toArray())
        op.model = config.model
        let factory: () -> Provider = {=> openEnhance(config.baseUrl, key, request, op.token)}
        let handle = EnhanceRunner().start(factory, op.token)
        op.enhancement = Some(handle)
        op.charge = Some(EnhanceCharge(handle, log, meter, lease))
        op.state = "running"
    }
    private func lookup(id: String): VoiceRpcOperation {
        if (let Some(op) <- operations.get(id)) {
            return op
        }
        throw Exception("voice-operation-not-found")
    }
    private func describe(obj: JsonObject): String {
        voiceRpcFields(obj, ["sessionId"], ["operationId", "recordingId"])
        if (obj.get("operationId").isSome() && obj.get("recordingId").isSome()) {
            throw Exception("voice-bad-arguments")
        }
        if (obj.get("operationId").isSome()) {
            return lookup(voiceRpcStr(obj, "operationId")).json(true).toString()
        }
        if (obj.get("recordingId").isSome()) {
            let id = voiceRpcStr(obj, "recordingId")
            if (!recordings.contains(id)) {
                throw Exception("voice-recording-not-found")
            }
            let out = JsonObject();
            out.put("recordingId", JsonString(id));
            out.put("digest", JsonString(recordings[id].digest))
            out.put("bytes", JsonInt(recordings[id].bytes));
            out.put("format", JsonString("wav"))
            return out.toString()
        }
        let out = JsonObject();
        out.put("sessionId", JsonString(sessionId))
        let record = JsonObject();
        // 采集由桌面适配层完成，宿主只做导入登记；OS 麦克风许可由桌面探测，宿主不猜测。
        let recordReady = sessionRoot.size > 0
        record.put("supported", JsonBool(recordReady));
        record.put("permission", JsonString("unknown"))
        if (!recordReady) { record.put("reason", JsonString("voice-record-unavailable")) }
        out.put("record", record)
        let transcribe = JsonObject();
        transcribe.put("configured", JsonBool(asrBinary.size > 0))
        transcribe.put("registeredRecordings", JsonInt(recordings.size));
        out.put("transcribe", transcribe)
        let enhance = JsonObject();
        enhance.put("configured", JsonBool(enhanceSettings.isSome()))
        enhance.put("readTimeoutMs", JsonInt(90000));
        enhance.put("sharedSlotRequired", JsonBool(true));
        out.put("enhance", enhance)
        let rows = JsonArray();
        for ((_, op) in operations) {
            rows.add(op.json(false))
        };
        out.put("operations", rows)
        return out.toString()
    }
}

func voiceRpcStr(obj: JsonObject, key: String): String {
    return obj.get(key).getOrThrow().asString().getValue()
}

func voiceRpcTimeout(obj: JsonObject): Int64 {
    return if (obj.get("timeoutMs").isSome()) {
        obj.get("timeoutMs").getOrThrow().asInt().getValue()
    } else {
        120000
    }
}

func voiceRpcId(value: String, limit: Int64): String {
    if (value.trimAscii().size == 0 || value.size > limit) {
        throw Exception("voice-bad-arguments")
    }
    for (b in value.toArray()) {
        if (b < 32 || b == 127) {
            throw Exception("voice-bad-arguments")
        }
    }
    return value
}

func voiceRpcFields(obj: JsonObject, required: Array<String>, optional: Array<String>): Unit {
    for (key in required) {
        if (obj.get(key).isNone()) {
            throw Exception("voice-bad-arguments")
        }
    }
    for ((key, _) in obj.getFields()) {
        var allowed = false
        for (name in required) {
            if (key == name) {
                allowed = true
            }
        }
        for (name in optional) {
            if (key == name) {
                allowed = true
            }
        }
        if (!allowed) {
            throw Exception("voice-bad-arguments")
        }
    }
}
