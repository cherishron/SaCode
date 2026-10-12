package core
import std.collection.*
import stdx.encoding.json.*
import stdx.encoding.base64.*

// 输出与执行状态共用 SessionLog；base64 字节块不要求分页恰好落在 UTF-8 边界。
public class ExecutionOutput {
    let log: SessionLog
    let sessionId: String
    public init(log: SessionLog, sessionId: String) { this.log = log; this.sessionId = sessionId }
    public func records(id: String): ArrayList<JsonObject> {
        let result = ArrayList<JsonObject>()
        let sequences = HashMap<String, Int64>()
        let bytes = HashMap<String, Int64>()
        let closed = HashMap<String, Bool>()
        var phase = ""
        var limit = Int64(0)
        for (event in log.snapshotEvents()) {
            if (event.eventType == "execution/state") {
                let state = JsonValue.fromStr(event.data).asObject()
                if (state.get("executionId").getOrThrow().asString().getValue() == id) {
                    phase = state.get("phase").getOrThrow().asString().getValue()
                    limit = JsonValue.fromStr(state.get("proposal").getOrThrow().asString().getValue()).asObject()
                        .get("outputLimit").getOrThrow().asInt().getValue()
                }
            }
            if (event.eventType != "execution/output") { continue }
            let row = JsonValue.fromStr(event.data).asObject()
            if (row.get("sessionId").getOrThrow().asString().getValue() != sessionId) { throw Exception("session-mismatch") }
            if (row.get("executionId").getOrThrow().asString().getValue() != id) { continue }
            if (row.get("version").getOrThrow().asInt().getValue() != 1) { throw Exception("execution-output-format-unsupported") }
            let channel = row.get("channel").getOrThrow().asString().getValue()
            let seq = row.get("streamSequence").getOrThrow().asInt().getValue()
            let count = row.get("byteCount").getOrThrow().asInt().getValue()
            let data = fromBase64String(row.get("data").getOrThrow().asString().getValue()).getOrThrow()
            let end = row.get("endOfCapture").getOrThrow().asBool().getValue()
            let eof = row.get("eof").getOrThrow().asBool().getValue()
            let truncated = row.get("truncated").getOrThrow().asBool().getValue()
            let previous = if (sequences.contains(channel)) { sequences[channel] } else { Int64(0) }
            let retained = if (bytes.contains(channel)) { bytes[channel] } else { Int64(0) }
            if ((phase != "running" && phase != "stopping") || (channel != "stdout" && channel != "stderr") ||
                seq != previous + 1 || count != data.size || count > 512 || retained + count > limit ||
                (closed.contains(channel) && closed[channel]) || (end && count != 0) ||
                (!end && (count == 0 || eof || truncated))) { throw Exception("execution-output-corrupt") }
            sequences[channel] = seq; bytes[channel] = retained + count; closed[channel] = end
            row.put("cursor", JsonInt(event.seq))
            result.add(row)
        }
        return result
    }
    public func page(id: String, cursor: Int64, limit: Int64): String {
        if (cursor < -1 || limit < 1 || limit > 16) { throw Exception("bad-output-cursor") }
        let events = log.snapshotEvents()
        if (cursor >= events.size) { throw Exception("bad-output-cursor") }
        let records = records(id)
        let entries = JsonArray()
        var next = cursor
        var more = false
        for (row in records) {
            let seq = row.get("cursor").getOrThrow().asInt().getValue()
            if (seq <= cursor) { continue }
            if (entries.size() >= limit) { more = true; break }
            entries.add(row); next = seq
        }
        let page = JsonObject()
        page.put("executionId", JsonString(id)); page.put("sessionId", JsonString(sessionId))
        page.put("records", entries); page.put("nextCursor", JsonInt(next)); page.put("hasMore", JsonBool(more))
        return page.toString()
    }
}
