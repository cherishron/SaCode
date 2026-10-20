package host

import core.*
import std.fs.*
import stdx.encoding.json.*

// F06 压缩 Host 接线：只装配 core CompactExecutor 的公开入口，摘录、校验、投影与持久屏障
// 全部仍在 core，本文件不重写。main.cj 尚未注册；调度方按 handles/request 合并。
//
// compact/run:
//   校验可信 activeId、会话日志绑定、工作区绑定和写租约，再调用执行器生成并发布
//   strategy=local-extractive-v1、lossy=true 的本地摘录产物；只回执产物身份与前后字节界。
// compact/describe:
//   纯读，不 append/flush/load，不要求写租约；返回当前投影状态、最近有效产物摘要与
//   indexRevision（已持久 compaction/applied 事件数）。
//
// 客户端参数是闭集：run 只允许 sessionId/requestId，describe 只允许 sessionId。
// 产物正文、历史块、来源区间、字节界、strategy/lossy/已压缩标记等一律拒绝；
// workspace 也不从客户端取，只按会话日志绑定核对，变化后由调度方丢弃并重新装配。
//
// 构造前日志必须已加载；本类不自行加载、不获取/释放租约，也不把租约传给第二个写者。
// 安全点必须由宿主真实状态提供；默认值故意为 busy，未接状态时只会得到 queued。
public class CompactRpcWiring {
    let log: SessionLog
    let lease: WriteLease
    let sessionId: String
    let sessionPath: String
    let workspace: String
    let workspaceRevision: Int64

    // 出帧中、工具未结算或等待审批/计划/提问时不可压缩。默认 busy 是安全侧：
    // 调度方忘记注入真实探针时不会误发布产物。
    public var safetyProbe: () -> CompactSafety = { => CompactSafety(true, false, false, false) }

    // log/path/lease 必须来自同一个真实 Host 会话写者。sessionLogPath 只由可信装配传入，
    // 不是 RPC 参数；Host 侧读取不到 SessionLog 的私有路径，不能靠客户端自报补全。
    public init(log: SessionLog, lease: WriteLease, sessionId: String, sessionLogPath: String) {
        if (sessionId.size == 0 || sessionId.size > 256 || sessionId.contains("\0")) {
            throw Exception("compact-bad-binding")
        }
        if (sessionLogPath.size == 0 || sessionLogPath.contains("\0")) {
            throw Exception("compact-bad-binding")
        }
        let source = Path(sessionLogPath)
        if (!source.isAbsolute() || source.fileName.size == 0) {
            throw Exception("compact-bad-binding")
        }
        var parent = ""
        try {
            parent = canonicalize(source.parent).toString()
        } catch (_: Exception) {
            throw Exception("compact-bad-binding")
        }
        this.log = log
        this.lease = lease
        this.sessionId = sessionId
        this.sessionPath = Path(parent).join(source.fileName).toString()
        let state = SessionWorkspace(log)
        let directory = state.directory()
        var bound = ""
        if (directory.size > 0) {
            try {
                bound = canonicalize(directory).toString()
            } catch (_: Exception) {
                throw Exception("compact-workspace-unavailable")
            }
        }
        this.workspace = bound
        this.workspaceRevision = state.revision()
    }

    public static func handles(method: String): Bool {
        return method == "compact/run" || method == "compact/describe"
    }

    // 供调度方判断是否还能复用本实例：会话对象、activeId、工作区修订任一变化都返回 false。
    // 不能拿同路径重载出的另一个 SessionLog 冒充原日志继续发布产物。
    public func belongsTo(activeId: String, candidate: SessionLog): Bool {
        if (activeId != sessionId || !refEq(candidate, log)) {
            return false
        }
        try {
            checkBinding(activeId, false)
            return true
        } catch (_: Exception) {
            return false
        }
    }

    func executor(): CompactExecutor {
        return CompactExecutor(log, sessionId, lease)
    }

    // 会话与工作区只核对可信绑定；writer 为 true 时再确认租约确实保护本会话日志，
    // 且日志没有进入持久失败冻结。租约的最终复核仍在 core 发布临界区内。
    func checkBinding(activeId: String, writer: Bool): Unit {
        if (activeId != sessionId) {
            throw Exception("compact-session-changed")
        }
        let state = SessionWorkspace(log)
        if (state.revision() != workspaceRevision) {
            throw Exception("compact-workspace-changed")
        }
        var current = ""
        if (state.directory().size > 0) {
            try {
                current = canonicalize(state.directory()).toString()
            } catch (_: Exception) {
                throw Exception("compact-workspace-changed")
            }
        }
        if (current != workspace) {
            throw Exception("compact-workspace-changed")
        }
        // 没有工作区的会话不伪造路径；一旦绑定过工作区，目录消失也不能继续压缩。
        if (workspace.size > 0 && !state.available()) {
            throw Exception("compact-workspace-unavailable")
        }
        if (writer) {
            if (log.isDurableFrozen()) {
                throw Exception("compact-persistence-unavailable")
            }
            if (!lease.protects(sessionPath)) {
                throw Exception("compact-not-writer")
            }
        }
    }

