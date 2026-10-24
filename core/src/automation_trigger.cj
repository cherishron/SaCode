package core

import std.collection.*
import std.fs.*
import std.sync.Mutex
import std.time.*
import stdx.encoding.json.*

// F13 调度「持久触发准入」核心切片（AU-02 第一阶段，对齐 design §4.1/§4.3/§4.4）。
// 只做已核准的触发唯一性、去重与恢复；不启动模型/命令/网络，不制造成功历史。
// 触发经持久准入（单写者租约 + flush 屏障 + 幂等键）后，才允许交 F13-E 执行本模块产出的
// 准入记录。与 AutomationStore 的配置日志分离：本模块使用独立版本化运行日志，不向只允许
// 三类旧 schedule 事件的配置日志写新事实（design §4.3 末段 / §8 待确认 6）。

// 允许的触发来源：Cron 计划、调用方显式手动、获验证的内部事件。
func automationTriggerValidKind(kind: String): Bool {
    return kind == "schedule" || kind == "manual" || kind == "event"
}

func automationTriggerValidStatus(status: String): Bool {
    for (s in ["admitted", "dispatched", "succeeded", "failed", "cancelled", "timed-out", "unknown", "skipped"]) {
        if (s == status) { return true }
    }
    return false
}

// 在途（未结算）状态：admitted/dispatched/unknown。unknown 是恢复屏障——已准入但无法确认是否
// 已派发，禁止自动重发，也参与 overlap 判定（design §4.3）。
func automationTriggerIsOpen(status: String): Bool {
    return status == "admitted" || status == "dispatched" || status == "unknown"
}

// 触发意图：把一次“打算触发”转成有身份、可持久去重的记录。幂等键不含 definitionRevision，
// 使内容编辑不令同一逻辑触发再次准入（design §4.1 末段）；排程修订的生效边界由上层用修订
// 水位控制，不改变本键。
public class AutomationTriggerIntent {
    public let taskId: String
    public let scopeId: String
    public let definitionRevision: Int64
    public let triggerKind: String        // schedule | manual | event
    public let logicalOccurrence: String  // UTC 计划分钟串 | 手动 requestId | 可信事件 ID
    public let scheduledAtUtc: Int64
    public let triggerKey: String
    public init(taskId: String, scopeId: String, definitionRevision: Int64, triggerKind: String,
        logicalOccurrence: String, scheduledAtUtc: Int64) {
        if (taskId.size == 0 || taskId.size > 80 || scopeId.size == 0 || scopeId.size > 256 ||
            logicalOccurrence.size == 0 || logicalOccurrence.size > 256 || definitionRevision < 1 ||
            scheduledAtUtc < 0 || scheduledAtUtc > 253402300799) { throw Exception("automation-trigger-bad-intent") }
        for (b in taskId.toArray()) {
            if (!((b >= 48 && b <= 57) || (b >= 65 && b <= 90) || (b >= 97 && b <= 122) || b == 45 || b == 95)) {
                throw Exception("automation-trigger-bad-intent")
            }
        }
        if (!automationTriggerValidKind(triggerKind)) { throw Exception("automation-trigger-bad-intent") }
        let key = JsonArray()
        for (s in [scopeId, taskId, triggerKind, logicalOccurrence]) { key.add(JsonString(s)) }
        this.taskId = taskId; this.scopeId = scopeId; this.definitionRevision = definitionRevision
        this.triggerKind = triggerKind; this.logicalOccurrence = logicalOccurrence
        this.scheduledAtUtc = scheduledAtUtc; this.triggerKey = sha256Hex(key.toString().toArray())
    }
}

public class AutomationTriggerAdmission {
    public let triggerKey: String
    public let state: String     // admitted | skipped | unknown | dispatched | settled 终态…
    public let admitted: Bool    // 本次是否新准入（false=幂等命中或按策略跳过）
    public let reason: String
    init(triggerKey: String, state: String, admitted: Bool, reason: String) {
        this.triggerKey = triggerKey; this.state = state; this.admitted = admitted; this.reason = reason
    }
}

class AutomationTriggerRecord {
    let triggerKey: String
    let taskId: String
    let scopeId: String
    var status: String
    var runRef: String = ""
    var detail: String = ""
    init(triggerKey: String, taskId: String, scopeId: String, status: String) {
        this.triggerKey = triggerKey; this.taskId = taskId; this.scopeId = scopeId; this.status = status
    }
}

