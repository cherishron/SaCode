package host

import core.*
import stdx.encoding.json.*

// 仅接线：摘录、产物、校验与投影全部在 core CompactExecutor 内，本文件不重写。
// 一期只暴露本地确定性摘录策略 local-extractive-v1；产物有损，不调用模型，不改 TokenMeter。
// 会话日志与写租约由调用方持有；没有注入时不自行构造跨进程写者。
public class CompactRpc {
    var log: ?SessionLog = None
    var lease: ?WriteLease = None
    var identity = ""
    // 附件仓仅用于校验图片归属；一期不支持图片，缺仓时保持false，不把图片算成可压缩。
    var attach: ?AttachmentStore = None
    // 安全点必须由宿主真实状态提供：出帧中、工具未结算或等待审批/计划/提问时不可压缩。
    public var safetyProbe: () -> CompactSafety = { => CompactSafety(true, false, false, false) }
    public var token: ?TurnToken = None

    public init() {}

    public init(log: SessionLog, sessionIdentity: String, lease: WriteLease, attachStore!: ?AttachmentStore = None,
        supportsImages!: Bool = false) {
        this.log = Some(log)
        this.identity = sessionIdentity
        this.lease = Some(lease)
        this.attach = attachStore
    }

    public func bind(log: SessionLog, sessionIdentity: String, lease: WriteLease,
        attachStore!: ?AttachmentStore = None): Unit {
        this.log = Some(log)
        this.identity = sessionIdentity
        this.lease = Some(lease)
        this.attach = attachStore
    }

    func executor(): CompactExecutor {
        if (log.isNone() || lease.isNone() || identity.size == 0) {
            throw Exception("compact-not-bound")
        }
        return CompactExecutor(log.getOrThrow(), identity, lease.getOrThrow(), attachStore: attach)
    }

    // 摘要不含完整摘录正文：历史原文仍由会话日志真源读取，这里只给可回放产物身份。
    public func summarize(prepared: CompactPreparation): String {
        let out = JsonObject()
        out.put("strategy", JsonString("local-extractive-v1"))
        out.put("lossy", JsonBool(true))
        out.put("status", JsonString(prepared.status))
        out.put("reason", JsonString(prepared.reason))
        out.put("projection", JsonString("available-on-request"))
        if (let Some(artifact) <- prepared.artifact) {
            out.put("compactionId", JsonString(artifact.compactionId))
            out.put("requestId", JsonString(artifact.requestId))
            out.put("artifactDigest", JsonString(artifact.artifactDigest))
            out.put("sourceEndSeq", JsonInt(artifact.sourceEndSeq))
            out.put("sourceDigest", JsonString(artifact.sourceDigest))
            out.put("beforeInputBound", JsonInt(artifact.beforeInputBound))
            out.put("afterInputBound", JsonInt(artifact.afterInputBound))
            out.put("unit", JsonString("utf8-byte-bound"))
            out.put("replacementCount", JsonInt(artifact.toJson().size))
            // 相同输入与策略下产物确定；正文只在产物内，不复制到本摘要。
            out.put("artifactAvailable", JsonBool(true))
        } else {
            out.put("artifactAvailable", JsonBool(false))
        }
        return out.toString()
    }

    public func request(method: String, body: String, id: String, activeId: String): Unit {
        try {
            let args = JsonValue.fromStr(paramsTextOf(body)).asObject()
            if (args.get("sessionId").getOrThrow().asString().getValue() != activeId) {
                throw Exception("compact-session-changed")
            }
            let runner = executor()
            let used = if (token.isSome()) { token.getOrThrow() } else { TurnToken() }
            if (method == "compact/run") {
                if (args.size() != 2) { throw Exception("compact-bad-arguments") }
                let prepared = runner.compact(args.get("requestId").getOrThrow().asString().getValue(), safetyProbe,
                    token: used)
                emit(okFrame(id, summarize(prepared)))
            } else if (method == "compact/describe") {
                if (args.size() != 1) { throw Exception("compact-bad-arguments") }
                let view = runner.projection(token: used)
                let out = JsonObject()
                out.put("strategy", JsonString("local-extractive-v1"))
                out.put("lossy", JsonBool(true))
                out.put("compactionId", JsonString(view.compactionId))
                out.put("artifactDigest", JsonString(view.artifactDigest))
                out.put("reason", JsonString(view.reason))
                out.put("sourceEndSeq", JsonInt(view.sourceEndSeq))
                // 事件只用于内部投影；不把原文转录塞进RPC回执。
                out.put("eventCount", JsonInt(view.events.size))
                emit(okFrame(id, out.toString()))
            } else {
                throw Exception("compact-method-unknown")
            }
        } catch (e: Exception) {
            let reason = if (e.message.startsWith("compact-")) { e.message } else { "compact-unavailable" }
            emit(errFrame(id, -32003, reason))
        }
    }
}
