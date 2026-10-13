package core
import std.collection.ArrayList
import std.collection.HashMap
import std.sync.*

// ACP 委派服务：委派会话/任务的生命周期、状态迁移、归属绑定、幂等（design §2.1.3、§2.2.2）。
// 每委派一会话（不复用）、绑定 sessionId+taskId+delegationId+protocolSessionId。
// requestId 幂等：同键同摘要回原委派，异摘要 request-conflict。
// create 前 L1+L2 门控必须通过（gate.requireCanDelegate）。
// 持久化经 checkpoint 回调（Task 2.4 整合 SessionLog/WriteLease）。

// 委派快照（只读视图）
public class AcpDelegationSnapshot {
    public let id: String                  // delegation-<序号>
    public let sessionId: String
    public let taskId: String
    public let requestId: String
    public let peerId: String              // 产品标识
    public let protocolSessionId: String   // 外部 Agent 返回的会话身份
    public let phase: String
    public let revision: Int64
    public let capabilityDigest: String
    public let result: String              // 结算事实
    public init(id: String, sessionId: String, taskId: String, requestId: String,
        peerId: String, protocolSessionId: String, phase: String, revision: Int64,
        capabilityDigest: String, result: String) {
        this.id = id
        this.sessionId = sessionId
        this.taskId = taskId
        this.requestId = requestId
        this.peerId = peerId
        this.protocolSessionId = protocolSessionId
        this.phase = phase
        this.revision = revision
        this.capabilityDigest = capabilityDigest
        this.result = result
    }
}

// 委派记录（内部可变状态）
class AcpDelegationEntry {
    var id: String
    var sessionId: String
    var taskId: String
    var requestId: String
    var peerId: String
    var protocolSessionId: String
    var phase: String
    var revision: Int64
    var capabilityDigest: String
    var result: String
    var proc: Option<AcpProcess> = None
    // 协作式取消令牌：父令牌取消时子令牌跟随；detached 不跟随
    var cancelToken: TurnToken
    // taskText 摘要用于幂等校验
    var taskDigest: String
    var promptStarted: Bool = false
    let workspace: String

    init(id: String, sessionId: String, taskId: String, requestId: String,
        peerId: String, taskDigest: String, workspace: String) {
        this.id = id
        this.sessionId = sessionId
        this.taskId = taskId
        this.requestId = requestId
        this.peerId = peerId
        this.protocolSessionId = ""
        this.phase = "pending"
        this.revision = Int64(0)
        this.capabilityDigest = ""
        this.result = ""
        this.cancelToken = TurnToken()
        this.taskDigest = taskDigest
        this.workspace = workspace
    }

    func snapshot(): AcpDelegationSnapshot {
        return AcpDelegationSnapshot(id, sessionId, taskId, requestId,
            peerId, protocolSessionId, phase, revision, capabilityDigest, result)
    }
}

public class AcpDelegationService {
    let sessionId: String
    let gate: AcpGate
    let procFactory: (String) -> AcpProcess
    let checkpoint: () -> Bool
    let journal: ?AcpDelegationJournal
    // 委派存储：id → 条目
    let delegations = HashMap<String, AcpDelegationEntry>()
    // requestId → 委派 id（幂等索引）
    let requestIdIndex = HashMap<String, String>()
    // 序号生成
    let idGen = AtomicInt64(0)
    let mtx = Mutex()
    // 并发上限（配置化，待定）
    let maxConcurrent: Int64 = 4

    public init(sessionId: String, gate: AcpGate,
        procFactory: (String) -> AcpProcess,
        checkpoint!: () -> Bool = { => false }, journal!: ?AcpDelegationJournal = None) {
        this.sessionId = sessionId
        this.gate = gate
        this.procFactory = procFactory
        this.checkpoint = checkpoint
        this.journal = journal
        if (let Some(storage) <- journal) {
            if (!storage.belongsTo(sessionId)) { throw Exception("invalid-input:journal-session-mismatch") }
            var highest: Int64 = 0
            for (record in storage.recover()) {
                let snap = record.snapshot
                let entry = AcpDelegationEntry(snap.id, snap.sessionId, snap.taskId, snap.requestId, snap.peerId, record.taskDigest, record.workspace)
                entry.phase = snap.phase; entry.revision = snap.revision; entry.result = snap.result
                delegations[snap.id] = entry; requestIdIndex[snap.requestId] = snap.id
                if (record.sequence > highest) { highest = record.sequence }
            }
            idGen.store(highest)
        }
    }

