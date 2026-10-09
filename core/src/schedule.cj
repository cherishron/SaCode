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

    // 扩展方法：任务定义
    public func registerTask(id: String, cron: String, prompt: String, oneShot: Bool, maxAgeSec: Int64,
                              workspaceDir: String, sessionLogPath: String, modelConfig: String): Unit {
        if (id.size == 0) { throw Exception("schedule-empty-id") }
        if (cron.size == 0) { throw Exception("schedule-empty-cron") }
        log.append("schedule/task", "taskdef::${id}::${cron}::${prompt}::${oneShot}::${maxAgeSec}::${workspaceDir}::${sessionLogPath}::${modelConfig}")
        ensureTaskActive(id)
    }

    public func listTasks(): ArrayList<TaskDefinition> {
        return taskDefs
    }

    public func pauseTask(id: String): Unit {
        let i = taskIndexOf(id)
        if (i < 0 || !taskDefs[i].active) { return }
        log.append("schedule/task", "taskpause::${id}")
        taskDefs[i].active = false
    }

    public func resumeTask(id: String): Unit {
        let i = taskIndexOf(id)
        if (i < 0 || taskDefs[i].active) { return }
        log.append("schedule/task", "taskresume::${id}")
        taskDefs[i].active = true
    }

    public func deleteTask(id: String): Unit {
        let i = taskIndexOf(id)
        if (i < 0) { return }
        log.append("schedule/task", "taskdelete::${id}")
        taskDefs[i].active = false
    }

    // 扩展方法：fire 记录
    public func recordFire(taskId: String, at: Int64): String {
        let fireId = "f${log.eventCount()}"
        log.append("schedule/fire", "fire::${fireId}::${taskId}::${at}")
        fireRecords.add(FireRecord(fireId, taskId, at, "pending", ""))
        return fireId
    }

    public func hasPendingFire(taskId: String): Bool {
        for (r in fireRecords) {
            if (r.taskId == taskId && r.status == "pending") { return true }
        }
        return false
    }

    public func updateFireResult(fireId: String, status: String, detail: String): Unit {
        for (r in fireRecords) {
            if (r.fireId == fireId) {
                r.status = status
                r.detail = detail
                log.append("schedule/fire", "result::${fireId}::${status}::${detail}")
                return
            }
        }
    }

    public func fireHistory(taskId: String): ArrayList<FireRecord> {
        let out = ArrayList<FireRecord>()
        for (r in fireRecords) {
            if (r.taskId == taskId) { out.add(r) }
        }
        return out
    }

    public func dueTasks(minute: Int64, hour: Int64, dom: Int64, month: Int64, dow: Int64): ArrayList<String> {
        let out = ArrayList<String>()
        for (t in taskDefs) {
            if (!t.active) { continue }
            if (hasPendingFire(t.id)) { continue }
            // 简化的 cron 匹配：此处仅用 CronSpec.parse 做完整匹配
            try {
                let spec = CronSpec.parse(t.cron)
                if (spec.matches(minute, hour, dom, month, dow)) {
                    out.add(t.id)
                }
            } catch (_: Exception) {}
        }
        return out
    }

    private let taskDefs = ArrayList<TaskDefinition>()
    private let fireRecords = ArrayList<FireRecord>()

    private func taskIndexOf(id: String): Int64 {
        var i: Int64 = 0
        while (i < Int64(taskDefs.size)) {
            if (taskDefs[i].id == id) { return i }
            i += 1
        }
        return Int64(-1)
    }

    private func ensureTaskActive(id: String): Unit {
        let i = taskIndexOf(id)
        if (i >= 0) {
            taskDefs[i].active = true
        } else {
            taskDefs.add(TaskDefinition(id, "", "", false, 0))
        }
    }
}

// 任务定义：持久化到 schedule/task 事件
public class TaskDefinition {
    public let id: String
    public let cron: String
    public let prompt: String
    public let oneShot: Bool
    public let maxAgeSec: Int64
    public let workspaceDir: String
    public let sessionLogPath: String
    public let modelConfig: String
    public var active: Bool
    public var revision: Int64
    init(id: String, cron: String, prompt: String, oneShot: Bool, maxAgeSec: Int64) {
        this.id = id
        this.cron = cron
        this.prompt = prompt
        this.oneShot = oneShot
        this.maxAgeSec = maxAgeSec
        this.workspaceDir = ""
        this.sessionLogPath = ""
        this.modelConfig = ""
        this.active = true
        this.revision = 0
    }
}

// 火次记录：fire::<fireId>::<taskId>::<at>
public class FireRecord {
    public let fireId: String
    public let taskId: String
    public let firedAt: Int64
    public var status: String
    public var detail: String
    init(fireId: String, taskId: String, firedAt: Int64, status: String, detail: String) {
        this.fireId = fireId
        this.taskId = taskId
        this.firedAt = firedAt
        this.status = status
        this.detail = detail
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
