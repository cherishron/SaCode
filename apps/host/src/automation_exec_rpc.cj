package host

import core.*
import std.collection.*
import std.fs.*
import std.sync.Mutex
import std.time.*
import stdx.encoding.json.*

// F13 执行器薄适配，仅供调度方合并。main.cj 尚未分派，能力表/IPC 尚未增加。
// 每个会话/工作区/配置域保留一个长寿命实例，不能每条 RPC new，否则每分钟重置启动水位。
// 运行日志与聊天日志、AutomationStore 配置日志分开：core 执行器拥有自己的 WriteLease；
// 本类借用会话写租约，不接管/释放调用方的租约，不把聊天历史送入执行器的回放器。
public class AutomationExecRpc {
    let sessionLog: SessionLog
    let sessionLease: WriteLease
    let sessionId: String
    let sessionPath: String
    let scopeId: String
    let workspace: String
    let workspaceRevision: Int64
    let executor: AutomationExecutor
    let definitions = HashMap<String, AutomationHookDefinition>()
    let mutex = Mutex()
    var opened = false
    var closed = false

    // log/path/lease 必须来自同一个真实 Host 会话写者。路径只由可信装配传入，非 RPC 参数。
    // runner 默认缺省，不自行创建裸 shell 提供方；clock 只在可信测试/调度装配中注入。
    public init(log: SessionLog, lease: WriteLease, sessionId: String, sessionLogPath: String,
        scopeId: String, runner!: ?AutomationHookRunner = None,
        clock!: () -> Int64 = {=> DateTime.nowUTC().toUnixTimeStamp().toSeconds()}) {
        if (sessionId.size == 0 || sessionId.size > 256 || scopeId.size == 0 || scopeId.size > 256 ||
            sessionLogPath.size == 0 || sessionLogPath.contains("\0")) { throw Exception("automation-exec-bad-binding") }
        this.sessionLog = log; this.sessionLease = lease; this.sessionId = sessionId; this.scopeId = scopeId
        let source = Path(sessionLogPath)
        if (!source.isAbsolute() || source.fileName.size == 0) { throw Exception("automation-exec-bad-binding") }
        let parent = canonicalize(source.parent).toString()
        this.sessionPath = Path(parent).join(source.fileName).toString()
        let ws = SessionWorkspace(log)
        this.workspace = ws.directory(); this.workspaceRevision = ws.revision()
        // 不在未知/未配置工作区里装配可以执行命令的实例。
        if (workspace.size == 0) { throw Exception("automation-project-required") }
        let key = JsonArray()
        for (part in [sessionId, scopeId, workspace]) { key.add(JsonString(part)) }
        let journalPath = Path(parent).join("automation-exec-" + sha256Hex(key.toString().toArray()) + ".log").toString()
        if (automationExecPathKey(journalPath) == automationExecPathKey(this.sessionPath)) {
            throw Exception("automation-exec-bad-binding")
        }
        // 不创建目录、不读取 HOME、不读取磁盘Hooks，也不从 prompt 猜测 shell command。
        executor = AutomationExecutor(journalPath, runner: runner, clock: clock)
    }

    public static func handles(method: String): Bool {
        return method == "automation/tick" || method == "automation/describe-execution"
    }

    func checkBinding(activeId: String, writer: Bool): Unit {
        if (closed) { throw Exception("automation-exec-closed") }
        if (activeId != sessionId) { throw Exception("automation-session-changed") }
        let ws = SessionWorkspace(sessionLog)
        if (ws.directory() != workspace || ws.revision() != workspaceRevision) { throw Exception("automation-workspace-changed") }
        if (writer) {
            if (sessionLog.isDurableFrozen() || !sessionLease.protects(sessionPath)) {
                throw Exception("automation-session-not-writer")
            }
            // 同时验证传入的log与lease真正配对；持久失败不能继续准入运行日志中的新火次。
            if (!sessionLog.durableCheckpoint(sessionLease)) {
                sessionLog.freezeAfterDurableFailure(); throw Exception("automation-persistence-failed")
            }
        }
    }

