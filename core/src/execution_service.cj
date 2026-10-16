package core
import std.collection.*
import std.fs.*
import stdx.encoding.json.*
import stdx.encoding.base64.*

// 状态只从会话日志重放。进程内许可与取消令牌不能跨重启恢复。
public class ExecutionSnapshot {
    public let id: String
    public let sessionId: String
    public let taskId: String
    public let requestId: String
    public let proposal: String
    public let digest: String
    public let revision: Int64
    public let phase: String
    public let result: String
    public init(id: String, sessionId: String, taskId: String, requestId: String, proposal: String,
        revision: Int64, phase: String, result: String) {
        this.id = id; this.sessionId = sessionId; this.taskId = taskId; this.requestId = requestId
        this.proposal = proposal; this.digest = sha256Hex(proposal.toArray())
        this.revision = revision; this.phase = phase; this.result = result
    }
}

public class ExecutionService {
    let log: SessionLog
    let lease: WriteLease
    let sessionId: String
    let checkpoint: () -> Bool
    let permits = HashMap<String, Bool>()
    let starts = HashMap<String, Bool>()
    let tokens = HashMap<String, TurnToken>()
    var persistenceFailed = false
    public init(log: SessionLog, lease: WriteLease, sessionId: String,
        checkpoint!: () -> Bool = { => log.durableCheckpoint(lease) }) {
        if (sessionId.trimAscii().size == 0) { throw Exception("bad-session-id") }
        this.log = log; this.lease = lease; this.sessionId = sessionId; this.checkpoint = checkpoint
    }
    public func list(): ArrayList<ExecutionSnapshot> {
        synchronized(log.mtx) { return listLocked() }
    }
    private func listLocked(): ArrayList<ExecutionSnapshot> {
        if (persistenceFailed) { throw Exception("persistence-failed") }
        let states = HashMap<String, ExecutionSnapshot>()
        let order = ArrayList<String>()
        for (event in log.snapshotEvents()) {
            if (event.eventType != "execution/state") { continue }
            // 未识别版本或损坏状态拒绝整条执行读面，不静默造空任务。
            let obj = JsonValue.fromStr(event.data).asObject()
            if (obj.get("version").getOrThrow().asInt().getValue() != 1) { throw Exception("execution-format-unsupported") }
            let id = obj.get("executionId").getOrThrow().asString().getValue()
            let state = ExecutionSnapshot(id, obj.get("sessionId").getOrThrow().asString().getValue(),
                obj.get("taskId").getOrThrow().asString().getValue(), obj.get("requestId").getOrThrow().asString().getValue(),
                obj.get("proposal").getOrThrow().asString().getValue(), obj.get("revision").getOrThrow().asInt().getValue(),
                obj.get("phase").getOrThrow().asString().getValue(), obj.get("result").getOrThrow().asString().getValue())
            if (state.sessionId != sessionId) { throw Exception("session-mismatch") }
            if (!states.contains(id)) {
                if (state.revision != 1 || state.phase != "awaiting-approval" ||
                    id != "execution-${event.seq + 1}") { throw Exception("execution-log-corrupt") }
                order.add(id)
            } else {
                let previous = states[id]
                if (state.revision != previous.revision + 1 || state.taskId != previous.taskId ||
                    state.requestId != previous.requestId || state.proposal != previous.proposal ||
                    !validTransition(previous.phase, state.phase)) { throw Exception("execution-log-corrupt") }
            }
            states[id] = state
        }
        let result = ArrayList<ExecutionSnapshot>()
        for (id in order) { result.add(states[id]) }
        return result
    }
    private func validTransition(from: String, to: String): Bool {
        return (from == "awaiting-approval" && (to == "admitted" || to == "cancelled-before-start")) ||
            (from == "admitted" && (to == "admitted" || to == "starting" || to == "awaiting-approval" || to == "cancelled-before-start")) ||
            (from == "starting" && (to == "running" || to == "stopping" || to == "cancelled-before-start" || to == "unknown")) ||
            (from == "running" && (to == "stopping" || to == "exited" || to == "unknown")) ||
            (from == "stopping" && (to == "stopping" || to == "cancelled-before-start" || to == "exited" || to == "unknown"))
    }
    public func describe(id: String): ExecutionSnapshot {
        for (item in list()) { if (item.id == id) { return item } }
        throw Exception("unknown-execution")
    }
    private func writer(): Unit {
        if (persistenceFailed) { throw Exception("persistence-failed") }
        if (lease.ownerToken().size == 0 || lease.currentOwner() != lease.ownerToken()) { throw Exception("not-writer") }
    }
    private func publish(state: ExecutionSnapshot): ExecutionSnapshot {
        writer()
        let obj = JsonObject()
        obj.put("version", JsonInt(1)); obj.put("executionId", JsonString(state.id))
        obj.put("sessionId", JsonString(state.sessionId)); obj.put("taskId", JsonString(state.taskId))
        obj.put("requestId", JsonString(state.requestId)); obj.put("proposal", JsonString(state.proposal))
        obj.put("revision", JsonInt(state.revision)); obj.put("phase", JsonString(state.phase))
        obj.put("result", JsonString(state.result))
        log.append("execution/state", obj.toString())
        var saved = false
        try { saved = checkpoint() } catch (_: Exception) { saved = false }
        if (!saved || lease.currentOwner() != lease.ownerToken()) {
            persistenceFailed = true; throw Exception("persistence-failed")
        }
        return state
    }
    private func transition(state: ExecutionSnapshot, phase: String, result: String): ExecutionSnapshot {
        return publish(ExecutionSnapshot(state.id, sessionId, state.taskId, state.requestId,
            state.proposal, state.revision + 1, phase, result))
    }
    private func expected(id: String, revision: Int64): ExecutionSnapshot {
        writer()
        let state = describe(id)
        if (state.revision != revision) { throw Exception("revision-conflict") }
        return state
    }
    private func checkWorkspace(proposal: String): Unit {
        let obj = JsonValue.fromStr(proposal).asObject()
        let workspace = SessionWorkspace(log)
        var revision = Int64(0)
        for (event in log.snapshotEvents()) { if (event.eventType == "workspace/directory") { revision += 1 } }
        if (!workspace.available() || workspace.directory().size == 0 ||
            obj.get("workspaceRevision").getOrThrow().asInt().getValue() != revision ||
            canonicalize(obj.get("cwd").getOrThrow().asString().getValue()).toString() != workspace.directory()) {
            throw Exception("workspace-changed")
        }
    }
    private func startedState(id: String, revision: Int64, token: TurnToken): ExecutionSnapshot {
        try { return expected(id, revision) }
        catch (e: Exception) { token.cancel(); throw e }
    }
    // 提案是入口已解析的固定执行字段。原始 JSON 也是审批绑定字节，不重编码复用票。
    public func propose(taskId: String, requestId: String, proposal: String): ExecutionSnapshot {
        synchronized(log.mtx) {
            writer()
            if (taskId.trimAscii().size == 0 || requestId.trimAscii().size == 0 || proposal.toArray().size > 1024) {
                throw Exception("bad-arguments")
            }
            let obj = JsonValue.fromStr(proposal).asObject()
            if (obj.size() != 6 || obj.get("cwd").getOrThrow().asString().getValue().size == 0 ||
                obj.get("executable").getOrThrow().asString().getValue().size == 0 ||
                obj.get("workspaceRevision").getOrThrow().asInt().getValue() < 0 ||
                obj.get("timeoutMs").getOrThrow().asInt().getValue() < 1 ||
                obj.get("timeoutMs").getOrThrow().asInt().getValue() > 300000 ||
                obj.get("outputLimit").getOrThrow().asInt().getValue() < 1 ||
                obj.get("outputLimit").getOrThrow().asInt().getValue() > 65536) { throw Exception("bad-arguments") }
            let args = obj.get("argv").getOrThrow().asArray()
            for (index in 0..args.size()) { args.get(index).getOrThrow().asString().getValue() }
            for (item in list()) {
                if (item.requestId == requestId) {
                    if (item.taskId != taskId || item.proposal != proposal) { throw Exception("request-conflict") }
                    return item
                }
            }
            checkWorkspace(proposal)
            return publish(ExecutionSnapshot("execution-${log.snapshotEvents().size + 1}", sessionId,
                taskId, requestId, proposal, Int64(1), "awaiting-approval", ""))
        }
    }
    public func approvalArguments(id: String): String {
        let state = describe(id)
        return "${sessionId}:${state.id}:${state.digest}:${state.proposal}"
    }
    public func authorize(id: String, revision: Int64, approvalId: Int64, desk: ApprovalDesk): ExecutionSnapshot {
        // 审批锁与日志锁不交叉持有，避免 answer/reap 的反向锁顺序。
        let arguments = approvalArguments(id)
        if (desk.consumeExactForCall(approvalId, "execution/start", arguments) != "allowed-once") {
            throw Exception("not-authorized")
        }
        synchronized(log.mtx) {
            let state = expected(id, revision)
            if (state.phase != "awaiting-approval" && state.phase != "admitted") { throw Exception("illegal-execution-transition") }
            checkWorkspace(state.proposal)
            let admitted = transition(state, "admitted", "approval:${approvalId}")
            permits[id] = true
            return admitted
        }
    }
    // 返回 starting 是一次性启动许可，不等于进程已启动。调用者不能重放本许可。
    public func beginStart(id: String, revision: Int64, token!: ?TurnToken = None): ExecutionSnapshot {
        synchronized(log.mtx) {
            let state = expected(id, revision)
            if (state.phase != "admitted" || !permits.contains(id) || !permits[id]) { throw Exception("not-authorized") }
            checkWorkspace(state.proposal)
            permits[id] = false
            let starting = transition(state, "starting", "")
            starts[id] = true
            // 监督者在拿到启动许可前绑定令牌，使 starting 也可接收停止。
            if (let Some(owned) <- token) { tokens[id] = owned }
            return starting
        }
    }
    public func started(id: String, revision: Int64, processIdentity: String, token: TurnToken): ExecutionSnapshot {
        synchronized(log.mtx) {
            if (tokens.contains(id)) { token.cancel(); throw Exception("execution-token-already-bound") }
            return recordStarted(id, revision, processIdentity, token)
        }
    }
    public func startedSupervised(id: String, revision: Int64, processIdentity: String): ExecutionSnapshot {
        synchronized(log.mtx) {
            if (!tokens.contains(id)) { throw Exception("execution-token-unbound") }
            return recordStarted(id, revision, processIdentity, tokens[id])
        }
    }
    private func recordStarted(id: String, revision: Int64, processIdentity: String, token: TurnToken): ExecutionSnapshot {
        synchronized(log.mtx) {
            let state = startedState(id, revision, token)
            if ((state.phase != "starting" && state.phase != "stopping") || processIdentity.trimAscii().size == 0 ||
                !starts.contains(id) || !starts[id]) { token.cancel(); throw Exception("illegal-execution-transition") }
            starts[id] = false
            var running = state
            try { running = transition(state, if (state.phase == "stopping") { "stopping" } else { "running" }, processIdentity) }
            catch (e: Exception) { token.cancel(); throw e }
            tokens[id] = token
            return running
        }
    }
    public func stop(id: String, revision: Int64): ExecutionSnapshot {
        synchronized(log.mtx) {
            let state = expected(id, revision)
            if (state.phase == "awaiting-approval" || state.phase == "admitted") {
                permits[id] = false
                return transition(state, "cancelled-before-start", "")
            }
            if ((state.phase != "starting" && state.phase != "running" && state.phase != "stopping") ||
                !tokens.contains(id)) { throw Exception("stop-unconfirmed") }
            if (state.phase == "stopping") { tokens[id].cancel(); return state }
            // 即使停止事实持久失败，也必须向自己监督的进程发送取消。
            try { return transition(state, "stopping", "cancel-requested") }
            finally { tokens[id].cancel() }
        }
    }
    // 启动失败或进程身份无法落库不能假造退出码；由自身监督者报告未知结果。
    public func startFailed(id: String, revision: Int64, reason: String): ExecutionSnapshot {
        synchronized(log.mtx) {
            let state = expected(id, revision)
            if ((state.phase != "starting" && state.phase != "stopping") ||
                !starts.contains(id) || !starts[id] || reason.trimAscii().size == 0) {
                throw Exception("illegal-execution-transition")
            }
            if (tokens.contains(id)) { tokens[id].cancel() }
            let failed = transition(state, "unknown", reason)
            starts[id] = false
            return failed
        }
    }
    // 只有启动动作与取消已串行化、且进程创建尚未发生时才能确认此终态。
    public func cancelledBeforeStart(id: String, revision: Int64): ExecutionSnapshot {
        synchronized(log.mtx) {
            let state = expected(id, revision)
            if ((state.phase != "starting" && state.phase != "stopping") ||
                !starts.contains(id) || !starts[id] || !tokens.contains(id) || !tokens[id].cancelled()) {
                throw Exception("execution-start-not-cancelled-before-process")
            }
            let cancelled = transition(state, "cancelled-before-start", "")
            starts[id] = false
            return cancelled
        }
    }
    public func supervisionLost(id: String, revision: Int64, reason: String): ExecutionSnapshot {
        synchronized(log.mtx) {
            let state = expected(id, revision)
            if ((state.phase != "running" && state.phase != "stopping") || !tokens.contains(id) ||
                reason.trimAscii().size == 0) { throw Exception("illegal-execution-transition") }
            tokens[id].cancel()
            return transition(state, "unknown", reason)
        }
    }
    public func output(id: String, cursor: Int64, limit: Int64): String {
        synchronized(log.mtx) {
            let state = describe(id)
            let page = JsonValue.fromStr(ExecutionOutput(log, sessionId).page(id, cursor, limit)).asObject()
            page.put("revision", JsonInt(state.revision)); page.put("phase", JsonString(state.phase))
            return page.toString()
        }
    }
    public func captureOutput(id: String, channel: String, data: Array<Byte>,
        endOfCapture!: Bool = false, eof!: Bool = false, truncated!: Bool = false): Unit {
        synchronized(log.mtx) {
            writer()
            let state = describe(id)
            if ((state.phase != "running" && state.phase != "stopping") || !tokens.contains(id) ||
                (starts.contains(id) && starts[id]) || (channel != "stdout" && channel != "stderr") ||
                data.size > 512 || (endOfCapture && data.size != 0) ||
                (!endOfCapture && (data.size == 0 || eof || truncated))) { throw Exception("bad-execution-output") }
            var sequence = Int64(1)
            var count = Int64(0)
            for (row in ExecutionOutput(log, sessionId).records(id)) {
                if (row.get("channel").getOrThrow().asString().getValue() != channel) { continue }
                if (row.get("endOfCapture").getOrThrow().asBool().getValue()) { throw Exception("execution-output-closed") }
                sequence += 1; count += row.get("byteCount").getOrThrow().asInt().getValue()
            }
            let limit = JsonValue.fromStr(state.proposal).asObject().get("outputLimit").getOrThrow().asInt().getValue()
            if (count + data.size > limit) { throw Exception("execution-output-limit") }
            let row = JsonObject()
            row.put("version", JsonInt(1)); row.put("sessionId", JsonString(sessionId)); row.put("executionId", JsonString(id))
            row.put("channel", JsonString(channel)); row.put("streamSequence", JsonInt(sequence))
            row.put("byteCount", JsonInt(data.size)); row.put("data", JsonString(toBase64String(data)))
            row.put("endOfCapture", JsonBool(endOfCapture)); row.put("eof", JsonBool(eof)); row.put("truncated", JsonBool(truncated))
            log.append("execution/output", row.toString())
            var saved = false
            try { saved = checkpoint() } catch (_: Exception) { saved = false }
            if (!saved || lease.currentOwner() != lease.ownerToken()) {
                persistenceFailed = true; tokens[id].cancel(); throw Exception("persistence-failed")
            }
        }
    }
    public func finish(id: String, revision: Int64, exitCode: Int64, timedOut: Bool,
        cancelObserved: Bool, outputComplete: Bool): ExecutionSnapshot {
        synchronized(log.mtx) {
            let state = expected(id, revision)
            if ((state.phase != "running" && state.phase != "stopping") || !tokens.contains(id) ||
                (starts.contains(id) && starts[id])) {
                throw Exception("illegal-execution-transition")
            }
            let facts = JsonObject()
            let output = ExecutionOutput(log, sessionId).records(id)
            if (output.size > 0) {
                var stdoutEnd = false; var stderrEnd = false
                var stdoutEof = false; var stderrEof = false
                var stdoutBytes = Int64(0); var stderrBytes = Int64(0)
                var stdoutTruncated = false; var stderrTruncated = false
                for (row in output) {
                    let end = row.get("endOfCapture").getOrThrow().asBool().getValue()
                    if (row.get("channel").getOrThrow().asString().getValue() == "stdout") {
                        stdoutBytes += row.get("byteCount").getOrThrow().asInt().getValue()
                        if (end) { stdoutEnd = true; stdoutEof = row.get("eof").getOrThrow().asBool().getValue(); stdoutTruncated = row.get("truncated").getOrThrow().asBool().getValue() }
                    } else {
                        stderrBytes += row.get("byteCount").getOrThrow().asInt().getValue()
                        if (end) { stderrEnd = true; stderrEof = row.get("eof").getOrThrow().asBool().getValue(); stderrTruncated = row.get("truncated").getOrThrow().asBool().getValue() }
                    }
                }
                if (!stdoutEnd || !stderrEnd || (outputComplete && (!stdoutEof || !stderrEof))) { throw Exception("execution-output-unsettled") }
                facts.put("stdoutBytes", JsonInt(stdoutBytes)); facts.put("stderrBytes", JsonInt(stderrBytes))
                facts.put("stdoutTruncated", JsonBool(stdoutTruncated)); facts.put("stderrTruncated", JsonBool(stderrTruncated))
            }
            facts.put("exitObserved", JsonBool(true)); facts.put("exitCode", JsonInt(exitCode))
            facts.put("timedOut", JsonBool(timedOut)); facts.put("cancelObserved", JsonBool(cancelObserved))
            facts.put("outputComplete", JsonBool(outputComplete))
            facts.put("processSucceeded", JsonBool(exitCode == 0 && !timedOut && !cancelObserved &&
                outputComplete && state.phase != "stopping"))
            return transition(state, "exited", facts.toString())
        }
    }
    public func recover(): Int64 {
        synchronized(log.mtx) {
            writer()
            var count = Int64(0)
            let states = list()
            for (state in states) {
                if ((starts.contains(state.id) && starts[state.id]) ||
                    ((state.phase == "running" || state.phase == "stopping") && tokens.contains(state.id))) {
                    throw Exception("recovery-while-live")
                }
            }
            for (state in states) {
                if (state.phase == "admitted") {
                    transition(state, "awaiting-approval", "recovery-requires-approval"); count += 1
                } else if (state.phase == "starting" || state.phase == "running" || state.phase == "stopping") {
                    transition(state, "unknown", "recovery-process-unverified"); count += 1
                }
                permits[state.id] = false
            }
            return count
        }
    }
}