    // 只接受调用方明确给出的 method 闭集；客户端多传一个字段都不解释为“默认值”。
    func requireClosedArguments(args: JsonObject, method: String): Unit {
        for ((key, _) in args.getFields()) {
            if (isClientStateField(key)) {
                throw Exception("compact-client-state-rejected")
            }
        }
        if (method == "compact/run") {
            if (args.size() != 2) {
                throw Exception("compact-bad-arguments")
            }
            for ((key, _) in args.getFields()) {
                if (key != "sessionId" && key != "requestId") {
                    throw Exception("compact-bad-arguments")
                }
            }
            return
        }
        if (method == "compact/describe") {
            if (args.size() != 1) {
                throw Exception("compact-bad-arguments")
            }
            for ((key, _) in args.getFields()) {
                if (key != "sessionId") {
                    throw Exception("compact-bad-arguments")
                }
            }
            return
        }
        throw Exception("compact-method-unknown")
    }

    // 这些字段只能由 core 产物和日志事实产生。即使调用方把它们拼进 params，
    // 也不能进入执行器，更不能用自报的 lossy/compacted 影响回执。
    func isClientStateField(key: String): Bool {
        return key == "artifact" || key == "artifactContent" || key == "artifactJson" ||
            key == "artifactDigest" || key == "compactionId" || key == "replacements" ||
            key == "excerpt" || key == "history" || key == "historyBlocks" || key == "events" ||
            key == "messages" || key == "sourceDigest" || key == "sourceEndSeq" ||
            key == "beforeInputBound" || key == "afterInputBound" || key == "strategy" ||
            key == "lossy" || key == "compacted" || key == "alreadyCompacted" ||
            key == "compressed" || key == "summary"
    }

    func stringField(args: JsonObject, key: String, limit: Int64): String {
        var value = ""
        try {
            value = args.get(key).getOrThrow().asString().getValue()
        } catch (_: Exception) {
            throw Exception("compact-bad-arguments")
        }
        if (value.size == 0 || value.size > limit || value.contains("\0")) {
            throw Exception("compact-bad-arguments")
        }
        return value
    }

    func requestIdOf(value: String): String {
        if (value.size == 0 || value.size > 128 || value.contains("\0")) {
            throw Exception("compact-bad-arguments")
        }
        return value
    }

    // compact/run：执行器的 compact 已在 core 内完成 prepare + 安全点复核 + 持久发布。
    // 本层只把产物身份、摘要和前后字节界变成 Host 可读 JSON，不复制摘录正文。
    public func run(requestId: String, token!: TurnToken = TurnToken()): String {
        let boundRequest = requestIdOf(requestId)
        checkBinding(sessionId, true)
        let prepared = executor().compact(boundRequest, safetyProbe, token: token)
        let out = JsonObject()
        out.put("sessionId", JsonString(sessionId))
        out.put("strategy", JsonString("local-extractive-v1"))
        out.put("lossy", JsonBool(true))
        out.put("status", JsonString(prepared.status))
        out.put("reason", JsonString(prepared.reason))
        out.put("projection", JsonString("available-on-request"))
        out.put("unit", JsonString("utf8-byte-bound"))
        if (let Some(artifact) <- prepared.artifact) {
            let summary = JsonObject()
            summary.put("compactionId", JsonString(artifact.compactionId))
            summary.put("requestId", JsonString(artifact.requestId))
            summary.put("artifactDigest", JsonString(artifact.artifactDigest))
            summary.put("sourceEndSeq", JsonInt(artifact.sourceEndSeq))
            summary.put("sourceDigest", JsonString(artifact.sourceDigest))
            out.put("artifact", summary)
            out.put("artifactAvailable", JsonBool(true))
            out.put("beforeInputBound", JsonInt(artifact.beforeInputBound))
            out.put("afterInputBound", JsonInt(artifact.afterInputBound))
            out.put("savedInputBound", JsonInt(artifact.beforeInputBound - artifact.afterInputBound))
        } else {
            out.put("artifact", JsonNull())
            out.put("artifactAvailable", JsonBool(false))
            out.put("beforeInputBound", JsonNull())
            out.put("afterInputBound", JsonNull())
            out.put("savedInputBound", JsonNull())
        }
        return out.toString()
    }