    func ensureOpen(): Unit {
        if (!opened) {
            if (!executor.open()) { throw Exception("automation-executor-busy-or-unavailable") }
            opened = true
        }
    }

    // 以下是可信调度装配接缝，不是第三条 RPC。调用方已完成项目/preset信任和定义来源核验。
    // activated=false只声明，不能报loaded；activate不执行命令，也不授予脚本一次性批准。
    // 禁止把AutomationStore任务的自然语言prompt当成Hook command传进来。
    public func install(definition: AutomationHookDefinition, activated!: Bool = false): String {
        return synchronized(mutex) {
            checkBinding(sessionId, true)
            if (definition.scopeId != scopeId || definition.directory != workspace) {
                throw Exception("automation-definition-scope-mismatch")
            }
            ensureOpen()
            var view = executor.declare(definition)
            definitions[definition.taskId] = definition
            if (activated) { view = executor.load(definition.taskId, definition.digest) }
            return viewJson(view).toString()
        }
    }

    public func unload(taskId: String): String {
        return synchronized(mutex) {
            checkBinding(sessionId, true)
            if (!definitions.contains(taskId) || !opened) { throw Exception("automation-not-declared") }
            return viewJson(executor.unload(taskId)).toString()
        }
    }

    // 两个RPC均不接受 now/minute、command、路径、runner、approved等客户端自报字段。
    // tick: {sessionId,scopeId}；describe: {sessionId,scopeId,taskId[,fireId]}。
    // core目前describe按task返回最近火次；旧fireId不匹配明确报错，绝不冒充返回该旧火次。
    public func requestJson(method: String, params: JsonObject, activeId: String): String {
        return synchronized(mutex) {
            if (!AutomationExecRpc.handles(method)) { throw Exception("automation-exec-method-not-found") }
            let ticking = method == "automation/tick"
            if ((ticking && params.size() != 2) || (!ticking && params.size() != 3 && params.size() != 4)) {
                throw Exception("automation-exec-bad-args")
            }
            for ((key, _) in params.getFields()) {
                let allowed = key == "sessionId" || key == "scopeId" || (!ticking && (key == "taskId" || key == "fireId"))
                if (!allowed) {
                    throw Exception("automation-exec-bad-args")
                }
            }
            if (params.get("sessionId").getOrThrow().asString().getValue() != sessionId || activeId != sessionId) {
                throw Exception("automation-session-changed")
            }
            if (params.get("scopeId").getOrThrow().asString().getValue() != scopeId) {
                throw Exception("automation-definition-scope-mismatch")
            }
            checkBinding(activeId, ticking)
            let response = envelope()
            if (ticking) {
                ensureOpen()
                let views = executor.tick()
                let rows = JsonArray()
                for (view in views) { rows.add(viewJson(view)) }
                response.put("executions", rows)
                response.put("evaluated", JsonBool(true))
                response.put("commandsStartedByTick", JsonInt(0))
                response.put("schedulerOpened", JsonBool(opened))
            } else {
                let taskId = params.get("taskId").getOrThrow().asString().getValue()
                if (taskId.size == 0 || taskId.size > 80 || !definitions.contains(taskId)) {
                    throw Exception("automation-not-declared")
                }
                let view = executor.describe(taskId)
                if (let Some(value) <- params.get("fireId")) {
                    let fireId = value.asString().getValue()
                    if (fireId.size == 0 || fireId.size > 256 || view.fireId != fireId) {
                        throw Exception("automation-fire-not-current")
                    }
                }
                response.put("execution", viewJson(view))
            }
            return response.toString()
        }
    }

