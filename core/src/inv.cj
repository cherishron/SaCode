package core
import std.collection.*

// 不变量：把方案 §4 的 18 条冻结口径登记成可运行快照。log-only `invariant/register`
// 事件承载 `<id>::<description>`；`invariant/check` 事件承载 `<id>::<pass|fail>`。
// `status(id)` 从事件流回放取最近一次 check 结果；未登记 id check 抛。
//
// 本切片假设 id/description 不含 `::`。

class InvEntry {
    let id: String
    var lastCheck: String
    init(id: String, lastCheck: String) {
        this.id = id
        this.lastCheck = lastCheck
    }
}

public class InvariantRegistry {
    let log: SessionLog
    let entries = ArrayList<InvEntry>()

    public init(log: SessionLog) {
        this.log = log
        for (event in log.snapshotEvents()) {
            let t = event.eventType
            if (t == "invariant/register") {
                let body = event.data
                let idx = body.indexOf("::") ?? Int64(-1)
                let id = if (idx < 0) { body } else { body[0..idx] }
                if (indexOf(id) < 0) {
                    entries.add(InvEntry(id, "unchecked"))
                }
            } else if (t == "invariant/check") {
                let body = event.data
                let idx = body.indexOf("::") ?? Int64(-1)
                if (idx < 0) {
                    continue
                }
                let id = body[0..idx]
                let verdict = body[(idx + 2)..body.size]
                let i = indexOf(id)
                if (i >= 0) {
                    entries[i].lastCheck = verdict
                }
            }
        }
    }

    public func register(id: String, description: String): Unit {
        if (id.size == 0) {
            throw Exception("invariant-empty-id")
        }
        if (description.size == 0) {
            throw Exception("invariant-empty-description")
        }
        if (indexOf(id) >= 0) {
            return
        }
        log.append("invariant/register", "${id}::${description}")
        entries.add(InvEntry(id, "unchecked"))
    }

    public func check(id: String, ok: Bool): Unit {
        let i = indexOf(id)
        if (i < 0) {
            throw Exception("invariant-unknown-id")
        }
        let verdict = if (ok) { "pass" } else { "fail" }
        log.append("invariant/check", "${id}::${verdict}")
        entries[i].lastCheck = verdict
    }

    public func status(id: String): String {
        let i = indexOf(id)
        if (i < 0) {
            throw Exception("invariant-unknown-id")
        }
        return entries[i].lastCheck
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