    // compact/describe：只读当前日志投影。indexRevision 是已持久 applied 的条数，
    // 只用于标识状态修订；产物是否有效、能否生效仍由 core 的 projection 判定。
    public func describe(token!: TurnToken = TurnToken()): String {
        checkBinding(sessionId, false)
        let view = executor().projection(token: token)
        let out = JsonObject()
        out.put("sessionId", JsonString(sessionId))
        out.put("strategy", JsonString("local-extractive-v1"))
        out.put("lossy", JsonBool(true))
        out.put("state", JsonString(stateOf(view)))
        out.put("reason", JsonString(view.reason))
        out.put("indexRevision", JsonInt(durableAppliedRevision()))
        out.put("durableCount", JsonInt(log.durableCount()))
        out.put("eventCount", JsonInt(view.events.size))
        out.put("workspaceBound", JsonBool(workspace.size > 0))
        out.put("workspaceRevision", JsonInt(workspaceRevision))
        out.put("projection", JsonString("available-on-request"))
        out.put("unit", JsonString("utf8-byte-bound"))
        if (view.compactionId.size > 0) {
            let summary = JsonObject()
            summary.put("compactionId", JsonString(view.compactionId))
            summary.put("artifactDigest", JsonString(view.artifactDigest))
            summary.put("sourceEndSeq", JsonInt(view.sourceEndSeq))
            summary.put("strategy", JsonString("local-extractive-v1"))
            summary.put("lossy", JsonBool(true))
            let applied = appliedSummaryOf(view.compactionId, view.artifactDigest)
            if (let Some(record) <- applied) {
                summary.put("requestId", JsonString(record.requestId))
                summary.put("sourceDigest", JsonString(record.sourceDigest))
                out.put("beforeInputBound", JsonInt(record.beforeInputBound))
                out.put("afterInputBound", JsonInt(record.afterInputBound))
                out.put("savedInputBound", JsonInt(record.beforeInputBound - record.afterInputBound))
            } else {
                out.put("beforeInputBound", JsonNull())
                out.put("afterInputBound", JsonNull())
                out.put("savedInputBound", JsonNull())
            }
            out.put("artifact", summary)
            out.put("artifactAvailable", JsonBool(true))
        } else {
            out.put("artifact", JsonNull())
            out.put("artifactAvailable", JsonBool(false))
            out.put("beforeInputBound", JsonNull())
            out.put("afterInputBound", JsonNull())
            out.put("savedInputBound", JsonNull())
        }
        return out.toString()
    }

    func stateOf(view: CompactHistoryView): String {
        if (view.compactionId.size > 0) {
            return "ready"
        }
        if (view.reason == "compact-cancelled") {
            return "cancelled"
        }
        if (view.reason == "compact-invalid-artifact" || view.reason == "compact-persistence-unavailable") {
            return "failed"
        }
        return "full-history"
    }

    // 从已持久前缀里取与 projection 选中产物同 id/digest 的 applied 事件，只读展示元数据。
    // 有效性不在这里重判：能进入 view 的产物已经过 core 的来源重建与哈希校验。
    func appliedSummaryOf(compactionId: String, digest: String): ?CompactAppliedSummary {
        if (compactionId.size == 0 || digest.size == 0) {
            return None
        }
        let durable = log.durableCount()
        let events = log.snapshotEvents()
        var found: ?CompactAppliedSummary = None
        var index = 0
        while (true) {
            if (index >= events.size) {
                break
            }
            let event = events[index]
            index += 1
            if (event.seq >= durable || event.eventType != "compaction/applied") {
                continue
            }
            var record: ?JsonObject = None
            try {
                record = Some(JsonValue.fromStr(event.data).asObject())
            } catch (_: Exception) {
                // 坏事件不是本次选中的产物：跳过，不能让它遮住后面的有效 applied。
                continue
            }
            let obj = record.getOrThrow()
            var matches = false
            try {
                matches = obj.get("compactionId").getOrThrow().asString().getValue() == compactionId &&
                    obj.get("artifactDigest").getOrThrow().asString().getValue() == digest
            } catch (_: Exception) {
                continue
            }
            if (!matches) {
                continue
            }
            // 已匹配同一产物：字段损坏就按“无摘要”处理，不能再用下一条重复事件顶替。
            try {
                let unit = obj.get("unit").getOrThrow().asString().getValue()
                let before = obj.get("beforeInputBound").getOrThrow().asInt().getValue()
                let after = obj.get("afterInputBound").getOrThrow().asInt().getValue()
                if (unit == "utf8-byte-bound" && before >= 0 && after >= 0 && after < before) {
                    found = Some(CompactAppliedSummary(obj.get("requestId").getOrThrow().asString().getValue(),
                        obj.get("sourceDigest").getOrThrow().asString().getValue(), before, after, unit))
                }
            } catch (_: Exception) {
                found = None
            }
            break
        }
        return found
    }

