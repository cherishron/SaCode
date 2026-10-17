package core
import std.collection.*

// PTC 运行时：log-only `ptc/begin` 事件承载 `<callId>::<toolName>`、
// `ptc/end` 事件承载 `<callId>::<outcome>`；状态从 running 迁移到 outcome
// 字符串（如 "ok" / "error"），终态不可逆；双 begin 与未知 end 都抛。
//
// 本切片假设 callId/toolName/outcome 不含 `::`；未来放开需换长度前缀编码。

class PtcEntry {
    let callId: String
    var statusValue: String
    init(callId: String, statusValue: String) {
        this.callId = callId
        this.statusValue = statusValue
    }
}

public class PtcRuntime {
    let log: SessionLog
    let entries = ArrayList<PtcEntry>()

    public init(log: SessionLog) {
        this.log = log
        for (event in log.snapshotEvents()) {
            let t = event.eventType
            if (t == "ptc/begin") {
                let body = event.data
                let idx = body.indexOf("::") ?? Int64(-1)
                let id = if (idx < 0) { body } else { body[0..idx] }
                entries.add(PtcEntry(id, "running"))
            } else if (t == "ptc/end") {
                let body = event.data
                let idx = body.indexOf("::") ?? Int64(-1)
                let id = if (idx < 0) { body } else { body[0..idx] }
                let outcome = if (idx < 0) { "" } else { body[(idx + 2)..body.size] }
                let i = indexOf(id)
                if (i >= 0 && entries[i].statusValue == "running") {
                    entries[i].statusValue = outcome
                }
            }
        }
    }

    public func begin(callId: String, toolName: String): Unit {
        if (callId.size == 0) {
            throw Exception("ptc-empty-call-id")
        }
        if (toolName.size == 0) {
            throw Exception("ptc-empty-tool-name")
        }
        if (indexOf(callId) >= 0) {
            throw Exception("ptc-duplicate-call")
        }
        log.append("ptc/begin", "${callId}::${toolName}")
        entries.add(PtcEntry(callId, "running"))
    }

    public func end(callId: String, outcome: String): Unit {
        let i = indexOf(callId)
        if (i < 0) {
            throw Exception("ptc-unknown-call")
        }
        if (entries[i].statusValue != "running") {
            throw Exception("ptc-already-ended")
        }
        if (outcome.size == 0) {
            throw Exception("ptc-empty-outcome")
        }
        log.append("ptc/end", "${callId}::${outcome}")
        entries[i].statusValue = outcome
    }

    public func status(callId: String): String {
        let i = indexOf(callId)
        if (i < 0) {
            throw Exception("ptc-unknown-call")
        }
        return entries[i].statusValue
    }

    private func indexOf(callId: String): Int64 {
        var i: Int64 = 0
        while (i < Int64(entries.size)) {
            if (entries[i].callId == callId) {
                return i
            }
            i = i + 1
        }
        return Int64(-1)
    }
}
