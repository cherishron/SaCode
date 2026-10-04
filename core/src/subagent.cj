package core
import std.collection.*

// 子代理 ledger：log-only `subagent/spawn` `<id>::<task>` 与 `subagent/settle`
// `<id>::<result>` / `subagent/cancel` `<id>` 事件；状态 pending/settled/cancelled；
// 终态不可逆。

class SaEntry {
    let id: String
    var statusValue: String
    var result: String
    init(id: String, statusValue: String, result: String) {
        this.id = id
        this.statusValue = statusValue
        this.result = result
    }
}

public class SubagentLedger {
    let log: SessionLog
    let entries = ArrayList<SaEntry>()

    public init(log: SessionLog) {
        this.log = log
        for (event in log.snapshotEvents()) {
            let t = event.eventType
            if (t == "subagent/spawn") {
                let body = event.data
                let idx = body.indexOf("::") ?? Int64(-1)
                let id = if (idx < 0) { body } else { body[0..idx] }
                entries.add(SaEntry(id, "pending", ""))
            } else if (t == "subagent/settle") {
                let body = event.data
                let idx = body.indexOf("::") ?? Int64(-1)
                let id = if (idx < 0) { body } else { body[0..idx] }
                let result = if (idx < 0) { "" } else { body[(idx + 2)..body.size] }
                let i = indexOf(id)
                if (i >= 0 && entries[i].statusValue == "pending") {
                    entries[i].statusValue = "settled"
                    entries[i].result = result
                }
            } else if (t == "subagent/cancel") {
                let i = indexOf(event.data)
                if (i >= 0 && entries[i].statusValue == "pending") {
                    entries[i].statusValue = "cancelled"
                }
            }
        }
    }

    public func launch(id: String, task: String): Unit {
        if (id.size == 0) {
            throw Exception("subagent-empty-id")
        }
        if (task.size == 0) {
            throw Exception("subagent-empty-task")
        }
        if (indexOf(id) >= 0) {
            throw Exception("subagent-duplicate-id")
        }
        log.append("subagent/spawn", "${id}::${task}")
        entries.add(SaEntry(id, "pending", ""))
    }

    public func settle(id: String, result: String): Unit {
        let i = indexOf(id)
        if (i < 0) {
            throw Exception("subagent-unknown")
        }
        if (entries[i].statusValue != "pending") {
            throw Exception("subagent-terminal")
        }
        log.append("subagent/settle", "${id}::${result}")
        entries[i].statusValue = "settled"
        entries[i].result = result
    }

    public func cancel(id: String): Unit {
        let i = indexOf(id)
        if (i < 0) {
            throw Exception("subagent-unknown")
        }
        if (entries[i].statusValue != "pending") {
            throw Exception("subagent-terminal")
        }
        log.append("subagent/cancel", id)
        entries[i].statusValue = "cancelled"
    }

    public func status(id: String): String {
        let i = indexOf(id)
        if (i < 0) {
            throw Exception("subagent-unknown")
        }
        return entries[i].statusValue
    }

    public func resultOf(id: String): String {
        let i = indexOf(id)
        if (i < 0) {
            throw Exception("subagent-unknown")
        }
        return entries[i].result
    }

    public func count(): Int64 {
        return Int64(entries.size)
    }

    private func indexOf(id: String): Int64 {
        var i: Int64 = 0
        while (i < Int64(entries.size)) {
            if (entries[i].id == id) {
                return i
            }
            i = i + 1
        }
        return Int64(-1)
    }
}
