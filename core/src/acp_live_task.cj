package core
import std.collection.*
import std.sync.*
import stdx.encoding.json.*

class AcpLiveProgress {
    let finished = AtomicBool(false)
    let mtx = Mutex()
    var error = ""
}
class AcpLivePermission {
    let id: Int64
    let permission: AcpWirePermission
    var state = "pending"
    var reason = ""
    init(id: Int64, permission: AcpWirePermission) { this.id = id; this.permission = permission }
}

// 供双入口装配的活任务：使用既有委派、同一审批账本和原始 ACP 进程，禁止自动批准。
public class AcpLiveTask {
    let service: AcpDelegationService
    let desk: ApprovalDesk
    let process: AcpProcess
    let delivery: AcpPermissionDelivery
    let id: String
    let generation: Int64
    let progress: AcpLiveProgress
    let result: Future<AcpDelegationSnapshot>
    let mtx = Mutex()
    let permissions = HashMap<Int64, AcpLivePermission>()
    let updates = ArrayList<String>()
    var rejected: Int64 = 0
    var omitted: Int64 = 0
    public init(service: AcpDelegationService, desk: ApprovalDesk, lease: WriteLease, id: String,
        revision: Int64, taskText: String, timeoutMs!: Int64 = 30000) {
        if (taskText.size == 0 || taskText.size > 65536 || timeoutMs < 1 || timeoutMs > 300000) { throw Exception("invalid-input:acp-live-task") }
        let identity = service.describe(id)
        if (identity.revision != revision) { throw Exception("revision-conflict:acp-live-task") }
        this.service = service; this.desk = desk; this.id = id
        this.process = service.permissionProcess(id).getOrThrow()
        this.generation = process.generation.load()
        this.delivery = AcpPermissionDelivery(AcpApprovalBridge(desk, service, identity.sessionId), lease, id)
        let state = AcpLiveProgress()
        this.progress = state
        this.result = spawn { =>
            try { service.runTask(id, revision, taskText, timeoutMs: timeoutMs) }
            catch (e: Exception) {
                state.mtx.lock(); state.error = e.message; state.mtx.unlock()
                service.describe(id)
            } finally { state.finished.store(true) }
        }
    }
    private func requireProcess() {
        if (process.generation.load() != generation) { throw Exception("provider-unavailable:acp-process-replaced") }
    }
    public func cancel(revision: Int64): AcpDelegationSnapshot { requireProcess(); return service.cancel(id, revision) }
    public func wait(timeoutMs!: Int64 = 310000): AcpDelegationSnapshot { return result.get(timeoutMs * Duration.millisecond) }
    public func answer(approvalId: Int64, decision: String, option: String): AcpPermissionDeliveryResult {
        requireProcess(); mtx.lock()
        try {
            if (!permissions.contains(approvalId)) { return AcpPermissionDeliveryResult("not-sent", "unknown-task-approval") }
            let record = permissions.get(approvalId).getOrThrow()
            let response = delivery.answer(approvalId, decision, option)
            if (response.state != "not-sent") { record.state = response.state }
            record.reason = response.reason
            return response
        } finally { mtx.unlock() }
    }
    public func poll(): String {
        requireProcess(); mtx.lock()
        try {
            for (_ in 0..32) {
                if (let Some(frame) <- process.nextInbound()) {
                    try {
                        if (frame.generation != generation) { throw Exception("stale-acp-frame") }
                        if (frame.kind == "request" && frame.method == "session/request_permission") {
                            if (permissions.size >= 128) { throw Exception("acp-permission-limit") }
                            let permission = acpReadWirePermission(frame)
                            let approvalId = delivery.accept(frame)
                            permissions[approvalId] = AcpLivePermission(approvalId, permission)
                        } else if (frame.kind == "notification" && frame.method == "session/update") {
                            let session = JsonValue.fromStr(frame.params).asObject().get("sessionId").getOrThrow().asString().getValue()
                            if (session != service.describe(id).protocolSessionId) { throw Exception("acp-update-session-mismatch") }
                            if (updates.size >= 32) { updates.remove(at: 0); omitted += 1 }
                            updates.add(frame.params)
                        } else { throw Exception("unsupported-acp-frame") }
                    } catch (_: Exception) {
                        rejected += 1
                        if (frame.kind == "request") { process.rejectPermission(frame) }
                    }
                } else { break }
            }
            let identity = service.describe(id)
            let snapshot = JsonObject()
            snapshot.put("delegationId", JsonString(identity.id)); snapshot.put("sessionId", JsonString(identity.sessionId))
            snapshot.put("taskId", JsonString(identity.taskId)); snapshot.put("requestId", JsonString(identity.requestId))
            snapshot.put("peerId", JsonString(identity.peerId)); snapshot.put("phase", JsonString(identity.phase))
            snapshot.put("revision", JsonInt(identity.revision)); snapshot.put("result", JsonString(identity.result))
            let tickets = JsonArray()
            for ((_, record) in permissions) {
                let ticket = JsonObject()
                var allow = ""; var deny = ""
                for (option in record.permission.options) {
                    if (option.kind == "allow_once" && allow.size == 0) { allow = option.id }
                    if (option.kind == "reject_once" && deny.size == 0) { deny = option.id }
                }
                ticket.put("approvalId", JsonInt(record.id)); ticket.put("toolCallId", JsonString(record.permission.toolCallId))
                ticket.put("argumentsJson", JsonString(record.permission.frame.raw))
                let policyAllows = acpPermissionPolicyAllows(desk.log)
                ticket.put("allowOnceOption", JsonString(if (policyAllows) { allow } else { "" })); ticket.put("denyOnceOption", JsonString(deny))
                ticket.put("policyAllowsGrant", JsonBool(policyAllows))
                ticket.put("state", JsonString(record.state)); ticket.put("approvalState", JsonString(desk.stateOf(record.id)))
                ticket.put("reason", JsonString(record.reason)); tickets.add(ticket)
            }
            let content = JsonArray(); for (raw in updates) { content.add(JsonString(raw)) }
            progress.mtx.lock(); let failure = progress.error; progress.mtx.unlock()
            let obj = JsonObject()
            obj.put("version", JsonInt(1)); obj.put("source", JsonString("owned-live-process"))
            obj.put("delegation", snapshot); obj.put("permissions", tickets); obj.put("updates", content)
            obj.put("workerFinished", JsonBool(progress.finished.load())); obj.put("workerError", JsonString(failure))
            obj.put("invalidInbound", JsonInt(rejected + process.invalidInboundCount())); obj.put("omittedUpdates", JsonInt(omitted))
            return obj.toString()
        } finally { mtx.unlock() }
    }
}
