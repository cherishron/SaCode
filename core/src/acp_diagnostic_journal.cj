package core

import stdx.encoding.json.*

// 诊断与用户决定复用会话日志；历史结果不恢复连接、授权或模型调用结论。
public class AcpDiagnosticJournal {
    let log: SessionLog
    let lease: WriteLease
    let sessionId: String
    let workspace: String
    public let peerId: String
    let diagnosticEvent: String
    let settingsEvent: String
    public init(log: SessionLog, lease: WriteLease, sessionId: String, workspace: String, peerId!: String = "opencode") {
        this.log = log
        this.lease = lease
        this.sessionId = sessionId
        this.workspace = workspace
        this.peerId = peerId
        this.diagnosticEvent = acpProviderEvent("acp/diagnostic", peerId)
        this.settingsEvent = acpProviderEvent("acp/settings", peerId)
    }
    public func scopeRevision(): Int64 {
        var revision: Int64 = 0
        for (event in log.snapshotEvents()) {
            if (event.eventType == "workspace/directory" || event.eventType == settingsEvent) {
                revision = event.seq + 1
            }
        }
        return revision
    }
    func latest(): JsonObject {
        var latest = JsonObject()
        var revision: Int64 = 0
        for (event in log.snapshotEvents()) {
            if (event.eventType != diagnosticEvent) {
                continue
            }
            let record = JsonValue.fromStr(event.data).asObject()
            if (record.size() != 7 || record.get("version").getOrThrow().asInt().getValue() != 1 ||
                record.get("sessionId").getOrThrow().asString().getValue() != sessionId ||
                record.get("revision").getOrThrow().asInt().getValue() != revision + 1) {
                throw Exception("replay-rejected:acp-diagnostic")
            }
            let decision = record.get("decision").getOrThrow().asString().getValue()
            if (decision != "pending" && decision != "kept") {
                throw Exception("replay-rejected:acp-diagnostic")
            }
            let report = record.get("report").getOrThrow().asObject()
            if (report.get("modelTaskTested").getOrThrow().asBool().getValue() ||
                report.get("peerId").getOrThrow().asString().getValue() != peerId ||
                record.get("scopeRevision").getOrThrow().asInt().getValue() < 0 ||
                record.get("diagnosticId").getOrThrow().asString().getValue() !=
                report
                .get("diagnostics")
                .getOrThrow()
                .asObject()
                .get("diagnosticId")
                .getOrThrow()
                .asString()
                .getValue()) {
                throw Exception("replay-rejected:acp-diagnostic")
            }
            latest = record
            revision += 1
        }
        return latest
    }
    func currentScope(record: JsonObject): Bool {
        return record.size() > 0 && record.get("scopeRevision").getOrThrow().asInt().getValue() == scopeRevision() &&
            record
            .get("report")
            .getOrThrow()
            .asObject()
            .get("diagnostics")
            .getOrThrow()
            .asObject()
            .get("workspace")
            .getOrThrow()
            .asString()
            .getValue() == workspace
    }
    func view(record: JsonObject): String {
        let value = JsonObject()
        value.put("version", JsonInt(1));
        value.put("sessionId", JsonString(sessionId))
        value.put("peerId", JsonString(peerId))
        value.put("source", JsonString("durable-history"));
        value.put("scopeCurrent", JsonBool(currentScope(record)))
        if (record.size() == 0) {
            value.put("record", JsonNull())
        } else {
            value.put("record", record)
        }
        return value.toString()
    }
    public func describe(): String {
        synchronized(log.mtx) {
            return view(latest())
        }
    }
    public func recordIfCurrent(report: AcpProviderReadiness, scope: Int64, token: TurnToken): Bool {
        synchronized(log.mtx) {
            if (token.cancelled() || scopeRevision() != scope || !lease.protects(log.path)) {
                return false
            }
            record(report, scope)
            return true
        }
    }
    func persist(record: JsonObject): String {
        if (!lease.protects(log.path) || log.isDurableFrozen()) {
            throw Exception("not-authorized:acp-diagnostic-owner")
        }
        log.append(diagnosticEvent, record.toString())
        if (!log.durableCheckpoint(lease)) {
            log.freezeAfterDurableFailure();
            throw Exception("persistence-failed:acp-diagnostic")
        }
        return view(record)
    }
    public func record(report: AcpProviderReadiness, scope: Int64): String {
        synchronized(log.mtx) {
            let previous = latest()
            let revision = if (previous.size() == 0) {
                Int64(1)
            } else {
                previous.get("revision").getOrThrow().asInt().getValue() + 1
            }
            if (report.observation.diagnosticId.size == 0 || report.observation.workspace != workspace || scope < 0) {
                throw Exception("invalid-input:acp-diagnostic")
            }
            let record = JsonObject()
            record.put("version", JsonInt(1));
            record.put("sessionId", JsonString(sessionId))
            record.put("diagnosticId", JsonString(report.observation.diagnosticId));
            record.put("revision", JsonInt(revision))
            record.put("scopeRevision", JsonInt(scope));
            record.put("decision", JsonString("pending"))
            record.put("report", JsonValue.fromStr(acpReadinessJson(peerId, report)))
            return persist(record)
        }
    }
    public func keep(diagnosticId: String, expectedRevision: Int64): String {
        synchronized(log.mtx) {
            let record = latest()
            if (!currentScope(record) || record.get("diagnosticId").getOrThrow().asString().getValue() != diagnosticId) {
                throw Exception("revision-conflict:acp-diagnostic-scope")
            }
            let revision = record.get("revision").getOrThrow().asInt().getValue()
            let kept = record.get("decision").getOrThrow().asString().getValue() == "kept"
            if (kept && (revision == expectedRevision || revision == expectedRevision + 1)) {
                return view(record)
            }
            if (revision != expectedRevision) {
                throw Exception("revision-conflict:acp-diagnostic")
            }
            record.put("revision", JsonInt(revision + 1));
            record.put("decision", JsonString("kept"))
            return persist(record)
        }
    }
}
