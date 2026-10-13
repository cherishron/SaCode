package core
import std.collection.*
import std.convert.*

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
    let hookRegistry: HookRegistry
    var entries = ArrayList<ScheduleEntry>()

    public init(log: SessionLog, hookRegistry!: HookRegistry = HookRegistry()) {
        this.log = log
        this.hookRegistry = hookRegistry
        for (event in log.snapshotEvents()) {
            if (event.eventType != "schedule/task") {
                continue
            }
            let body = event.data
            if (body.startsWith("taskdef::")) {
                applyTaskDef(body["taskdef::".size..body.size])
            } else if (body.startsWith("taskpause::")) {
                let rest = body[11..body.size]
                let i = taskIndexOf(rest)
                if (i >= 0) { taskDefs[i].active = false }
            } else if (body.startsWith("taskresume::")) {
                let rest = body[12..body.size]
                let i = taskIndexOf(rest)
                if (i >= 0) { taskDefs[i].active = true }
            } else if (body.startsWith("taskdelete::")) {
                dropTask(body[12..body.size])
                dropEntry(body[12..body.size])
            } else if (body.startsWith("register::")) {
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

    // 回放 taskdef::<id>::<cron>::<prompt>::<oneShot>::<maxAgeSec>::<cwd>::<logPath>::<modelConfig>
    // 旧实现完全不认识 taskdef::，于是重启后任务定义整个丢失 —— 事件写对了也读不回来。
    // 字段不足时按缺省补齐并跳过：宁可少一条定义，也不要拿半截数据造出错的定义。
    private func applyTaskDef(rest: String): Unit {
        let parts = scheduleSplitAll(rest, "::")
        if (parts.size < 5) { return }
        let id = parts[0]
        if (id.size == 0) { return }
        // maxAgeSec 解析不了就当 0，但不能让一条脏数据把整批回放打断。
        var maxAge: Int64 = 0
        try { maxAge = Int64.parse(parts[4]) } catch (_: Exception) {}
        let definition = TaskDefinition(
            id,
            parts[1],
            parts[2],
            parts[3] == "true",
            maxAge,
            workspaceDir: if (parts.size > 5) { parts[5] } else { "" },
            sessionLogPath: if (parts.size > 6) { parts[6] } else { "" },
            modelConfig: if (parts.size > 7) { parts[7] } else { "" })
        defineTask(definition)
        ensureActive(id)
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

    public func fire(deliveryId: String, taskId: String): HookResult {
        let i = indexOf(taskId)
        if (i < 0 || !entries[i].active) {
            return HookResult(decision: HookDecision.Allow)
        }
        var cron = ""
        let ti = taskIndexOf(taskId)
        if (ti >= 0) {
            cron = taskDefs[ti].cron
        }
        let input = HookInput(
            sessionId: "",
            transcriptPath: "",
            cwd: "",
            hookEventName: "ScheduleFire",
            timestamp: 0,
            eventSpecific: HookEventData.Schedule(taskId, cron)
        )
        return hookRegistry.dispatch(HookEvent.ScheduleFire, input, taskId)
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
        defineTask(TaskDefinition(id, cron, prompt, oneShot, maxAgeSec,
                                   workspaceDir: workspaceDir, sessionLogPath: sessionLogPath,
                                   modelConfig: modelConfig))
        ensureTaskActive(id)
        ensureActive(id)
    }

    // 定义与激活是两件事：defineTask 负责字段，ensureTaskActive/ensureActive 只管 active。
    // 重复注册同一 id 时以最新定义覆盖旧字段——旧实现走 TaskDefinition 的不可变字段，
    // 重复注册只能整体丢弃，这里允许就地刷新以匹配「register 即当前定义」的语义。
    private func defineTask(definition: TaskDefinition): Unit {
        let i = taskIndexOf(definition.id)
        if (i >= 0) {
            let old = taskDefs[i]
            old.cron = definition.cron
            old.prompt = definition.prompt
            old.oneShot = definition.oneShot
            old.maxAgeSec = definition.maxAgeSec
            old.workspaceDir = definition.workspaceDir
            old.sessionLogPath = definition.sessionLogPath
            old.modelConfig = definition.modelConfig
            old.revision += 1
        } else {
            taskDefs.add(definition)
        }
    }

    public func listTasks(): ArrayList<TaskDefinition> {
        return taskDefs
    }

    public func pauseTask(id: String): Unit {
        let i = taskIndexOf(id)
        if (i >= 0 && taskDefs[i].active) {
            log.append("schedule/task", "taskpause::${id}")
            taskDefs[i].active = false
        }
        let j = indexOf(id)
        if (j >= 0 && entries[j].active) {
            log.append("schedule/task", "pause::${id}")
            entries[j].active = false
        }
    }

    public func resumeTask(id: String): Unit {
        let i = taskIndexOf(id)
        if (i >= 0 && !taskDefs[i].active) {
            log.append("schedule/task", "taskresume::${id}")
            taskDefs[i].active = true
        }
        let j = indexOf(id)
        if (j >= 0 && !entries[j].active) {
            log.append("schedule/task", "register::${id}::")
            entries[j].active = true
        }
    }

    // 删除要让 listTasks 里真的没有这一项（计划 Task 3 定的就是 delete + list）。
    // 旧实现只置 active=false，条目仍留在清单里，于是断言 size==0 失败。
    // 事件保留 taskdelete::，回放时按 id 从两个集合里一并摘掉。
    public func deleteTask(id: String): Unit {
        if (taskIndexOf(id) < 0) { return }
        log.append("schedule/task", "taskdelete::${id}")
        dropTask(id)
        dropEntry(id)
    }

    // 删除用「重建 + 回填」而不是 removeAt：
    // 本仓 std.collection.ArrayList 实测没有 removeAt（编译器直接报
    // 'removeAt' is not a member of class 'ArrayList<...>'），
    // 且 schedule.cj 顶部本就写着「避开 ArrayList.removeAt 与 Option 返回的边界不确定」。
    // 这里新建一个列表只装要留的条目，再整体替换——语义确定，也不依赖截尾 API。
    private func dropTask(id: String): Unit {
        let kept = ArrayList<TaskDefinition>()
        for (t in taskDefs) {
            if (t.id != id) { kept.add(t) }
        }
        taskDefs = kept
    }

    private func dropEntry(id: String): Unit {
        let kept = ArrayList<ScheduleEntry>()
        for (e in entries) {
            if (e.id != id) { kept.add(e) }
        }
        entries = kept
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

    private var taskDefs = ArrayList<TaskDefinition>()
    private let fireRecords = ArrayList<FireRecord>()

    private func taskIndexOf(id: String): Int64 {
        var i: Int64 = 0
        while (i < Int64(taskDefs.size)) {
            if (taskDefs[i].id == id) { return i }
            i += 1
        }
        return Int64(-1)
    }

    // 只负责 active 翻转，不再凭空造一个空定义。
// 旧实现在这里 TaskDefinition(id, "", "", false, 0)：定义字段全丢，
// 于是 listTasks 取回的 cron/prompt 恒为空串。定义只应由 defineTask（注册）
// 或回放 taskdef:: 事件产生。
private func ensureTaskActive(id: String): Unit {
        let i = taskIndexOf(id)
        if (i >= 0) {
            taskDefs[i].active = true
        }
    }
}

// 任务定义：持久化到 schedule/task 事件
public class TaskDefinition {
    public let id: String
    public var cron: String
    public var prompt: String
    public var oneShot: Bool
    public var maxAgeSec: Int64
    public var workspaceDir: String
    public var sessionLogPath: String
    public var modelConfig: String
    public var active: Bool
    public var revision: Int64

    // 完整构造：八个字段全部由调用方给出。
    // 旧构造（只接 id/cron/prompt/oneShot/maxAgeSec）曾把后三个字段写死空串，
    // 而 registerTask 又用 `TaskDefinition(id, "", "", false, 0)` 丢光 cron/prompt，
    // 于是 listTasks 取回的永远是空定义；两个缺陷叠在一起，taskdef:: 事件写对了也读不回来。
    init(id: String, cron: String, prompt: String, oneShot: Bool, maxAgeSec: Int64,
         workspaceDir!: String = "", sessionLogPath!: String = "", modelConfig!: String = "") {
        this.id = id
        this.cron = cron
        this.prompt = prompt
        this.oneShot = oneShot
        this.maxAgeSec = maxAgeSec
        this.workspaceDir = workspaceDir
        this.sessionLogPath = sessionLogPath
        this.modelConfig = modelConfig
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

// 按分隔符切全部字段。taskdef:: 有八个字段，splitOnce 只能切一次，不够用。
private func scheduleSplitAll(s: String, sep: String): ArrayList<String> {
    let out = ArrayList<String>()
    var rest = s
    while (true) {
        let idx = rest.indexOf(sep) ?? Int64(-1)
        if (idx < 0) {
            out.add(rest)
            break
        }
        out.add(rest[0..idx])
        rest = rest[(idx + sep.size)..rest.size]
    }
    return out
}