    // 创建委派：门控检查 → 幂等检查 → 进程启动 → 能力协商 → 会话创建
    public func create(taskId: String, requestId: String, peerId: String,
        taskText: String, workspace: String): AcpDelegationSnapshot {
        // 门控：L1 + L2 必须通过
        gate.requireCanDelegate("user", peerId)

        let taskDigest = simpleDigest(taskText)

        mtx.lock()
        // 幂等检查：同 requestId
        if (let Some(existingId) <- requestIdIndex.get(requestId)) {
            if (let Some(existing) <- delegations.get(existingId)) {
                if (existing.taskDigest == taskDigest && existing.taskId == taskId && existing.peerId == peerId && existing.workspace == workspace) {
                    // 同键同摘要：回原委派
                    let snap = existing.snapshot()
                    mtx.unlock()
                    return snap
                } else {
                    mtx.unlock()
                    throw Exception("revision-conflict:requestId-binding-mismatch")
                }
            }
        }

        // 并发上限检查
        var active = Int64(0)
        for ((_, entry) in delegations) {
            if (entry.phase != "completed" && entry.phase != "failed" && entry.phase != "cancelled" && entry.phase != "rejected" && entry.phase != "incomplete") {
                active += 1
            }
        }
        if (active >= maxConcurrent) {
            mtx.unlock()
            throw Exception("busy:concurrent-limit-${maxConcurrent}")
        }

        // 创建委派条目
        let seq = idGen.fetchAdd(1) + 1
        let delegationId = "delegation-${seq}"
        let entry = AcpDelegationEntry(delegationId, sessionId, taskId, requestId, peerId, taskDigest, workspace)
        delegations[delegationId] = entry
        requestIdIndex[requestId] = delegationId
        entry.phase = "initializing"
        entry.revision += 1
        mtx.unlock()

        // 启动进程
        var admitted = false
        try {
            admitted = if (let Some(storage) <- journal) { storage.admit(entry.snapshot(), workspace, taskDigest) } else { checkpoint() }
        } catch (_: Exception) { admitted = false }
        mtx.lock()
        if (entry.cancelToken.cancelled()) {
            let snapshot = entry.snapshot()
            mtx.unlock()
            return snapshot
        }
        if (!admitted) {
            entry.phase = "failed"
            entry.result = "persistence-failed:delegation-create"
            entry.revision += 1
            let snapshot = entry.snapshot()
            mtx.unlock()
            return snapshot
        }
        mtx.unlock()

        // 工厂可能重入；启动与句柄发布才在锁内，取消不会漏过句柄。
        let proc = procFactory(peerId)
        mtx.lock()
        try {
            if (entry.cancelToken.cancelled()) { return entry.snapshot() }
            if (!proc.start()) {
                entry.phase = "failed"
                entry.result = "provider-unavailable:spawn-failed:${proc.startFailure()}"
                entry.revision += 1
                return entry.snapshot()
            }
            entry.proc = Some(proc)
        } finally { mtx.unlock() }

        let initResult = proc.acpInitialize(1, "sacode", "0.1.0")
        var initFailure = "provider-unavailable:initialize-timeout"
        if (let Some(raw) <- initResult) {
            try { acpValidateInitialization(raw); initFailure = "" } catch (e: Exception) { initFailure = "provider-unavailable:invalid-initialize:${e.message}" }
        }
        mtx.lock()
        if (entry.cancelToken.cancelled()) {
            mtx.unlock()
            proc.kill()
            return describe(entry.id)
        }
        if (initFailure.size > 0) {
            entry.phase = "failed"
            entry.result = initFailure
            entry.revision += 1
            mtx.unlock()
            proc.kill()
            return describe(entry.id)
        }
        mtx.unlock()

        let sessionResult = proc.sessionNew(workspace)
        var createdSession = ""
        var sessionFailure = "provider-unavailable:session-new-failed"
        if (let Some(raw) <- sessionResult) {
            try { createdSession = acpReadCreatedSession(raw) } catch (e: Exception) { sessionFailure = "provider-unavailable:invalid-session-new:${e.message}" }
        }
        mtx.lock()
        if (entry.cancelToken.cancelled()) {
            mtx.unlock()
            proc.kill()
            return describe(entry.id)
        }
        if (createdSession.size > 0) {
            entry.protocolSessionId = createdSession
        } else {
            entry.phase = "failed"
            entry.result = sessionFailure
            entry.revision += 1
            mtx.unlock()
            proc.kill()
            return describe(entry.id)
        }
        entry.phase = "running"
        entry.revision += 1
        proc.markBusy()
        mtx.unlock()
        let _ = checkpoint()
        return describe(entry.id)
    }
    // 一次委派仅发送准入时绑定的任务；调用方可在线程中执行并同时处理权限请求。
    public func runTask(id: String, expectedRevision: Int64, taskText: String, timeoutMs!: Int64 = 30000): AcpDelegationSnapshot {
        if (taskText.size == 0 || taskText.size > 65536 || timeoutMs < 1 || timeoutMs > 300000) { throw Exception("invalid-input:acp-task") }
        mtx.lock()
        let entry: AcpDelegationEntry
        let process: AcpProcess
        let request: Int64
        try {
            if (!delegations.contains(id)) { throw Exception("not-found:delegation-${id}") }
            entry = delegations.get(id).getOrThrow()
            if (entry.revision != expectedRevision) { throw Exception("revision-conflict:acp-task") }
            if (entry.taskDigest != simpleDigest(taskText)) { throw Exception("revision-conflict:acp-task-binding") }
            if (entry.promptStarted || entry.phase != "running" || entry.cancelToken.cancelled()) { throw Exception("busy:acp-task-not-startable") }
            gate.requireCanDelegate("user", entry.peerId)
            if (let Some(storage) <- journal) {
                if (!acpPermissionPolicyAllows(storage.log)) { throw Exception("not-authorized:acp-task-mode") }
            }
            if (entry.proc.isNone()) { throw Exception("provider-unavailable:acp-task-process") }
            process = entry.proc.getOrThrow()
            request = process.nextRequestId()
            entry.promptStarted = true
            entry.revision += 1
            if (journal.isNone() || !journal.getOrThrow().taskFact(entry.snapshot(), "acp/task/start", request, "intent-before-send")) {
                entry.phase = "failed"; entry.result = "persistence-failed:acp-task-start"; entry.revision += 1
                return entry.snapshot()
            }
            let params = "{\"sessionId\":\"${jsonEscapeText(entry.protocolSessionId)}\",\"prompt\":[{\"type\":\"text\",\"text\":\"${jsonEscapeText(taskText)}\"}]}"
            if (!process.sendRequest(request, "session/prompt", params)) {
                entry.phase = "outcome-unknown"; entry.result = "prompt-send-unconfirmed"; entry.revision += 1
                return entry.snapshot()
            }
        } finally { mtx.unlock() }
        let reply = process.awaitReply(request, timeoutMs)
        var reason = ""
        if (let Some(raw) <- reply) {
            try {
                reason = acpRpcResult(raw).get("stopReason").getOrThrow().asString().getValue()
                if (reason != "end_turn" && reason != "cancelled" && reason != "max_tokens" && reason != "max_turn_requests" && reason != "refusal") { reason = "" }
            } catch (_: Exception) { reason = "" }
        }
        mtx.lock()
        try {
            // close 先结算时迟到的 prompt 回执不改写其终态。
            if (entry.phase == "completing" || entry.phase == "incomplete" || entry.phase == "failed") { return entry.snapshot() }
            if (reason.size == 0) {
                entry.phase = "outcome-unknown"; entry.result = "prompt-result-unconfirmed"
            } else {
                entry.phase = if (reason == "cancelled") { "cancelled" }
                    else if (reason == "end_turn" && !entry.cancelToken.cancelled()) { "completed" } else { "incomplete" }
                entry.result = "prompt-stop:${reason}"
                process.markIdle()
            }
            entry.revision += 1
            if (!journal.getOrThrow().taskFact(entry.snapshot(), "acp/task/settled", request, entry.result)) {
                entry.phase = "outcome-unknown"; entry.result = "persistence-failed:acp-task-settlement"; entry.revision += 1
            }
            return entry.snapshot()
        } finally { mtx.unlock() }
    }