    // indexRevision 只数已持久 applied；内存中尚未 flush 的产物不得推进该修订。
    func durableAppliedRevision(): Int64 {
        let durable = log.durableCount()
        let events = log.snapshotEvents()
        var count: Int64 = 0
        var index = 0
        while (true) {
            if (index >= events.size) {
                break
            }
            let event = events[index]
            index += 1
            if (event.seq < durable && event.eventType == "compaction/applied") {
                count += 1
            }
        }
        return count
    }

    // 调度方入口：params 已是 params 对象；返回 result JSON，由调度方自行封帧。
    // 未声明的 method 直接拒绝，不把未知字段或未知动词转给执行器。
    public func dispatch(method: String, params: JsonObject, activeId: String,
        token!: TurnToken = TurnToken()): String {
        if (!CompactRpcWiring.handles(method)) {
            throw Exception("compact-method-unknown")
        }
        requireClosedArguments(params, method)
        let claimed = stringField(params, "sessionId", 256)
        if (claimed != sessionId || activeId != sessionId) {
            throw Exception("compact-session-changed")
        }
        if (method == "compact/run") {
            return run(stringField(params, "requestId", 128), token: token)
        }
        return describe(token: token)
    }

    // 与现有 Host request 入口同形：body 是完整 JSON-RPC 请求，idText 是已解析的 id。
    // 只处理本类声明的两个 verb；返回 false 表示应由调度方继续分派，不吞别的方法。
    public func request(method: String, body: String, idText: String, activeId: String,
        token!: TurnToken = TurnToken()): Bool {
        if (!CompactRpcWiring.handles(method)) {
            return false
        }
        try {
            // 合法参数只有两个短标识；大体积 body 只可能是产物/历史正文注入，直接拒绝。
            if (body.size > 16384) {
                throw Exception("compact-bad-arguments")
            }
            var params: ?JsonObject = None
            try {
                params = Some(JsonValue.fromStr(body).asObject().get("params").getOrThrow().asObject())
            } catch (_: Exception) {
                // 缺 params、params 不是对象或 JSON 本身损坏都归参数错误，
                // 不能伪装成宿主不可用，也不能把原始正文回显到错误帧。
                throw Exception("compact-bad-arguments")
            }
            let result = dispatch(method, params.getOrThrow(), activeId, token: token)
            emit(okFrame(idText, result))
        } catch (e: Exception) {
            let reason = if (e.message.startsWith("compact-")) {
                e.message
            } else {
                "compact-unavailable"
            }
            emit(errFrame(idText, errorCodeOf(reason), reason))
        }
        return true
    }

    func errorCodeOf(reason: String): Int64 {
        if (reason == "compact-bad-arguments" || reason == "compact-client-state-rejected") {
            return -32602
        }
        if (reason == "compact-session-changed") {
            return -32025
        }
        if (reason == "compact-method-unknown") {
            return -32601
        }
        return -32003
    }

    // 请求侧接缝，不是新增 RPC verb：Host 轮次装配在最终事件快照上复用 core 的
    // compactModelRequestJson，保证后续真实请求使用同一份已校验投影与 D02 预算守卫。
    // 只读，不要求写租约；durableCount 缺省取当前持久前缀，显式传入时不能越过它。
    public func modelRequestJson(model: String, durableCount!: Int64 = -1,
        token!: TurnToken = TurnToken(), tools!: Array<ToolSpec> = [],
        attachStore!: ?AttachmentStore = None, supportsImages!: Bool = false,
        contextWindow!: String = "", modelOutputLimit!: String = "",
        maxOutputTokens!: Int64 = -1): String {
        checkBinding(sessionId, false)
        let durable = if (durableCount < 0) { log.durableCount() } else { durableCount }
        if (durable > log.durableCount()) {
            throw Exception("compact-durable-count-invalid")
        }
        return compactModelRequestJson(model, log.snapshotEvents().toArray(), durable, sessionId,
            token: token, tools: tools, attachStore: attachStore, supportsImages: supportsImages,
            contextWindow: contextWindow, modelOutputLimit: modelOutputLimit,
            maxOutputTokens: maxOutputTokens)
    }
}

// describe 展示用的已持久产物元数据；不保存摘录正文，也不作为第二份事实真源。
class CompactAppliedSummary {
    let requestId: String
    let sourceDigest: String
    let beforeInputBound: Int64
    let afterInputBound: Int64
    let unit: String

    init(requestId: String, sourceDigest: String, beforeInputBound: Int64, afterInputBound: Int64,
        unit: String) {
        this.requestId = requestId
        this.sourceDigest = sourceDigest
        this.beforeInputBound = beforeInputBound
        this.afterInputBound = afterInputBound
        this.unit = unit
    }
}
