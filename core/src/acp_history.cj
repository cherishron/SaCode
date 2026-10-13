package core
import stdx.encoding.json.*

// 持久委派事实的只读消费；不创建进程、租约、授权或任务。
public class AcpHistory {
    let log: SessionLog
    let sessionId: String
    public init(log: SessionLog, sessionId: String) { this.log = log; this.sessionId = sessionId }
    public static func handles(method: String): Bool { return method == "acp/delegation/list" || method == "acp/delegation/describe" }
    private func encode(snapshot: AcpDelegationSnapshot): JsonObject {
        let obj = JsonObject()
        obj.put("delegationId", JsonString(snapshot.id)); obj.put("sessionId", JsonString(snapshot.sessionId))
        obj.put("taskId", JsonString(snapshot.taskId)); obj.put("requestId", JsonString(snapshot.requestId))
        obj.put("peerId", JsonString(snapshot.peerId)); obj.put("protocolSessionId", JsonString(snapshot.protocolSessionId))
        obj.put("phase", JsonString(snapshot.phase)); obj.put("revision", JsonInt(snapshot.revision))
        obj.put("result", JsonString(snapshot.result)); obj.put("source", JsonString("durable-history"))
        return obj
    }
    public func dispatch(method: String, params: String): String {
        if (!AcpHistory.handles(method)) { throw Exception("unsupported:acp-history-method") }
        let obj = JsonValue.fromStr(params).asObject()
        let detail = method == "acp/delegation/describe"
        if (obj.size() != (if (detail) { 2 } else { 1 })) { throw Exception("invalid-input:acp-history-arguments") }
        if (obj.get("sessionId").getOrThrow().asString().getValue() != sessionId) { throw Exception("invalid-input:acp-session-changed") }
        let wanted = if (detail) { obj.get("delegationId").getOrThrow().asString().getValue() } else { "" }
        if (detail && wanted.size == 0) { throw Exception("invalid-input:acp-delegation-id") }
        let records = AcpDelegationJournal(log, WriteLease(log.path), sessionId).recover()
        let result = JsonObject(); result.put("version", JsonInt(1)); result.put("sessionId", JsonString(sessionId))
        let items = JsonArray()
        for (record in records) {
            if (detail && record.snapshot.id == wanted) { result.put("delegation", encode(record.snapshot)); return result.toString() }
            items.add(encode(record.snapshot))
        }
        if (detail) { throw Exception("not-found:acp-delegation") }
        result.put("delegations", items)
        return result.toString()
    }
}
