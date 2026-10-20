package core

import std.collection.*
import std.convert.*
import std.fs.*
import std.sync.Mutex
import std.time.*
import std.unicode.*
import stdx.encoding.json.*

// F13 的独立核心执行切片。调用方在可信装配中提供定义、时钟及受控执行器；
// 不读取真实 HOME，不开后台线程，不修改 AutomationStore 的事件白名单/能力标志。
// 独立运行日志 + 整个实例生命周期持有的 WriteLease 保证单写者；崩溃火次不重发。
public class AutomationHookDefinition {
    public let taskId: String
    public let scopeId: String
    public let agentPresetId: String
    public let sourceLabel: String
    public let cron: String
    public let scheduleRevision: Int64
    public let timezone: String
    public let directory: String
    public let command: String
    public let timeoutMs: Int64
    public let digest: String
    public init(taskId: String, scopeId: String, agentPresetId: String, sourceLabel: String,
        cron: String, directory: String, command: String, scheduleRevision!: Int64 = 1,
        timezone!: String = "UTC", timeoutMs!: Int64 = 30000) {
        if (taskId.size == 0 || taskId.size > 80 || scopeId.size == 0 || scopeId.size > 256 ||
            agentPresetId.size == 0 || agentPresetId.size > 256 || sourceLabel.size > 600 ||
            command.trimAscii().size == 0 || command.size > 65536 || command.contains("\0") ||
            timeoutMs < 1 || timeoutMs > 300000 || scheduleRevision < 1) { throw Exception("automation-bad-definition") }
        for (b in taskId.toArray()) {
            if (!((b >= 48 && b <= 57) || (b >= 65 && b <= 90) || (b >= 97 && b <= 122) || b == 45 || b == 95)) {
                throw Exception("automation-bad-id")
            }
        }
        automationExecutorCron(cron)
        if (timezone != "UTC") { TimeZone.load(timezone) }
        let resolved = canonicalize(directory).toString()
        if (!FileInfo(resolved).isDirectory()) { throw Exception("automation-bad-directory") }
        this.taskId = taskId; this.scopeId = scopeId; this.agentPresetId = agentPresetId
        this.sourceLabel = sourceLabel; this.cron = cron; this.directory = resolved; this.command = command
        this.scheduleRevision = scheduleRevision; this.timezone = timezone; this.timeoutMs = timeoutMs
        let values = JsonArray()
        for (s in [taskId, scopeId, agentPresetId, sourceLabel, cron, resolved, command,
            scheduleRevision.toString(), timezone, timeoutMs.toString()]) { values.add(JsonString(s)) }
        digest = sha256Hex(values.toString().toArray())
    }
}

// CronSpec 做实际匹配；本层仅补严格五字段/值域/步进验证，避免旧解析器静默接受坏定义。
func automationCronInteger(text: String, low: Int64, high: Int64): Int64 {
    if (text.size == 0 || text.size > 3) { throw Exception("automation-bad-cron") }
    for (b in text.toArray()) { if (b < 48 || b > 57) { throw Exception("automation-bad-cron") } }
    let n = Int64.parse(text)
    if (n < low || n > high) { throw Exception("automation-bad-cron") }
    return n
}
func automationExecutorCron(text: String): CronSpec {
    if (text.size == 0 || text.size > 256) { throw Exception("automation-bad-cron") }
    let fields = text.split(" ", removeEmpty: true)
    if (fields.size != 5) { throw Exception("automation-bad-cron") }
    let lows: Array<Int64> = [0, 0, 1, 1, 0]; let highs: Array<Int64> = [59, 23, 31, 12, 7]
    for (i in 0..5) {
        for (item in fields[i].split(",")) {
            let pieces = item.split("/")
            if (pieces.size > 2 || pieces[0].size == 0) { throw Exception("automation-bad-cron") }
            let base = pieces[0]
            if (pieces.size == 2) { automationCronInteger(pieces[1], 1, highs[i] - lows[i] + 1) }
            if (base != "*") {
                let range = base.split("-")
                if (range.size == 1 && pieces.size == 1) { automationCronInteger(base, lows[i], highs[i]) }
                else if (range.size == 2) {
                    let left = automationCronInteger(range[0], lows[i], highs[i])
                    let right = automationCronInteger(range[1], lows[i], highs[i])
                    if (left > right) { throw Exception("automation-bad-cron") }
                } else { throw Exception("automation-bad-cron") }
            }
        }
    }
    return CronSpec.parse(text)
}