    // 查询委派
    public func describe(id: String): AcpDelegationSnapshot {
        mtx.lock()
        if (let Some(entry) <- delegations.get(id)) {
            let snap = entry.snapshot()
            mtx.unlock()
            return snap
        }
        mtx.unlock()
        throw Exception("not-found:delegation-${id}")
    }

    func permissionProcess(id: String): ?AcpProcess {
        mtx.lock()
        try {
            if (let Some(entry) <- delegations.get(id)) {
                if ((entry.phase == "running" || entry.phase == "awaiting-permission") && !entry.cancelToken.cancelled()) { return entry.proc }
            }
            return None
        } finally { mtx.unlock() }
    }
    // 与取消/状态变更共用锁；批准与精确消费不得跨修订竞争放行。
    func withCurrentPermission(expected: AcpDelegationSnapshot, decide: () -> Bool): Bool {
        mtx.lock()
        try {
            if (let Some(entry) <- delegations.get(expected.id)) {
                if (entry.sessionId != expected.sessionId || entry.taskId != expected.taskId || entry.requestId != expected.requestId || entry.peerId != expected.peerId || entry.protocolSessionId != expected.protocolSessionId || entry.revision != expected.revision || entry.cancelToken.cancelled()) { return false }
                if (entry.phase != "running" && entry.phase != "awaiting-permission") { return false }
                return decide()
            }
            return false
        } finally { mtx.unlock() }
    }
    // 列出所有委派
    public func list(): ArrayList<AcpDelegationSnapshot> {
        let out = ArrayList<AcpDelegationSnapshot>()
        mtx.lock()
        for ((_, entry) in delegations) {
            out.add(entry.snapshot())
        }
        mtx.unlock()
        return out
    }

