package core
import std.fs.*
import std.time.*
import stdx.encoding.json.*

// ScheduleStore 的持久产品入口：配置保存不执行；火次与完成事实仍属于原调度存储。
public class AutomationStore {
    let root: String
    let path: String
    public let scope: String
    public let workspace: String
    public init(directory: String, scope: String, workspace: String) {
        if (scope != "user" && scope != "project") { throw Exception("automation-bad-scope") }
        this.root = canonicalize(directory).toString(); this.scope = scope
        this.workspace = if (scope == "project") { canonicalize(workspace).toString() } else { "" }
        let key = if (scope == "user") { "user" } else { sha256Hex(this.workspace.toArray()) }
        path = "${root}/automation-${key}.log"
    }
    public static func forScope(scope: String, workspace: String): AutomationStore {
        return AutomationStore(Path(GlobalAppearanceSettings.forUser().settingsPath()).parent.toString(), scope, workspace)
    }
    func load(): SessionLog {
        if (exists(path) && (canonicalize(path).parent.toString() != root || !FileInfo(path).isRegular() || FileInfo(path).size > 16777216)) { throw Exception("automation-path-rejected") }
        let log = SessionLog(path)
        if (!log.load() || log.isTruncatedTail()) { throw Exception("automation-replay-rejected") }
        for (e in log.snapshotEvents()) {
            if (e.eventType != "schedule/definition-v2" && e.eventType != "schedule/task" && e.eventType != "schedule/fire") { throw Exception("automation-replay-rejected") }
        }
        return log
    }
    func view(log: SessionLog, store: ScheduleStore): String {
        let obj = JsonObject(); let tasks = JsonArray()
        for (task in store.listTasks()) {
            let row = JsonValue.fromStr(task.modelConfig).asObject()
            row.put("id", JsonString(task.id)); row.put("cron", JsonString(task.cron)); row.put("prompt", JsonString(task.prompt))
            row.put("workspace", JsonString(task.workspaceDir)); row.put("enabled", JsonBool(task.active))
            let history = JsonArray()
            for (fire in store.fireHistory(task.id)) {
                let item = JsonObject(); item.put("id", JsonString(fire.fireId)); item.put("at", JsonInt(fire.firedAt))
                item.put("status", JsonString(if (fire.status == "pending") { "unknown" } else { fire.status }))
                item.put("detail", JsonString(fire.detail)); history.add(item)
            }
            row.put("history", history); tasks.add(row)
        }
        obj.put("scope", JsonString(scope)); obj.put("workspace", JsonString(workspace)); obj.put("revision", JsonInt(log.eventCount())); obj.put("tasks", tasks)
        obj.put("executorAvailable", JsonBool(false))
        return obj.toString()
    }
    public func describe(): String { let log = load(); return view(log, ScheduleStore(log)) }
    func mutate(expected: Int64, change: (SessionLog, ScheduleStore) -> Unit): String {
        if (expected < 0) { throw Exception("automation-bad-revision") }
        let lease = WriteLease(path)
        if (!lease.takeoverIfStale()) { throw Exception("automation-busy") }
        try {
            let log = load(); if (log.eventCount() != expected) { throw Exception("automation-revision-conflict") }
            let store = ScheduleStore(log); change(log, store)
            if (!lease.protects(path) || !log.flush()) { throw Exception("automation-persistence-failed") }
            return view(log, store)
        } finally { lease.release() }
    }
    public func save(text: String, expected: Int64): String {
        let input = JsonValue.fromStr(text).asObject()
        if (input.size() != 9) { throw Exception("automation-bad-definition") }
        let id = input.get("id").getOrThrow().asString().getValue()
        if (id.size == 0 || id.size > 80) { throw Exception("automation-bad-id") }
        for (b in id.toArray()) { if (!((b >= 48 && b <= 57) || (b >= 65 && b <= 90) || (b >= 97 && b <= 122) || b == 45 || b == 95)) { throw Exception("automation-bad-id") } }
        let title = input.get("title").getOrThrow().asString().getValue()
        let prompt = input.get("prompt").getOrThrow().asString().getValue()
        let cron = input.get("cron").getOrThrow().asString().getValue()
        let directory = canonicalize(input.get("workspace").getOrThrow().asString().getValue()).toString()
        let model = input.get("modelId").getOrThrow().asString().getValue()
        let timezone = input.get("timezone").getOrThrow().asString().getValue()
        let permission = input.get("permission").getOrThrow().asString().getValue()
        let enabled = input.get("enabled").getOrThrow().asBool().getValue()
        if (title.trimAscii().size == 0 || title.size > 600 || prompt.trimAscii().size == 0 || prompt.size > 65536 || model.size == 0 || model.size > 256 || !FileInfo(directory).isDirectory() || (scope == "project" && directory != workspace)) { throw Exception("automation-bad-definition") }
        if (permission != "plan" && permission != "build" && permission != "yolo" && permission != "auto-review") { throw Exception("automation-bad-permission") }
        var fields: Int64 = 0; for (part in cron.split(" ")) { if (part.size > 0) { fields += 1 } }
        if (fields != 5) { throw Exception("automation-bad-cron") }; CronSpec.parse(cron)
        try { TimeZone.load(timezone) }
        catch (_: Exception) { throw Exception("automation-timezone-load-failed") }
        let metadata = JsonObject(); metadata.put("title", JsonString(title)); metadata.put("modelId", JsonString(model)); metadata.put("timezone", JsonString(timezone)); metadata.put("permission", JsonString(permission))
        let definition = JsonObject(); definition.put("version", JsonInt(1)); definition.put("id", JsonString(id)); definition.put("cron", JsonString(cron)); definition.put("prompt", JsonString(prompt)); definition.put("workspace", JsonString(directory)); definition.put("sessionLogPath", JsonString("${root}/automation-run-${id}.log")); definition.put("metadata", metadata)
        return mutate(expected, { _, store =>
            if (store.listTasks().size >= 100) { var found = false; for (old in store.listTasks()) { if (old.id == id) { found = true } }; if (!found) { throw Exception("automation-capacity") } }
            store.registerStructuredTask(definition.toString()); if (!enabled) { store.pauseTask(id) }
        })
    }
    public func control(id: String, action: String, expected: Int64): String {
        if (action != "pause" && action != "resume" && action != "remove") { throw Exception("automation-bad-action") }
        return mutate(expected, { _, store =>
            var found = false; for (task in store.listTasks()) { if (task.id == id) { found = true } }
            if (!found) { throw Exception("automation-not-found") }
            if (action == "pause") { store.pauseTask(id) } else if (action == "resume") { store.resumeTask(id) } else { store.deleteTask(id) }
        })
    }
}
