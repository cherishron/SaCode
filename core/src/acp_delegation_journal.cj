package core

import std.collection.*
import std.convert.*
import stdx.encoding.json.*

public class AcpAdmissionRecord {
    public let snapshot: AcpDelegationSnapshot
    public let workspace: String
    public let taskDigest: String
    public let sequence: Int64
    public init(snapshot: AcpDelegationSnapshot, workspace: String, taskDigest: String, sequence: Int64) {
        this.snapshot = snapshot
        this.workspace = workspace
        this.taskDigest = taskDigest
        this.sequence = sequence
    }
}

// 会话日志是唯一权威；恢复准入事实不恢复进程、授权或执行许可。
public class AcpDelegationJournal {
    let log: SessionLog
    let lease: WriteLease
    let sessionId: String
    public init(log: SessionLog, lease: WriteLease, sessionId: String) {
        this.log = log
        this.lease = lease
        this.sessionId = sessionId
    }
    public func belongsTo(session: String): Bool {
        return sessionId == session
    }

    func taskFact(snapshot: AcpDelegationSnapshot, event: String, protocolRequestId: Int64, detail: String): Bool {
        if (event != "acp/task/start" && event != "acp/task/settled") {
            return false
        }
        if (snapshot.sessionId != sessionId || protocolRequestId < 1 || snapshot.protocolSessionId.size == 0 ||
            log.isDurableFrozen() || !lease.protects(log.path)) {
            return false
        }
        let obj = JsonObject()
        obj.put("schema", JsonInt(1));
        obj.put("delegationId", JsonString(snapshot.id))
        obj.put("sessionId", JsonString(snapshot.sessionId));
        obj.put("taskId", JsonString(snapshot.taskId))
        obj.put("requestId", JsonString(snapshot.requestId));
        obj.put("protocolSessionId", JsonString(snapshot.protocolSessionId))
        obj.put("protocolRequestId", JsonInt(protocolRequestId));
        obj.put("revision", JsonInt(snapshot.revision))
        obj.put("phase", JsonString(snapshot.phase));
        obj.put("detail", JsonString(detail))
        // 只记录调用来源；意图不证明已消费，未知用量留给来源账回放表达。
        obj.put("quotaSource", JsonString("external-agent"));
        obj.put("externalAgentId", JsonString(snapshot.peerId))
        try {
            log.append(event, obj.toString());
            return log.durableCheckpoint(lease)
        } catch (_: Exception) {
            return false
        }
    }

    private func decode(text: String): AcpAdmissionRecord {
        let obj = JsonValue.fromStr(text).asObject()
        if (obj.size() != 10 || obj.get("schema").getOrThrow().asInt().getValue() != 1) {
            throw Exception("acp-journal-invalid")
        }
        let id = obj.get("id").getOrThrow().asString().getValue()
        let session = obj.get("sessionId").getOrThrow().asString().getValue()
        let task = obj.get("taskId").getOrThrow().asString().getValue()
        let request = obj.get("requestId").getOrThrow().asString().getValue()
        let peer = obj.get("peerId").getOrThrow().asString().getValue()
        let workspace = obj.get("workspace").getOrThrow().asString().getValue()
        let digest = obj.get("taskDigest").getOrThrow().asString().getValue()
        let revision = obj.get("revision").getOrThrow().asInt().getValue()
        let phase = obj.get("phase").getOrThrow().asString().getValue()
        let parts = id.split("-").toArray()
        if (parts.size != 2 || parts[0] != "delegation") {
            throw Exception("acp-journal-invalid")
        }
        let seq = Int64.parse(parts[1])
        if (seq < 1 || revision < 1 || session != sessionId || task.size == 0 || request.size == 0 || peer.size == 0 ||
            workspace.size == 0 || digest.size != 64 || phase != "initializing") {
            throw Exception("acp-journal-invalid")
        }
        return AcpAdmissionRecord(
            AcpDelegationSnapshot(id, session, task, request, peer, "", "outcome-unknown", revision + 1, "",
                "outcome-unknown:recovered-admission"), workspace, digest, seq)
    }