    func envelope(): JsonObject {
        let obj = JsonObject()
        obj.put("sessionId", JsonString(sessionId)); obj.put("scopeId", JsonString(scopeId))
        obj.put("workspace", JsonString(workspace)); obj.put("workspaceRevision", JsonInt(workspaceRevision))
        obj.put("misfirePolicy", JsonString("skip")); obj.put("startupMinutePolicy", JsonString("skip-startup-minute"))
        obj.put("schedulerOpened", JsonBool(opened)); return obj
    }

    func viewJson(view: AutomationExecutionView): JsonObject {
        let obj = JsonObject(); obj.put("taskId", JsonString(view.taskId)); obj.put("agentPresetId", JsonString(view.agentPresetId))
        let declaration = JsonObject()
        declaration.put("status", JsonString(view.declarationStatus)); declaration.put("digest", JsonString(view.declaredDigest))
        declaration.put("basis", JsonString("trusted-definition-snapshot"))
        if (let Some(definition) <- definitions.get(view.taskId)) {
            declaration.put("sourceLabel", JsonString(definition.sourceLabel))
        }
        // valid不是“已扫描真实磁盘”；此适配不读取settings，不能给diskLoaded:true之类虚假回执。
        obj.put("declaration", declaration)
        let loading = JsonObject(); loading.put("status", JsonString(view.loadStatus)); loading.put("digest", JsonString(view.loadedDigest))
        obj.put("loading", loading)
        let execution = JsonObject(); execution.put("status", JsonString(view.executionStatus))
        execution.put("fireId", if (view.fireId.size == 0) { JsonNull() } else { JsonString(view.fireId) })
        execution.put("approvalId", if (view.approvalId == 0) { JsonNull() } else { JsonInt(view.approvalId) })
        execution.put("approvalDomain", JsonString("automation-executor"))
        execution.put("reason", JsonString(view.reason)); execution.put("exitObserved", JsonBool(view.exitObserved))
        execution.put("exitCode", if (view.exitObserved) { JsonInt(view.exitCode) } else { JsonNull() })
        execution.put("hookDecision", JsonString(view.hookDecision)); execution.put("missedMinutes", JsonInt(view.missedMinutes))
        obj.put("execution", execution); obj.put("executorAvailable", JsonBool(view.executorAvailable))
        return obj
    }

    // Host分派合并时调用；不属于本类的method返回false，不发协议帧。
    public func handle(method: String, body: String, idText: String, activeId: String): Bool {
        if (!AutomationExecRpc.handles(method)) { return false }
        try {
            let params = JsonValue.fromStr(body).asObject().get("params").getOrThrow().asObject()
            emit(okFrame(idText, requestJson(method, params, activeId)))
        } catch (e: Exception) {
            let reason = automationExecRpcReason(e.message)
            let code: Int64 = if (reason == "automation-exec-bad-args") { -32602 } else { -32003 }
            emit(errFrame(idText, code, reason))
        }
        return true
    }

    // EOF/切会话先关闭本实例，再释放Host会话写租约；false须保留实例等待资源结算。
    public func close(): Bool {
        return synchronized(mutex) {
            if (closed) { return true }
            if (opened && !executor.close()) { return false }
            opened = false; closed = true; return true
        }
    }
}

@When[os == "Windows"]
func automationExecPathKey(path: String): String { return path.replace("\\", "/").toAsciiLower() }
@When[os != "Windows"]
func automationExecPathKey(path: String): String { return path }

func automationExecRpcReason(message: String): String {
    for (known in ["automation-exec-bad-args", "automation-session-changed", "automation-workspace-changed",
        "automation-definition-scope-mismatch", "automation-session-not-writer", "automation-persistence-failed",
        "automation-executor-busy-or-unavailable", "automation-executor-not-owned", "automation-exec-closed",
        "automation-not-declared", "automation-fire-not-current", "automation-bad-clock", "automation-capacity"]) {
        if (message == known) { return known }
    }
    // JSON字段缺失/类型错误统一拒绝，不把异常中的磁盘路径/command/凭据回显。
    return "automation-exec-bad-args"
}