public class AutomationHookInvocation {
    public let fireId: String
    public let definition: AutomationHookDefinition
    public let scheduledMinute: Int64
    public let input: HookInput
    public let approvalArguments: String
    init(fireId: String, definition: AutomationHookDefinition, scheduledMinute: Int64, journal: String) {
        this.fireId = fireId; this.definition = definition; this.scheduledMinute = scheduledMinute
        input = HookInput(sessionId: fireId, transcriptPath: journal, cwd: definition.directory,
            hookEventName: "ScheduleFire", timestamp: scheduledMinute * 60,
            agentId: Some(definition.agentPresetId), agentType: Some("local-preset"),
            eventSpecific: HookEventData.Schedule(definition.taskId, definition.cron))
        let obj = JsonObject()
        obj.put("fireId", JsonString(fireId)); obj.put("definitionDigest", JsonString(definition.digest))
        obj.put("command", JsonString(definition.command)); obj.put("directory", JsonString(definition.directory))
        obj.put("agentPresetId", JsonString(definition.agentPresetId)); obj.put("timeoutMs", JsonInt(definition.timeoutMs))
        obj.put("input", JsonValue.fromStr(hookInputJson(input)))
        approvalArguments = obj.toString()
    }
}

// 仅可信编译期装配，不是用户可提交的回调。实现必须返回真实进程事实、响应token，
// 约束脚本/子进程权限且不将宿主秘密授予脚本；不可借“定时任务”默认扩权。
public interface AutomationHookRunner {
    func execute(invocation: AutomationHookInvocation, token: TurnToken): ?ShellResult
}

// 共享受控 ShellExecutor 的命令适配；不调用会把异常/超时归 Allow 的旧HookExecutor。
// 运行目录、脚本目录须由可信装配配置在实际沙箱获准范围内；缺隔离由ShellExecutor拒绝，
// 不设置no-sandbox，不提供任意环境覆盖。脚本继承环境的秘密隔离仍须装配方验证。
public class AutomationShellHookRunner <: AutomationHookRunner {
    let executor: ShellExecutor
    let temporaryDirectory: String
    public init(executor: ShellExecutor, temporaryDirectory: String) {
        this.executor = executor; this.temporaryDirectory = canonicalize(temporaryDirectory).toString()
    }
    public func execute(invocation: AutomationHookInvocation, token: TurnToken): ?ShellResult {
        if (token.cancelled()) { return None }
        let definition = invocation.definition
        let paths = ArrayList<String>()
        try {
            let input = File.createTemp(temporaryDirectory); let inputPath = input.info.path.toString(); paths.add(inputPath)
            try { input.write(hookInputJson(invocation.input).toArray()) } finally { input.close() }
            let bodyFile = File.createTemp(temporaryDirectory); let bodyPath = bodyFile.info.path.toString(); paths.add(bodyPath)
            bodyFile.close()
            var program = "/bin/sh"; var arguments: Array<String> = [bodyPath]
            if (hookRunsOnWindows()) {
                // cmd路径有二次展开；拒特殊展开字节，不把未知路径转成可执行片段。
                for (path in [inputPath, bodyPath]) {
                    if (path.contains("%") || path.contains("!") || path.contains("\"") || path.contains("\r") || path.contains("\n")) {
                        throw Exception("automation-temporary-path-rejected")
                    }
                }
                let commandPath = bodyPath + ".cmd"; paths.add(commandPath)
                File.writeTo(commandPath, ("@echo off\r\n" + definition.command + "\r\n").toArray())
                let wrapper = bodyPath + ".cmd-run.cmd"; paths.add(wrapper)
                File.writeTo(wrapper, ("@echo off\r\ncall \"" + commandPath + "\" < \"" + inputPath + "\"\r\nexit /b %errorlevel%\r\n").toArray())
                program = "cmd.exe"; arguments = ["/d", "/c", wrapper]
            } else {
                let quoted = "'" + inputPath.replace("'", "'\"'\"'") + "'"
                File.writeTo(bodyPath, ("exec < " + quoted + "\n" + definition.command + "\n").toArray())
            }
            return executor.run(program, arguments, cwd: definition.directory, timeoutMs: definition.timeoutMs,
                outputLimit: 65536, cancelled: {=> token.cancelled()}, startToken: Some(token))
        } finally {
            for (path in paths) { try { removeIfExists(path) } catch (_: Exception) {} }
        }
    }
}