    public func recover(): Array<AcpAdmissionRecord> {
        if (log.isDurableFrozen()) {
            throw Exception("acp-journal-unsettled")
        }
        let out = ArrayList<AcpAdmissionRecord>()
        let ids = HashSet<String>();
        let requests = HashSet<String>()
        let records = HashMap<String, AcpAdmissionRecord>()
        let order = ArrayList<String>()
        let started = HashMap<String, Int64>();
        let settled = HashSet<String>()
        let durable = log.durableCount()
        for (event in log.snapshotEvents()) {
            if (event.seq >= durable) {
                continue
            }
            if (event.eventType == "acp/admission") {
                let record = decode(event.data)
                if (ids.contains(record.snapshot.id) || requests.contains(record.snapshot.requestId)) {
                    throw Exception("acp-journal-duplicate")
                }
                ids.add(record.snapshot.id);
                requests.add(record.snapshot.requestId)
                records[record.snapshot.id] = record
                order.add(record.snapshot.id)
            } else if (event.eventType == "acp/task/start" || event.eventType == "acp/task/settled") {
                let obj = JsonValue.fromStr(event.data).asObject()
                if ((obj.size() != 10 && obj.size() != 12) || obj.get("schema").getOrThrow().asInt().getValue() != 1) {
                    throw Exception("acp-task-journal-invalid")
                }
                let id = obj.get("delegationId").getOrThrow().asString().getValue()
                let previous = records.get(id).getOrThrow()
                let identity = previous.snapshot
                if (obj.size() == 12 && (obj.get("quotaSource").getOrThrow().asString().getValue() != "external-agent" ||
                    obj.get("externalAgentId").getOrThrow().asString().getValue() != identity.peerId)) {
                    throw Exception("acp-task-journal-source")
                }
                let session = obj.get("sessionId").getOrThrow().asString().getValue()
                let task = obj.get("taskId").getOrThrow().asString().getValue()
                let request = obj.get("requestId").getOrThrow().asString().getValue()
                let protocol = obj.get("protocolSessionId").getOrThrow().asString().getValue()
                let protocolRequest = obj.get("protocolRequestId").getOrThrow().asInt().getValue()
                let revision = obj.get("revision").getOrThrow().asInt().getValue()
                let phase = obj.get("phase").getOrThrow().asString().getValue()
                let detail = obj.get("detail").getOrThrow().asString().getValue()
                if (session != identity.sessionId || task != identity.taskId || request != identity.requestId ||
                    protocol.size == 0 || protocolRequest < 1 || revision < identity.revision || settled.contains(id)) {
                    throw Exception("acp-task-journal-binding")
                }
                var recoveredPhase = "outcome-unknown"
                var recoveredDetail = "outcome-unknown:recovered-task-start"
                if (event.eventType == "acp/task/start") {
                    if (started.contains(id) || phase != "running" || detail != "intent-before-send") {
                        throw Exception("acp-task-journal-start")
                    }
                    started[id] = protocolRequest
                } else {
                    if (started.get(id).getOrThrow() != protocolRequest || protocol != identity.protocolSessionId) {
                        throw Exception("acp-task-journal-response")
                    }
                    let valid = (phase == "completed" && detail == "prompt-stop:end_turn") || (phase == "cancelled" &&
                        detail == "prompt-stop:cancelled") || (phase == "incomplete" && (detail == "prompt-stop:end_turn" ||
                        detail == "prompt-stop:max_tokens" || detail == "prompt-stop:max_turn_requests" || detail ==
                        "prompt-stop:refusal")) || (phase == "outcome-unknown" && detail == "prompt-result-unconfirmed")
                    if (!valid) {
                        throw Exception("acp-task-journal-settlement")
                    }
                    settled.add(id);
                    recoveredPhase = phase
                    recoveredDetail = detail
                }
                records[id] = AcpAdmissionRecord(
                    AcpDelegationSnapshot(id, session, task, request, identity.peerId, protocol, recoveredPhase,
                        revision + 1, identity.capabilityDigest, recoveredDetail), previous.workspace,
                    previous.taskDigest, previous.sequence)
            }
        }
        for (id in order) {
            out.add(records.get(id).getOrThrow())
        }
        return out.toArray()
    }

    public func admit(snapshot: AcpDelegationSnapshot, workspace: String, digest: String): Bool {
        if (log.isDurableFrozen() || !lease.protects(log.path)) {
            return false
        }
        let obj = JsonObject()
        obj.put("schema", JsonInt(1));
        obj.put("id", JsonString(snapshot.id))
        obj.put("sessionId", JsonString(snapshot.sessionId));
        obj.put("taskId", JsonString(snapshot.taskId))
        obj.put("requestId", JsonString(snapshot.requestId));
        obj.put("peerId", JsonString(snapshot.peerId))
        obj.put("workspace", JsonString(workspace));
        obj.put("taskDigest", JsonString(digest))
        obj.put("revision", JsonInt(snapshot.revision));
        obj.put("phase", JsonString(snapshot.phase))
        let text = obj.toString()
        decode(text)
        for (record in recover()) {
            if (record.snapshot.id == snapshot.id || record.snapshot.requestId == snapshot.requestId) {
                throw Exception("acp-journal-duplicate")
            }
        }
        log.append("acp/admission", text)
        return log.durableCheckpoint(lease)
    }
}
