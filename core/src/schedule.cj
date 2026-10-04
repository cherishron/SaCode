package core
import std.collection.*

// 定时任务：log-only `schedule/task` 事件承载「register::<id>::<cron>」与
// 「pause::<id>」两种变更；`fire(deliveryId, taskId)` 只命中 id 匹配且
// active 者，返回命中数（0 或 1）。沿用 webhook 的 `active: Bool` 软删模式，
// 避开 ArrayList.removeAt 与 Option 返回的边界不确定。
//
// 本切片假设 id/cron 不含 `::`；未来放开需换长度前缀编码。

class ScheduleEntry {
    let id: String
    var active: Bool
    init(id: String, active: Bool) {
        this.id = id
        this.active = active
    }
}

public class ScheduleStore {
    let log: SessionLog
    let entries = ArrayList<ScheduleEntry>()

    public init(log: SessionLog) {
        this.log = log
        for (event in log.snapshotEvents()) {
            if (event.eventType != "schedule/task") {
                continue
            }
            let body = event.data
            if (body.startsWith("register::")) {
                let rest = body[10..body.size]
                let parts = splitOnce(rest, "::")
                ensureActive(parts.v0Name)
            } else if (body.startsWith("pause::")) {
                let rest = body[7..body.size]
                let i = indexOf(rest)
                if (i >= 0) {
                    entries[i].active = false
                }
            }
        }
    }

    public func register(id: String, cron: String): Unit {
        if (id.size == 0) {
            throw Exception("schedule-empty-id")
        }
        if (cron.size == 0) {
            throw Exception("schedule-empty-cron")
        }
        let i = indexOf(id)
        if (i >= 0 && entries[i].active) {
            return
        }
        log.append("schedule/task", "register::${id}::${cron}")
        ensureActive(id)
    }

    public func pause(id: String): Unit {
        let i = indexOf(id)
        if (i < 0 || !entries[i].active) {
            return
        }
        log.append("schedule/task", "pause::${id}")
        entries[i].active = false
    }

    public func fire(deliveryId: String, taskId: String): Int64 {
        let i = indexOf(taskId)
        if (i < 0 || !entries[i].active) {
            return Int64(0)
        }
        return Int64(1)
    }

    public func countActive(): Int64 {
        var n: Int64 = 0
        for (e in entries) {
            if (e.active) {
                n = n + 1
            }
        }
        return n
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

    private func ensureActive(id: String): Unit {
        let i = indexOf(id)
        if (i >= 0) {
            entries[i].active = true
        } else {
            entries.add(ScheduleEntry(id, true))
        }
    }

    private static func splitOnce(s: String, sep: String): SplitOnceResult {
        let idx = s.indexOf(sep) ?? Int64(-1)
        if (idx < 0) {
            return SplitOnceResult(s, "")
        }
        return SplitOnceResult(s[0..idx], s[(idx + sep.size)..s.size])
    }
}

class SplitOnceResult {
    let v0Name: String
    let v1Name: String
    init(a: String, b: String) {
        v0Name = a
        v1Name = b
    }
}