    // 取消委派：发 session/cancel 并等待结算；同时设置 TurnToken
    public func cancel(id: String, expectedRevision: Int64): AcpDelegationSnapshot {
        mtx.lock()
        if (let Some(entry) <- delegations.get(id)) {
            if (entry.revision != expectedRevision) {
                mtx.unlock()
                throw Exception("revision-conflict:expected-${expectedRevision}-actual-${entry.revision}")
            }
            if (entry.phase == "completed" || entry.phase == "failed" || entry.phase == "cancelled" || entry.phase == "rejected" || entry.phase == "incomplete") {
                let snapshot = entry.snapshot()
                mtx.unlock()
                return snapshot
            }
            if (entry.phase == "outcome-unknown" && entry.proc.isNone()) {
                mtx.unlock()
                throw Exception("outcome-unknown:recovery-requires-reconciliation")
            }
            entry.phase = "cancelling"
            entry.revision += 1
            // 设置取消令牌
            entry.cancelToken.cancel()
            // 先在同一锁内发布取消裁决；通知写出后不得覆盖已确认的任务返回。
            entry.phase = "outcome-unknown"
            entry.result = "cancel-no-confirmation"
            entry.revision += 1
            let cancelRevision = entry.revision
            let process = entry.proc
            let protocolSession = entry.protocolSessionId
            mtx.unlock()

            // 通知不带回执；只有对应prompt结束事实才能确认取消。
            var notification = "cancel-no-confirmation"
            if (let Some(proc) <- process) {
                if (proc.alive()) {
                    let sent = proc.sessionCancel(protocolSession)
                    notification = if (sent) { "cancel-sent-awaiting-turn-end" } else { "cancel-send-failed" }
                }
                // 尚未确认停止，不能markIdle并开放restart。
            }
            mtx.lock()
            if (entry.revision == cancelRevision && entry.phase == "outcome-unknown") { entry.result = notification }
            let snapshot = entry.snapshot()
            mtx.unlock()
            let _ = checkpoint()
            return snapshot
        }
        mtx.unlock()
        throw Exception("not-found:delegation-${id}")
    }

    // 关闭委派：发 session/close 再结算进程
    public func close(id: String, expectedRevision: Int64): AcpDelegationSnapshot {
        mtx.lock()
        if (let Some(entry) <- delegations.get(id)) {
            if (entry.revision != expectedRevision) {
                mtx.unlock()
                throw Exception("revision-conflict:expected-${expectedRevision}-actual-${entry.revision}")
            }
            if (entry.phase == "completed" || entry.phase == "failed" || entry.phase == "cancelled" || entry.phase == "rejected" || entry.phase == "incomplete") {
                let snapshot = entry.snapshot()
                mtx.unlock()
                return snapshot
            }
            if (entry.phase == "outcome-unknown" && entry.proc.isNone()) {
                mtx.unlock()
                throw Exception("outcome-unknown:recovery-requires-reconciliation")
            }
            entry.phase = "completing"
            entry.revision += 1
            mtx.unlock()

            if (let Some(proc) <- entry.proc) {
                proc.close()
                proc.markIdle()
            }
            entry.phase = "incomplete"
            entry.result = "closed-without-task-completion-evidence"
            entry.revision += 1
            let _ = checkpoint()
            return entry.snapshot()
        }
        mtx.unlock()
        throw Exception("not-found:delegation-${id}")
    }

    // 内容块入口（内部）：Task 3.x 实现
    public func onUpdate(id: String, block: String): Unit {
        // 待 Task 3.1 AcpContentRouter 实现
    }

    // 授权请求入口：Task 4.1 实现
    public func onPermissionRequest(id: String, request: String): Int64 {
        // 待 Task 4.1 AcpApprovalBridge 实现
        return Int64(-1)
    }

    // elicitation 入口：Task 4.x 实现
    public func onElicitation(id: String, requestId: String, fields: String): Unit {
        throw Exception("unsupported:acp-elicitation-not-connected")
    }

    // 使用全量内容摘要；滚动 Int64 乘法会溢出并绕过稳定的幂等冲突结果。
    private func simpleDigest(text: String): String {
        return sha256Hex(text.toArray())
    }


}