public class AutomationExecutionView {
    public let taskId: String
    public let declarationStatus: String
    public let declaredDigest: String
    public let loadStatus: String
    public let loadedDigest: String
    public let executionStatus: String
    public let fireId: String
    public let approvalId: Int64
    public let reason: String
    public let exitObserved: Bool
    public let exitCode: Int64
    public let hookDecision: String
    public let missedMinutes: Int64
    public let agentPresetId: String
    public let executorAvailable: Bool
    init(taskId: String, declaredDigest: String, loadStatus: String, loadedDigest: String,
        executionStatus: String, fireId: String, approvalId: Int64, reason: String,
        exitObserved: Bool, exitCode: Int64, hookDecision: String, missedMinutes: Int64,
        agentPresetId: String, executorAvailable: Bool) {
        // valid仅表示调用方传入的声明快照通过本模块校验，非本模块读取过真实磁盘的证明。
        // sourceLabel是来源标签，不是对其他Agent已加载/已执行的断言。
        this.taskId = taskId; this.declarationStatus = if (declaredDigest.size > 0) { "valid" } else { "missing" }
        this.declaredDigest = declaredDigest; this.loadStatus = loadStatus; this.loadedDigest = loadedDigest
        this.executionStatus = executionStatus; this.fireId = fireId; this.approvalId = approvalId
        this.reason = reason; this.exitObserved = exitObserved; this.exitCode = exitCode
        this.hookDecision = hookDecision; this.missedMinutes = missedMinutes
        this.agentPresetId = agentPresetId; this.executorAvailable = executorAvailable
    }
}
class AutomationExecutorFire {
    let id: String
    let taskId: String
    let digest: String
    let minute: Int64
    var status = "waiting-approval"
    var approvalId: Int64 = 0
    var reason = ""
    var exitObserved = false
    var exitCode: Int64 = -1
    var decision = ""
    let token = TurnToken()
    init(id: String, taskId: String, digest: String, minute: Int64) {
        this.id = id; this.taskId = taskId; this.digest = digest; this.minute = minute
    }
}