// 独立运行日志：append-only 状态快照，末次胜出。open 时按租约取唯一所有权并回放；
// 回放后把未结算的 admitted/dispatched 降为 unknown 屏障，不自动重发（design §4.3）。
public class AutomationTriggerLog {
    let journal: SessionLog
    let lease: WriteLease
    let path: String
    let mutex = Mutex()
    let records = HashMap<String, AutomationTriggerRecord>()
    let watermarks = HashMap<String, Int64>()
    let missedMinutes = HashMap<String, Int64>()
    var opened = false
    var retired = false
    var frozen = false
    public init(journalPath: String) {
        journal = SessionLog(journalPath); lease = WriteLease(journalPath); path = journalPath
    }
    public func open(): Bool {
        return synchronized(mutex) {
            if (opened) { return true }
            if (frozen || retired || !lease.takeoverIfStale()) { return false }
            var ok = false
            try {
                if (exists(path) && (!FileInfo(path).isRegular() || FileInfo(path).isSymbolicLink() ||
                    FileInfo(path).size > 16777216)) { throw Exception("automation-trigger-replay-rejected") }
                if (!journal.load() || journal.isTruncatedTail()) { throw Exception("automation-trigger-replay-rejected") }
                replay(); opened = true; ok = true
            } catch (_: Exception) { frozen = true; lease.release() }
            return ok
        }
    }
    func checkOwner(): Unit {
        if (!opened || frozen || journal.isDurableFrozen() || !lease.protects(path)) { throw Exception("automation-trigger-not-owned") }
    }
    func persist(kind: String, obj: JsonObject): Unit {
        checkOwner(); obj.put("version", JsonInt(1)); journal.append(kind, obj.toString())
        if (!journal.flush()) {
            frozen = true; journal.freezeAfterDurableFailure(); throw Exception("automation-trigger-persistence-failed")
        }
    }
    func persistState(status: String, key: String, taskId: String, scopeId: String, runRef: String, detail: String): Unit {
        let obj = JsonObject()
        obj.put("triggerKey", JsonString(key)); obj.put("taskId", JsonString(taskId)); obj.put("scopeId", JsonString(scopeId))
        obj.put("status", JsonString(status)); obj.put("runRef", JsonString(runRef)); obj.put("detail", JsonString(detail))
        // 先落盘（屏障），成功后才改内存：准入失败必须零派发。
        persist("automation-trigger/state", obj)
        if (let Some(rec) <- records.get(key)) {
            rec.status = status; rec.runRef = runRef; rec.detail = detail
        } else {
            let rec = AutomationTriggerRecord(key, taskId, scopeId, status); rec.runRef = runRef; rec.detail = detail
            records[key] = rec
        }
    }
    func replay(): Unit {
        for (event in journal.snapshotEvents()) {
            if (event.eventType == "automation-trigger/watermark") { applyWatermark(event.data); continue }
            if (event.eventType != "automation-trigger/state") { throw Exception("automation-trigger-replay-rejected") }
            let obj = JsonValue.fromStr(event.data).asObject()
            if (obj.get("version").getOrThrow().asInt().getValue() != 1) { throw Exception("automation-trigger-replay-rejected") }
            let key = obj.get("triggerKey").getOrThrow().asString().getValue()
            let taskId = obj.get("taskId").getOrThrow().asString().getValue()
            let scopeId = obj.get("scopeId").getOrThrow().asString().getValue()
            let status = obj.get("status").getOrThrow().asString().getValue()
            if (!automationTriggerValidStatus(status)) { throw Exception("automation-trigger-replay-rejected") }
            let runRef = obj.get("runRef").getOrThrow().asString().getValue()
            let detail = obj.get("detail").getOrThrow().asString().getValue()
            if (let Some(rec) <- records.get(key)) {
                rec.status = status; rec.runRef = runRef; rec.detail = detail
            } else {
                let rec = AutomationTriggerRecord(key, taskId, scopeId, status); rec.runRef = runRef; rec.detail = detail
                records[key] = rec
            }
        }
        // 恢复屏障：未结算的在途火次一律降为 unknown，禁止自动重发（design §4.3）。
        for ((_, rec) in records) {
            if (rec.status == "admitted" || rec.status == "dispatched") { rec.status = "unknown" }
        }
    }
    func applyWatermark(data: String): Unit {
        let obj = JsonValue.fromStr(data).asObject()
        let taskId = obj.get("taskId").getOrThrow().asString().getValue()
        let minute = obj.get("minute").getOrThrow().asInt().getValue()
        let missed = obj.get("missedMinutes").getOrThrow().asInt().getValue()
        watermarks[taskId] = minute; missedMinutes[taskId] = missed
    }
    func taskHasOpenRun(taskId: String): Bool {
        for ((_, rec) in records) {
            if (rec.taskId == taskId && automationTriggerIsOpen(rec.status)) { return true }
        }
        return false
    }
    public func hasOpenTrigger(taskId: String): Bool {
        return synchronized(mutex) { return taskHasOpenRun(taskId) }
    }
    public func statusOf(triggerKey: String): String {
        return synchronized(mutex) {
            if (let Some(rec) <- records.get(triggerKey)) { return rec.status }
            return ""
        }
    }
    // 持久准入：同键幂等返回已有记录；同 task 已有在途火次时按 overlap=skip 留原因，不排队。
    public func admit(intent: AutomationTriggerIntent): AutomationTriggerAdmission {
        return synchronized(mutex) {
            checkOwner()
            if (let Some(existing) <- records.get(intent.triggerKey)) {
                return AutomationTriggerAdmission(intent.triggerKey, existing.status, false, "duplicate-trigger")
            }
            if (taskHasOpenRun(intent.taskId)) {
                persistState("skipped", intent.triggerKey, intent.taskId, intent.scopeId, "", "overlap-skip")
                return AutomationTriggerAdmission(intent.triggerKey, "skipped", false, "overlap-skip")
            }
            persistState("admitted", intent.triggerKey, intent.taskId, intent.scopeId, "", "")
            return AutomationTriggerAdmission(intent.triggerKey, "admitted", true, "")
        }
    }
    // 准入后、真正交 F13-E 执行前登记 run 引用；只允许从 admitted 迁移。
    public func markDispatched(triggerKey: String, runRef: String): Unit {
        return synchronized(mutex) {
            checkOwner()
            if (runRef.size == 0 || runRef.size > 256) { throw Exception("automation-trigger-bad-run-ref") }
            let rec = records.get(triggerKey) ?? throw Exception("automation-trigger-not-found")
            if (rec.status != "admitted") { throw Exception("automation-trigger-bad-transition") }
            persistState("dispatched", triggerKey, rec.taskId, rec.scopeId, runRef, "")
        }
    }
    // 结算在途火次。status 是真实终态，绝不拿准入成功冒充执行成功。
    public func settle(triggerKey: String, status: String, detail: String): Unit {
        return synchronized(mutex) {
            checkOwner()
            if (status != "succeeded" && status != "failed" && status != "cancelled" &&
                status != "timed-out" && status != "unknown") { throw Exception("automation-trigger-bad-status") }
            let rec = records.get(triggerKey) ?? throw Exception("automation-trigger-not-found")
            if (!automationTriggerIsOpen(rec.status)) { throw Exception("automation-trigger-bad-transition") }
            persistState(status, triggerKey, rec.taskId, rec.scopeId, rec.runRef, detail)
        }
    }
    // 推进某 task 的计划分钟水位（墙钟回退不重发；首次推进不记错过）。返回累计错过数。
    public func advanceWatermark(taskId: String, minute: Int64): Int64 {
        return synchronized(mutex) {
            checkOwner()
            if (minute < 0 || minute > 253402300799 / 60) { throw Exception("automation-trigger-bad-watermark") }
            let old = watermarks.get(taskId) ?? -1
            if (minute <= old) { return missedMinutes.get(taskId) ?? 0 }
            let missed = if (old < 0) { 0 } else { (missedMinutes.get(taskId) ?? 0) + max(Int64(0), minute - old - 1) }
            let obj = JsonObject(); obj.put("taskId", JsonString(taskId)); obj.put("minute", JsonInt(minute))
            obj.put("missedMinutes", JsonInt(missed))
            persist("automation-trigger/watermark", obj)
            watermarks[taskId] = minute; missedMinutes[taskId] = missed
            return missed
        }
    }
    public func watermarkOf(taskId: String): Int64 {
        return synchronized(mutex) { return watermarks.get(taskId) ?? -1 }
    }
    public func missedOf(taskId: String): Int64 {
        return synchronized(mutex) { return missedMinutes.get(taskId) ?? 0 }
    }
    public func close(): Bool {
        return synchronized(mutex) {
            if (!opened) { return true }
            opened = false; retired = true; return lease.release()
        }
    }
}

// Cron 边界判定：复用 AutomationExecutor 的严格五字段校验与 CronSpec，按声明 IANA 时区把 UTC
// 计划分钟转本地墙钟后匹配（design §4.2）。不新增第二套 cron 调度器（ADR-HOOK-02）。
public func automationTriggerCronMatches(cron: String, timezone: String, utcMinute: Int64): Bool {
    if (utcMinute < 0 || utcMinute > 253402300799 / 60) { throw Exception("automation-trigger-bad-minute") }
    let spec = automationExecutorCron(cron)
    let zone = if (timezone == "UTC") { TimeZone.UTC } else { TimeZone.load(timezone) }
    let at = DateTime.fromUnixTimeStamp((utcMinute * 60) * Duration.second).inTimeZone(zone)
    return spec.matches(at.minute, at.hour, at.dayOfMonth, at.month.toInteger(), at.dayOfWeek.toInteger())
}