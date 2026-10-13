package core
import std.collection.*
import std.sync.*
import stdx.encoding.json.*

public class AcpPermissionDeliveryResult {
    public let state: String
    public let reason: String
    public init(state: String, reason: String) { this.state = state; this.reason = reason }
}

class AcpDeliveryBinding {
    let frame: AcpInboundFrame
    let identity: AcpDelegationSnapshot
    let permission: AcpWirePermission
    var state = "pending"
    public init(frame: AcpInboundFrame, identity: AcpDelegationSnapshot, permission: AcpWirePermission) {
        this.frame = frame; this.identity = identity; this.permission = permission
    }
}
class AcpDeliveryAttempt { var publicationAttempted = false; var published = false; var granted = false }

// 不建立另一份授权账本：所有事实进入ApprovalDesk持有的同一SessionLog。
public class AcpPermissionDelivery {
    let bridge: AcpApprovalBridge
    let lease: WriteLease
    let process: AcpProcess
    let delegationId: String
    let log: SessionLog
    let bindings = HashMap<Int64, AcpDeliveryBinding>()
    let claims = HashSet<String>()
    let mtx = Mutex()
    public init(bridge: AcpApprovalBridge, lease: WriteLease, delegationId: String) {
        this.bridge = bridge; this.lease = lease; this.delegationId = delegationId
        this.log = bridge.desk.log
        if (let Some(journal) <- bridge.delegations.journal) {
            if (journal.log.path != bridge.desk.log.path) { throw Exception("not-authorized:acp-permission-log-mismatch") }
        } else { throw Exception("not-authorized:acp-permission-requires-durable-admission") }
        this.process = bridge.delegations.permissionProcess(delegationId).getOrThrow()
    }

    private func capturedIdentity(id: Int64): AcpDelegationSnapshot {
        bridge.mtx.lock()
        try { return bridge.identities.get(id).getOrThrow() } finally { bridge.mtx.unlock() }
    }
    private func publish(event: String, binding: AcpDeliveryBinding, approvalId: Int64, decision: String, option: String): Bool {
        if (!lease.protects(log.path) || log.isDurableFrozen()) { return false }
        let obj = JsonObject()
        obj.put("schema", JsonInt(1)); obj.put("sessionId", JsonString(binding.identity.sessionId))
        obj.put("taskId", JsonString(binding.identity.taskId)); obj.put("taskRequestId", JsonString(binding.identity.requestId)); obj.put("peerId", JsonString(binding.identity.peerId))
        obj.put("delegationId", JsonString(binding.identity.id)); obj.put("revision", JsonInt(binding.identity.revision))
        obj.put("protocolSessionId", JsonString(binding.permission.session)); obj.put("requestIdJson", JsonString(binding.frame.idJson))
        obj.put("generation", JsonInt(binding.frame.generation)); obj.put("approvalId", JsonInt(approvalId))
        obj.put("toolCallId", JsonString(binding.permission.toolCallId)); obj.put("proposalDigest", JsonString(sha256Hex(binding.frame.raw.toArray())))
        obj.put("decision", JsonString(decision)); obj.put("optionId", JsonString(option))
        try { log.append(event, obj.toString()); return log.durableCheckpoint(lease) } catch (_: Exception) { return false }
    }

    public func accept(frame: AcpInboundFrame): Int64 {
        if (!lease.protects(log.path) || log.isDurableFrozen() || !process.hasPendingPermission(frame)) { throw Exception("not-authorized:acp-permission-admission") }
        let permission = acpReadWirePermission(frame)
        let current = bridge.delegations.describe(delegationId)
        if (permission.session != current.protocolSessionId) { throw Exception("not-authorized:acp-permission-session") }
        mtx.lock()
        try {
            let claim = "${frame.generation}:${frame.idJson}"
            if (claims.contains(claim)) { throw Exception("revision-conflict:acp-permission-already-bound") }
            let id = bridge.askPermission(delegationId, AcpPermissionProposal("acp/permission", permission.toolCallId, frame.raw))
            let identity = capturedIdentity(id)
            let binding = AcpDeliveryBinding(frame, identity, permission)
            claims.add(claim); bindings[id] = binding
            if (!publish("acp/permission/request", binding, id, "pending", "")) {
                binding.state = "not-sent"
                try { bridge.desk.answer(id, "denied") } catch (_: Exception) {}
                throw Exception("persistence-failed:acp-permission-request")
            }
            return id
        } finally { mtx.unlock() }
    }

    public func answer(approvalId: Int64, decision: String, option: String): AcpPermissionDeliveryResult {
        mtx.lock()
        try {
            let binding = bindings.get(approvalId).getOrThrow()
            if (binding.state != "pending") { return AcpPermissionDeliveryResult("not-sent", "already-decided") }
            if (decision != "allowed-once" && decision != "denied") { return AcpPermissionDeliveryResult("not-sent", "invalid-decision") }
            try { acpWirePermissionOutcome(binding.permission, decision, option) } catch (_: Exception) { return AcpPermissionDeliveryResult("not-sent", "invalid-option") }
            if (!lease.protects(log.path) || log.isDurableFrozen()) { return AcpPermissionDeliveryResult("not-sent", "persistence-unavailable") }
            if (decision == "allowed-once" && !acpPermissionPolicyAllows(log)) { return AcpPermissionDeliveryResult("not-sent", "permission-policy-denied") }
            binding.state = "deciding"
            let attempt = AcpDeliveryAttempt()
            let sent = bridge.delegations.withCurrentPermission(binding.identity, { =>
                return process.replyPermission(binding.frame, decision, option, authorize: { =>
                    if (decision == "allowed-once" && !acpPermissionPolicyAllows(log)) { return false }
                    if (!bridge.desk.answer(approvalId, decision)) { return false }
                    attempt.publicationAttempted = true
                    attempt.published = publish("acp/permission/decided", binding, approvalId, decision, option)
                    if (!attempt.published) {
                        if (decision == "allowed-once") { bridge.desk.consumeExactForCall(approvalId, "acp/permission", bridge.permissionArguments(delegationId, AcpPermissionProposal("acp/permission", binding.permission.toolCallId, binding.frame.raw))) }
                        return false
                    }
                    if (decision == "allowed-once") {
                        let args = bridge.permissionArguments(delegationId, AcpPermissionProposal("acp/permission", binding.permission.toolCallId, binding.frame.raw))
                        if (bridge.desk.consumeExactForCall(approvalId, "acp/permission", args) != "allowed-once") { return false }
                    }
                    attempt.granted = true
                    return true
                })
            })
            if (!sent) {
                binding.state = if (attempt.granted) { "outcome-unknown" } else { "not-sent" }
                if (!attempt.granted) { try { bridge.desk.answer(approvalId, "denied") } catch (_: Exception) {} }
                return AcpPermissionDeliveryResult(binding.state, if (attempt.granted) { "permission-write-unconfirmed" } else { if (attempt.publicationAttempted && !attempt.published) { "persistence-failed:acp-permission-decision" } else { "not-authorized:acp-permission" } })
            }
            binding.state = "sent"
            if (!publish("acp/permission/sent", binding, approvalId, decision, option)) {
                binding.state = "outcome-unknown"
                return AcpPermissionDeliveryResult(binding.state, "delivery-settlement-not-durable")
            }
            return AcpPermissionDeliveryResult("sent", "pipe-write-confirmed")
        } finally { mtx.unlock() }
    }
}