public class AutomationExecutor {
    let journal: SessionLog
    let lease: WriteLease
    let clock: () -> Int64
    let runner: ?AutomationHookRunner
    let mutex = Mutex()
    public let approvals: ApprovalDesk
    let declared = HashMap<String, AutomationHookDefinition>()
    let loaded = HashMap<String, String>()
    let watermarks = HashMap<String, Int64>()
    let missed = HashMap<String, Int64>()
    let fires = HashMap<String, AutomationExecutorFire>()
    let lastFire = HashMap<String, String>()
    var opened = false
    var retired = false
    var frozen = false
    var startupMinute: Int64 = 0
    public init(journalPath: String, runner!: ?AutomationHookRunner = None,
        clock!: () -> Int64 = {=> DateTime.nowUTC().toUnixTimeStamp().toSeconds()},
        approvalClock!: () -> Int64 = monotonicSeconds()) {
        journal = SessionLog(journalPath); lease = WriteLease(journalPath)
        this.clock = clock; this.runner = runner; approvals = ApprovalDesk(journal, clock: approvalClock)
    }
    public func open(): Bool {
        return synchronized(mutex) {
            if (opened) { return true }
            if (frozen || retired || !lease.takeoverIfStale()) { return false }
            var ok = false
            try {
                if (exists(journal.path) && (!FileInfo(journal.path).isRegular() || FileInfo(journal.path).isSymbolicLink() ||
                    FileInfo(journal.path).size > 16777216)) { throw Exception("automation-replay-rejected") }
                if (!journal.load() || journal.isTruncatedTail()) { throw Exception("automation-replay-rejected") }
                replay(); let now = clock()
                if (now < 0 || now > 253402300799) { throw Exception("automation-bad-clock") }
                startupMinute = now / 60; opened = true; ok = true
            } catch (_: Exception) { frozen = true; lease.release() }
            return ok
        }
    }
    func checkOwner(): Unit {
        if (!opened || frozen || journal.isDurableFrozen() || !lease.protects(journal.path)) { throw Exception("automation-executor-not-owned") }
    }
    func persist(kind: String, obj: JsonObject): Unit {
        checkOwner(); obj.put("version", JsonInt(1)); journal.append(kind, obj.toString())
        if (!journal.flush()) {
            frozen = true; journal.freezeAfterDurableFailure(); throw Exception("automation-persistence-failed")
        }
    }
    func taskObject(taskId: String): JsonObject {
        let obj = JsonObject(); obj.put("taskId", JsonString(taskId)); return obj
    }
    func fireObject(fire: AutomationExecutorFire): JsonObject {
        let obj = taskObject(fire.taskId); obj.put("fireId", JsonString(fire.id)); obj.put("digest", JsonString(fire.digest))
        obj.put("minute", JsonInt(fire.minute)); obj.put("status", JsonString(fire.status))
        obj.put("approvalId", JsonInt(fire.approvalId)); obj.put("reason", JsonString(fire.reason))
        obj.put("exitObserved", JsonBool(fire.exitObserved)); obj.put("exitCode", JsonInt(fire.exitCode))
        obj.put("decision", JsonString(fire.decision)); return obj
    }
    func replay(): Unit {
        for (event in journal.snapshotEvents()) {
            if (event.eventType.startsWith("approval/")) { continue }
            if (event.eventType != "automation-executor/watermark" && event.eventType != "automation-executor/fire" &&
                event.eventType != "automation-executor/loaded" && event.eventType != "automation-executor/declared") {
                throw Exception("automation-replay-rejected")
            }
            let obj = JsonValue.fromStr(event.data).asObject()
            if (obj.get("version").getOrThrow().asInt().getValue() != 1) { throw Exception("automation-replay-rejected") }
            let taskId = obj.get("taskId").getOrThrow().asString().getValue()
            if (event.eventType == "automation-executor/watermark") {
                watermarks[taskId] = obj.get("minute").getOrThrow().asInt().getValue()
                missed[taskId] = obj.get("missedMinutes").getOrThrow().asInt().getValue()
            }
            if (event.eventType == "automation-executor/fire") {
                let id = obj.get("fireId").getOrThrow().asString().getValue()
                let fire = AutomationExecutorFire(id, taskId, obj.get("digest").getOrThrow().asString().getValue(),
                    obj.get("minute").getOrThrow().asInt().getValue())
                fire.status = obj.get("status").getOrThrow().asString().getValue()
                if (fire.status != "waiting-approval" && fire.status != "running" && fire.status != "unknown" &&
                    fire.status != "blocked" && fire.status != "succeeded" && fire.status != "failed" &&
                    fire.status != "timed-out" && fire.status != "cancelled") { throw Exception("automation-replay-rejected") }
                fire.approvalId = obj.get("approvalId").getOrThrow().asInt().getValue()
                fire.reason = obj.get("reason").getOrThrow().asString().getValue()
                fire.exitObserved = obj.get("exitObserved").getOrThrow().asBool().getValue()
                fire.exitCode = obj.get("exitCode").getOrThrow().asInt().getValue()
                fire.decision = obj.get("decision").getOrThrow().asString().getValue()
                fires[id] = fire; lastFire[taskId] = id
            }
        }
        // 即便旧票显示批准，重启也不恢复放行；未结算火次保留unknown占位，禁止同任务再自动跑。
        for ((_, fire) in fires) {
            if (fire.status == "running" || fire.status == "waiting-approval") {
                fire.status = "unknown"; fire.reason = "automation-recovery-requires-review"; fire.approvalId = 0
            }
        }
        // 不回放loaded为本实例已装载；必须由可信调用方重新declare/load。
    }
    public func declare(definition: AutomationHookDefinition): AutomationExecutionView {
        return synchronized(mutex) {
            checkOwner()
            if (let Some(old) <- declared.get(definition.taskId)) {
                if (old.scopeId != definition.scopeId) { throw Exception("automation-task-scope-conflict") }
                if (old.digest != definition.digest) {
                    for ((_, fire) in fires) {
                        if (fire.taskId == definition.taskId && fire.status == "running") { fire.token.cancel() }
                    }
                }
            }
            if (declared.size >= 100 && !declared.contains(definition.taskId)) { throw Exception("automation-capacity") }
            let obj = taskObject(definition.taskId); obj.put("digest", JsonString(definition.digest))
            obj.put("sourceLabel", JsonString(definition.sourceLabel)); obj.put("agentPresetId", JsonString(definition.agentPresetId))
            persist("automation-executor/declared", obj); declared[definition.taskId] = definition
            return view(definition.taskId)
        }
    }
    // 只表示本实例装载了给定快照，非脚本执行授权。调用方先完成项目/preset信任核验。
    public func load(taskId: String, expectedDigest: String): AutomationExecutionView {
        return synchronized(mutex) {
            checkOwner(); let definition = declared.get(taskId) ?? throw Exception("automation-not-declared")
            if (definition.digest != expectedDigest) { throw Exception("automation-definition-stale") }
            let obj = taskObject(taskId); obj.put("digest", JsonString(expectedDigest))
            persist("automation-executor/loaded", obj); loaded[taskId] = expectedDigest
            return view(taskId)
        }
    }
    public func unload(taskId: String): AutomationExecutionView {
        return synchronized(mutex) {
            checkOwner(); loaded.remove(taskId)
            for ((_, fire) in fires) {
                if (fire.taskId != taskId) { continue }
                fire.token.cancel()
                if (fire.status == "waiting-approval") {
                    approvals.cancel(fire.approvalId); fire.status = "blocked"; fire.reason = "automation-unloaded"
                    persist("automation-executor/fire", fireObject(fire))
                }
            }
            return view(taskId)
        }
    }
    func hasOpenFire(taskId: String): Bool {
        var found = false
        for ((_, fire) in fires) {
            if (fire.taskId == taskId && (fire.status == "waiting-approval" || fire.status == "running" || fire.status == "unknown")) { found = true }
        }
        return found
    }
    // 无后台线程：由唯一可信宿主定时调用。只评估当前分钟，过去分钟记录missed而不遍历补发。
    // 首次open所在分钟不触发；内容修订不改变同分钟triggerKey，避免编辑后重复准入。
    public func tick(): Array<AutomationExecutionView> {
        return synchronized(mutex) {
            checkOwner(); let seconds = clock()
            if (seconds < 0 || seconds > 253402300799) { throw Exception("automation-bad-clock") }
            let minute = seconds / 60; let results = ArrayList<AutomationExecutionView>()
            for ((taskId, definition) in declared) {
                let old = watermarks.get(taskId) ?? startupMinute
                if (minute <= max(old, startupMinute)) { results.add(view(taskId)); continue }
                let missedCount = (missed.get(taskId) ?? 0) + max(Int64(0), minute - old - 1)
                let mark = taskObject(taskId); mark.put("minute", JsonInt(minute)); mark.put("missedMinutes", JsonInt(missedCount))
                persist("automation-executor/watermark", mark); watermarks[taskId] = minute; missed[taskId] = missedCount
                if (loaded.get(taskId) != Some(definition.digest) || hasOpenFire(taskId)) { results.add(view(taskId)); continue }
                let zone = if (definition.timezone == "UTC") { TimeZone.UTC } else { TimeZone.load(definition.timezone) }
                let at = DateTime.fromUnixTimeStamp((minute * 60) * Duration.second).inTimeZone(zone)
                if (!automationExecutorCron(definition.cron).matches(at.minute, at.hour, at.dayOfMonth, at.month.toInteger(), at.dayOfWeek.toInteger())) {
                    results.add(view(taskId)); continue
                }
                let key = JsonArray()
                for (s in [definition.scopeId, taskId, minute.toString()]) { key.add(JsonString(s)) }
                let id = "automation-fire-" + sha256Hex(key.toString().toArray())
                if (fires.contains(id)) { results.add(view(taskId)); continue }
                let fire = AutomationExecutorFire(id, taskId, definition.digest, minute)
                if (runner.isNone()) { fire.status = "blocked"; fire.reason = "automation-executor-unavailable" }
                // 先持久登记，再生成工单；失败不能落到执行。工单只绑定当前实例，重启不复用。
                persist("automation-executor/fire", fireObject(fire)); fires[id] = fire; lastFire[taskId] = id
                if (fire.status == "waiting-approval") {
                    let call = AutomationHookInvocation(id, definition, minute, journal.path)
                    fire.approvalId = approvals.askForCall("automation/hook-command", call.approvalArguments, ttl: 300)
                    persist("automation-executor/fire", fireObject(fire))
                }
                results.add(view(taskId))
            }
            return results.toArray()
        }
    }
    // 审批检查、准入落盘在锁内；执行移到锁外，describe/cancel仍可调用。
    public func execute(fireId: String): AutomationExecutionView {
        var call: ?AutomationHookInvocation = None
        var chosen: ?AutomationExecutorFire = None
        synchronized(mutex) {
            checkOwner(); let fire = fires.get(fireId) ?? throw Exception("automation-fire-not-found"); chosen = Some(fire)
            if (fire.status == "waiting-approval") {
                let definition = declared.get(fire.taskId) ?? throw Exception("automation-not-declared")
                if (definition.digest != fire.digest || loaded.get(fire.taskId) != Some(fire.digest)) {
                    approvals.cancel(fire.approvalId); fire.status = "blocked"; fire.reason = "automation-definition-stale"
                    persist("automation-executor/fire", fireObject(fire))
                } else {
                    let state = approvals.stateOf(fire.approvalId)
                    if (state != "pending") {
                        let invocation = AutomationHookInvocation(fire.id, definition, fire.minute, journal.path)
                        if (state == "allowed-once" && approvals.consumeExactForCall(fire.approvalId,
                            "automation/hook-command", invocation.approvalArguments) == "allowed-once" && !fire.token.cancelled()) {
                            fire.status = "running"; fire.reason = ""
                            try { persist("automation-executor/fire", fireObject(fire)) }
                            catch (e: Exception) {
                                fire.status = "unknown"; fire.reason = "automation-persistence-failed"; throw e
                            }
                            call = Some(invocation)
                        } else {
                            fire.status = "blocked"; fire.reason = "automation-approval-" + state
                            persist("automation-executor/fire", fireObject(fire))
                        }
                    }
                }
            }
        }
        if (let Some(invocation) <- call) {
            let fire = chosen.getOrThrow()
            var result: ?ShellResult = None
            var threw = false
            try {
                let handler = runner.getOrThrow()
                if (!fire.token.cancelled()) { result = handler.execute(invocation, fire.token) }
            } catch (_: Exception) { threw = true }
            synchronized(mutex) {
                settle(fire, result, threw)
                try { persist("automation-executor/fire", fireObject(fire)) }
                catch (_: Exception) { fire.status = "unknown"; fire.reason = "automation-persistence-failed" }
            }
        }
        return synchronized(mutex) { view(chosen.getOrThrow().taskId) }
    }
    func settle(fire: AutomationExecutorFire, result: ?ShellResult, threw: Bool): Unit {
        fire.status = "unknown"; fire.reason = "automation-hook-outcome-unknown"
        if (threw) { return }
        if (let Some(value) <- result) {
            fire.exitObserved = value.exitObserved; fire.exitCode = value.exitCode
            // 无退出/采集完整性时不把取消请求、exitCode占位或Allow输出当执行完成。
            if (!value.exitObserved || !value.outputComplete) { return }
            if (value.timedOut) { fire.status = "timed-out"; fire.reason = "automation-hook-timeout"; return }
            if (value.cancelled) { fire.status = "cancelled"; fire.reason = "automation-hook-cancelled"; return }
            if (value.error.size > 0 || value.exitCode != 0) {
                fire.status = "failed"; fire.reason = "automation-hook-failed"
                if (value.exitCode == 2) { fire.decision = "deny" }; return
            }
            if (value.stdoutTruncated || value.stderrTruncated) { fire.status = "failed"; fire.reason = "automation-hook-output-limited"; return }
            var decision = "allow"
            if (value.stdout.trimAscii().size > 0) {
                try {
                    let obj = JsonValue.fromStr(value.stdout).asObject()
                    if (let Some(v) <- obj.get("decision")) { decision = v.asString().getValue().toAsciiLower() }
                    if (decision != "allow" && decision != "deny" && decision != "ask" && decision != "block") {
                        throw Exception("automation-hook-output-invalid")
                    }
                } catch (_: Exception) { fire.status = "failed"; fire.reason = "automation-hook-output-invalid"; return }
            }
            fire.status = "succeeded"; fire.reason = ""; fire.decision = decision
        }
    }
    public func cancel(fireId: String): AutomationExecutionView {
        return synchronized(mutex) {
            checkOwner(); let fire = fires.get(fireId) ?? throw Exception("automation-fire-not-found")
            fire.token.cancel()
            if (fire.status == "waiting-approval") {
                approvals.cancel(fire.approvalId); fire.status = "blocked"; fire.reason = "automation-cancelled-before-start"
                persist("automation-executor/fire", fireObject(fire))
            }
            return view(fire.taskId)
        }
    }
    public func describe(taskId: String): AutomationExecutionView { return synchronized(mutex) { view(taskId) } }
    // 给可信人机审批面显示完整原始提案；不提供“自报批准”参数，不从磁盘命令自动授予票。
    public func approvalArguments(fireId: String): String {
        return synchronized(mutex) {
            checkOwner(); let fire = fires.get(fireId) ?? throw Exception("automation-fire-not-found")
            let definition = declared.get(fire.taskId) ?? throw Exception("automation-not-declared")
            if (definition.digest != fire.digest) { throw Exception("automation-definition-stale") }
            return AutomationHookInvocation(fire.id, definition, fire.minute, journal.path).approvalArguments
        }
    }
    func view(taskId: String): AutomationExecutionView {
        let definition = declared.get(taskId)
        let digest = if (let Some(d) <- definition) { d.digest } else { "" }
        let preset = if (let Some(d) <- definition) { d.agentPresetId } else { "" }
        let loadDigest = loaded.get(taskId) ?? ""
        let loadState = if (loadDigest.size == 0) { "not-loaded" } else if (loadDigest == digest) { "loaded" } else { "stale" }
        let fire = fires.get(lastFire.get(taskId) ?? "")
        if (let Some(f) <- fire) {
            return AutomationExecutionView(taskId, digest, loadState, loadDigest, f.status, f.id, f.approvalId,
                f.reason, f.exitObserved, f.exitCode, f.decision, missed.get(taskId) ?? 0, preset, runner.isSome())
        }
        return AutomationExecutionView(taskId, digest, loadState, loadDigest, "not-started", "", 0, "", false, -1, "",
            missed.get(taskId) ?? 0, preset, runner.isSome())
    }
    public func close(): Bool {
        return synchronized(mutex) {
            var running = false
            for ((_, fire) in fires) { if (fire.status == "running") { fire.token.cancel(); running = true } }
            // 不在运行尚未收束时释放唯一所有者，让另一实例误判可接手。
            if (running) { return false }
            if (!opened) { return true }
            opened = false; retired = true; return lease.release()
        }
    }
}
