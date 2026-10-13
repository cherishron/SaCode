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
        this.snapshot = snapshot; this.workspace = workspace; this.taskDigest = taskDigest; this.sequence = sequence
    }
}

// 会话日志是唯一权威；恢复准入事实不恢复进程、授权或执行许可。
public class AcpDelegationJournal {
    let log: SessionLog
    let lease: WriteLease
    let sessionId: String
    public init(log: SessionLog, lease: WriteLease, sessionId: String) {
        this.log = log; this.lease = lease; this.sessionId = sessionId
    }
    public func belongsTo(session: String): Bool { return sessionId == session }

    private func decode(text: String): AcpAdmissionRecord {
        let obj = JsonValue.fromStr(text).asObject()
        if (obj.size() != 10 || obj.get("schema").getOrThrow().asInt().getValue() != 1) { throw Exception("acp-journal-invalid") }
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
        if (parts.size != 2 || parts[0] != "delegation") { throw Exception("acp-journal-invalid") }
        let seq = Int64.parse(parts[1])
        if (seq < 1 || revision < 1 || session != sessionId || task.size == 0 || request.size == 0 || peer.size == 0 || workspace.size == 0 || digest.size != 64 || phase != "initializing") { throw Exception("acp-journal-invalid") }
        return AcpAdmissionRecord(AcpDelegationSnapshot(id, session, task, request, peer, "", "outcome-unknown", revision + 1, "", "outcome-unknown:recovered-admission"), workspace, digest, seq)
    }

    public func recover(): Array<AcpAdmissionRecord> {
        if (log.isDurableFrozen()) { throw Exception("acp-journal-unsettled") }
        let out = ArrayList<AcpAdmissionRecord>()
        let ids = HashSet<String>(); let requests = HashSet<String>()
        let durable = log.durableCount()
        for (event in log.snapshotEvents()) {
            if (event.seq >= durable || event.eventType != "acp/admission") { continue }
            let record = decode(event.data)
            if (ids.contains(record.snapshot.id) || requests.contains(record.snapshot.requestId)) { throw Exception("acp-journal-duplicate") }
            ids.add(record.snapshot.id); requests.add(record.snapshot.requestId); out.add(record)
        }
        return out.toArray()
    }

    public func admit(snapshot: AcpDelegationSnapshot, workspace: String, digest: String): Bool {
        if (log.isDurableFrozen() || !lease.protects(log.path)) { return false }
        let obj = JsonObject()
        obj.put("schema", JsonInt(1)); obj.put("id", JsonString(snapshot.id))
        obj.put("sessionId", JsonString(snapshot.sessionId)); obj.put("taskId", JsonString(snapshot.taskId))
        obj.put("requestId", JsonString(snapshot.requestId)); obj.put("peerId", JsonString(snapshot.peerId))
        obj.put("workspace", JsonString(workspace)); obj.put("taskDigest", JsonString(digest))
        obj.put("revision", JsonInt(snapshot.revision)); obj.put("phase", JsonString(snapshot.phase))
        let text = obj.toString()
        decode(text)
        for (record in recover()) {
            if (record.snapshot.id == snapshot.id || record.snapshot.requestId == snapshot.requestId) { throw Exception("acp-journal-duplicate") }
        }
        log.append("acp/admission", text)
        return log.durableCheckpoint(lease)
    }
}
