package core

import std.sync.*
import stdx.encoding.json.*

// 项目会话级开关；只恢复配置，不恢复提供方进程、认证结论或任何执行许可。
public class AcpSessionSettings {
    public let effective = AcpSettingsService()
    let log: SessionLog
    let lease: WriteLease
    public let peerId: String
    let settingsEvent: String
    let mtx = Mutex()
    public init(log: SessionLog, lease: WriteLease, peerId!: String = "opencode") {
        this.log = log
        this.lease = lease
        this.peerId = peerId
        this.settingsEvent = acpProviderEvent("acp/settings", peerId)
        for (event in log.snapshotEvents()) {
            if (event.eventType != settingsEvent) {
                continue
            }
            let record = JsonValue.fromStr(event.data).asObject()
            let revision = record.get("revision").getOrThrow().asInt().getValue()
            let previous = effective.describe("project")
            if (record.size() != 2 || revision != previous.revision + 1) {
                throw Exception("replay-rejected:acp-settings-revision")
            }
            effective.setEnabled("project", record.get("enabled").getOrThrow().asBool().getValue(), previous.revision)
        }
    }
    public func belongsTo(path: String): Bool {
        return log.path == path
    }
    public func describe(): String {
        let snapshot = effective.describe("project")
        let result = JsonObject()
        result.put("enabled", JsonBool(snapshot.enabled));
        result.put("revision", JsonInt(snapshot.revision))
        result.put("source", JsonString(snapshot.source));
        result.put("scope", JsonString("project-session"))
        result.put("peerId", JsonString(peerId))
        return result.toString()
    }
    public func setEnabled(value: Bool, expectedRevision: Int64): String {
        mtx.lock()
        try {
            if (!lease.protects(log.path) || log.isDurableFrozen()) {
                throw Exception("not-authorized:acp-settings-owner")
            }
            let previous = effective.describe("project")
            if (previous.revision != expectedRevision) {
                throw Exception("revision-conflict:acp-settings")
            }
            let record = JsonObject();
            record.put("enabled", JsonBool(value));
            record.put("revision", JsonInt(previous.revision + 1))
            log.append(settingsEvent, record.toString())
            if (!log.durableCheckpoint(lease)) {
                log.freezeAfterDurableFailure();
                throw Exception("persistence-failed:acp-settings")
            }
            effective.setEnabled("project", value, previous.revision)
            return describe()
        } finally {
            mtx.unlock()
        }
    }
}
