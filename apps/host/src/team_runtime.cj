package host

import core.*
import std.collection.*
import std.env.*
import std.fs.*
import std.sync.*
import std.time.*
import stdx.encoding.json.*

private func hostTeamText(obj: JsonObject, key: String): String {
    return obj.get(key).getOrThrow().asString().getValue()
}
private func hostTeamJson(key: String, value: String): String {
    let out = JsonObject(); out.put(key, JsonString(value)); return out.toString()
}

// 只缓存执行资源；成员、任务与消息状态一律从独立 TeamBoard 日志重建。
private class HostTeamMember {
    let id: String
    let sessionId: String
    let log: SessionLog
    let path: String
    let lease: WriteLease
    let desk: ApprovalDesk
    var runner: ?TeamMemberRunner = None
    var stopped = false
    var fault = ""
    var writer = false
    var epoch: Int64 = 0
    init(id: String, sessionId: String, path: String) {
        this.id = id; this.sessionId = sessionId; this.path = path
        log = SessionLog(path); lease = WriteLease(path); desk = ApprovalDesk(log)
    }
}
private class HostTeamState {
    let leader: String
    let log: SessionLog
    let lease: WriteLease
    let board: TeamBoard
    let members = HashMap<String, HostTeamMember>()
    init(leader: String, path: String) {
        this.leader = leader; log = SessionLog(path); lease = WriteLease(path)
        if (!lease.takeoverIfStale()) { throw Exception("team-already-owned") }
        try {
            if (!log.load()) { throw Exception("team-replay-rejected") }
            board = TeamBoard(log, lease)
        } catch (e: Exception) { lease.release(); throw e }
    }
}

// Host 单例，生命周期不随选中会话改变。main 只转发协议与定时 poll，不共享 active 日志。
public class HostTeamRuntime {
    let root: String
    let catalog: SessionCatalog
    let mtx = Mutex()
    private let teams = HashMap<String, HostTeamState>()
    var workspace: ?TeamWorkspace = None
    var workspaceRoot = ""
    var closing = false

    public init(root: String, catalog: SessionCatalog) {
        this.root = canonicalize(root).toString(); this.catalog = catalog
    }
    public static func accepts(method: String): Bool {
        return method == "team/describe" || method == "team/member/create" || method == "team/message/send" ||
            method == "team/message/broadcast" || method == "team/task/create" || method == "team/task/assign" ||
            method == "team/task/claim" || method == "team/task/complete" || method == "team/member/stop"
    }
    private func state(id: String): HostTeamState {
        if (closing) { throw Exception("team-runtime-closed") }
        if (let Some(found) <- teams.get(id)) { return found }
        // 目录只由 catalog 校验过的不透明会话 ID 派生，不能指定团队日志路径。
        let leaderPath = catalog.pathFor(id)
        var key = ""
        for (part in id.split("/")) { if (key.size > 0) { key += "_" }; key += part }
        for (b in key.toArray()) {
            if (!((b >= 97 && b <= 122) || (b >= 65 && b <= 90) || (b >= 48 && b <= 57) || b == 45 || b == 95)) {
                throw Exception("bad-team-session")
            }
        }
        let parent = "${root}/.sacode-teams"
        if (!exists(parent)) { Directory.create(parent) }
        if (canonicalize(parent).parent.toString() != root) { throw Exception("team-path-escape") }
        let dir = "${parent}/${key}"
        if (!exists(dir)) { Directory.create(dir) }
        if (canonicalize(dir).parent.toString() != canonicalize(parent).toString()) { throw Exception("team-path-escape") }
        let path = "${dir}/session.log"
        if (exists(path) && canonicalize(path).parent.toString() != canonicalize(dir).toString()) { throw Exception("team-path-escape") }
        let s = HostTeamState(id, path)
        try {
            let snapshot = JsonValue.fromStr(s.board.snapshot()).asObject()
            if (snapshot.get("members").getOrThrow().asArray().size() == 0) {
                let leaderLog = SessionLog(leaderPath)
                if (!leaderLog.load()) { throw Exception("team-leader-replay-rejected") }
                let directory = SessionWorkspace(leaderLog, fallback: root).effectiveDirectory()
                s.log.append("team-host/workspace", canonicalize(directory).toString())
                if (!s.log.durableCheckpointBatched(s.lease)) { throw Exception("team-checkpoint-failed") }
                s.board.join(id, "leader", "leader", id)
            }
            var directory = root
            for (ev in s.log.snapshotEvents()) { if (ev.eventType == "team-host/workspace") { directory = ev.data } }
            if (workspace.isNone()) { workspace = Some(TeamWorkspace(directory)); workspaceRoot = directory }
            if (workspaceRoot != directory) { throw Exception("team-workspace-mismatch") }
            teams[id] = s
            return s
        } catch (e: Exception) { s.board.close(); s.lease.release(); throw e }
    }
    private func member(s: HostTeamState, id: String): HostTeamMember {
        if (let Some(found) <- s.members.get(id)) { return found }
        let rows = JsonValue.fromStr(s.board.snapshot()).asObject().get("members").getOrThrow().asArray()
        for (i in 0..rows.size()) {
            let row = rows.get(i).getOrThrow().asObject()
            if (hostTeamText(row, "id") != id) { continue }
            if (hostTeamText(row, "role") == "leader") { throw Exception("team-leader-owned-by-main") }
            if (!row.get("active").getOrThrow().asBool().getValue()) { throw Exception("team-member-inactive") }
            let session = hostTeamText(row, "sessionId")
            let m = HostTeamMember(id, session, catalog.pathFor(session))
            if (!m.lease.takeoverIfStale()) { throw Exception("team-member-already-owned") }
            if (!m.log.load()) { m.lease.release(); throw Exception("team-member-replay-rejected") }
            s.members[id] = m; return m
        }
        throw Exception("team-unknown-member")
    }
    private func durable(m: HostTeamMember): Unit {
        if (!m.lease.protects(m.path) || !m.log.durableCheckpointBatched(m.lease)) {
            m.log.freezeAfterDurableFailure(); throw Exception("team-member-checkpoint-failed")
        }
    }
    private func ensureLease(m: HostTeamMember): Unit {
        if (m.lease.protects(m.path)) { return }
        if (!m.lease.takeoverIfStale()) { throw Exception("team-member-already-owned") }
        if (!m.log.load()) { throw Exception("team-member-replay-rejected") }
    }
    private func visible(m: HostTeamMember, text: String): Bool {
        for (ev in m.log.snapshotEvents()) { if (ev.eventType == "user/message" && ev.data == text) { return true } }
        return false
    }
    private func messageText(row: JsonObject): String {
        return "[团队消息 ${hostTeamText(row, "id")} 来自 ${hostTeamText(row, "sender")}]\n${hostTeamText(row, "text")}"
    }
    private func deliver(s: HostTeamState, m: HostTeamMember): Unit {
        ensureLease(m)
        let rows = JsonValue.fromStr(s.board.pending(m.sessionId)).asArray()
        for (i in 0..rows.size()) {
            let row = rows.get(i).getOrThrow().asObject()
            let text = messageText(row); let id = hostTeamText(row, "id")
            if (visible(m, text)) { durable(m); s.board.acknowledge(m.sessionId, id); continue }
            let inbox = AgentInbox(m.log)
            if (!inbox.pending(id)) { inbox.queue(id, text, id) }
            if (let Some(runner) <- m.runner) { if (runner.running(m.id)) { AgentInbox(m.log).steerFromQueue(id) } }
            durable(m)
        }
    }
    // 工作目录只是相对路径基准，并非沙箱。绝不让任意 shell 绕过隔离约束。
    private func guard(directory: String, name: String, args: String): Bool {
        if (name == "bash" || name == "pwsh" || name == "run_code" || name.startsWith("lsp_")) { return false }
        if (name != "read" && name != "write" && name != "edit" && name != "glob" && name != "grep") { return true }
        try {
            let obj = JsonValue.fromStr(args).asObject()
            if (let Some(value) <- obj.get("path")) {
                let path = value.asString().getValue()
                if (path.size == 0 || path.startsWith("/") || path.startsWith("\\") || path.contains(":")) { return false }
                for (part in path.split("/")) { if (part == "..") { return false } }
                for (part in path.split("\\")) { if (part == "..") { return false } }
                var probe = Path("${directory}/${path}")
                while (!exists(probe)) { probe = probe.parent }
                let resolved = canonicalize(probe).toString().toAsciiLower()
                let base = canonicalize(directory).toString().toAsciiLower()
                if (resolved != base && !resolved.startsWith(base + "/") && !resolved.startsWith(base + "\\")) { return false }
            }
            // glob/grep 的路径枚举由 ToolRuntime 根目录控制，不接受跨目录模式。
            if (let Some(value) <- obj.get("pattern")) {
                let pattern = value.asString().getValue()
                if (name == "glob" && (pattern.contains("..") || pattern.contains(":") || pattern.startsWith("/") || pattern.startsWith("\\"))) { return false }
            }
            return true
        } catch (_: Exception) { return false }
    }
    private func start(s: HostTeamState, m: HostTeamMember): Unit {
        if (m.stopped || m.fault.size > 0) { return }
        if (let Some(runner) <- m.runner) { if (runner.running(m.id)) { return } }
        ensureLease(m)
        let entry = workspace.getOrThrow().prepare(m.id)
        if (!entry.isolated && !workspace.getOrThrow().acquireWriter(m.id)) { return }
        m.writer = !entry.isolated
        try {
            let token = TurnToken(); let directory = entry.directory
            let approval: (ModelToolCall) -> Int64 = { call =>
                let aid = m.desk.askForCall(call.name, call.args)
                durable(m)
                emit(notifyFrame("approval/asked", "{\"teamSessionId\":\"${jsonEscapeText(s.leader)}\",\"memberId\":\"${m.id}\",\"sessionId\":\"${jsonEscapeText(m.sessionId)}\",\"approvalId\":${aid},\"tool\":\"${jsonEscapeText(call.name)}\",\"source\":\"team-member\"}"))
                let begin = MonoTime.now()
                while (!token.cancelled() && m.desk.stateOf(aid) == "pending" && (MonoTime.now() - begin).toMilliseconds() < 30000) {
                    sleep(25 * Duration.millisecond)
                }
                aid
            }
            let bound = tools(s.leader, m.sessionId)
            let runtime = ModelToolRuntime(m.log, false, files: true, workingDirectory: directory,
                desk: m.desk, approval: approval, guard: { name, args => guard(directory, name, args) }, team: Some(bound))
            if (!hasSystemMessage(m.log)) {
                m.log.append("system/message", SystemPromptBuilder(runtime.registry).build() +
                    "\n你是团队成员。任务必须调用 team_task_claim 认领，再调用 team_task_complete 提交结果；正文不构成完成证据。")
            }
            for (note in AgentInbox(m.log).claimStep()) { m.log.append("user/message", note.text) }
            while (AgentInbox(m.log).sizeOf("next-turn") > 0) {
                for (note in AgentInbox(m.log).claimTurn()) { m.log.append("user/message", note.text) }
            }
            durable(m)
            m.epoch += 1
            let attach = AttachmentStore("${root}/attachments", m.log, AttachmentLimits.localBackend())
            let config = HostTeamProvider(s, m, token, runtime, attach)
            let runner = TeamMemberRunner()
            let first = DeferredProvider({ => config.open() }, token)
            runner.start(m.id, m.log, m.lease, first, { _ => config.open() }, config.model,
                runtime, token: token, attach: Some(attach), supportsImages: config.images)
            m.runner = Some(runner)
        } catch (e: Exception) {
            if (m.writer) { workspace.getOrThrow().releaseWriter(m.id); m.writer = false }
            m.fault = e.message; throw e
        }
    }
    public func tools(teamSessionId: String, actorSessionId: String): TeamTools {
        return TeamTools(actorSessionId, { actor, name, args =>
            try { handle(teamSessionId, actor, name, args) }
            catch (e: Exception) {
                getStdErr().writeln("team-dispatch-failed:${name}:${e.message}")
                throw e
            }
        })
    }
    public func handle(teamSessionId: String, actorSessionId: String, toolName: String, args: String): String {
        return synchronized(mtx) {
            let s = state(teamSessionId)
            // TeamTools 本身不负责身份授权；所有入口仍由 Board 检查绑定身份。
            var known = false
            let rows = JsonValue.fromStr(s.board.snapshot()).asObject().get("members").getOrThrow().asArray()
            for (i in 0..rows.size()) {
                let row = rows.get(i).getOrThrow().asObject()
                if (hostTeamText(row, "sessionId") == actorSessionId && row.get("active").getOrThrow().asBool().getValue()) { known = true }
            }
            if (!known) { throw Exception("team-identity-unbound") }
            let obj = JsonValue.fromStr(args).asObject()
            if (toolName == "team_describe") { return panel(s) }
            if (toolName == "team_member_create") {
                if (actorSessionId != s.leader) { throw Exception("team-leader-required") }
                let role = hostTeamText(obj, "role")
                if (role == "leader") { throw Exception("team-single-leader") }
                let session = catalog.create(hostTeamText(obj, "name"))
                let id = "member-${s.log.eventCount()}"
                s.board.join(actorSessionId, id, role, session)
                let out = JsonObject(); out.put("memberId", JsonString(id)); out.put("sessionId", JsonString(session)); return out.toString()
            }
            if (toolName == "team_task_create") {
                let tasks = JsonValue.fromStr(s.board.snapshot()).asObject().get("tasks").getOrThrow().asArray()
                let id = "task-${tasks.size() + 1}"
                let values = obj.get("dependencies").getOrThrow().asArray(); let deps = ArrayList<String>()
                for (i in 0..values.size()) { deps.add(values.get(i).getOrThrow().asString().getValue()) }
                s.board.createTask(actorSessionId, id, hostTeamText(obj, "title"), deps.toArray())
                return hostTeamJson("taskId", id)
            }
            if (toolName == "team_task_claim") {
                return "{\"claimed\":${s.board.claim(actorSessionId, hostTeamText(obj, "taskId"))}}"
            }
            if (toolName == "team_task_complete") {
                s.board.complete(actorSessionId, hostTeamText(obj, "taskId"), hostTeamText(obj, "result")); return "{\"completed\":true}"
            }
            if (toolName == "team_task_assign") {
                let id = hostTeamText(obj, "taskId"); let target = hostTeamText(obj, "memberId")
                s.board.assign(actorSessionId, id, target)
                // 请求是持久团队消息，由与普通消息完全相同的 inbox 路径送到成员日志。
                let message = s.board.send(actorSessionId, target, "请执行团队任务 ${id}：${s.board.task(id)}")
                return hostTeamJson("messageId", message)
            }
            if (toolName == "team_message_send") {
                return hostTeamJson("messageId", s.board.send(actorSessionId, hostTeamText(obj, "target"), hostTeamText(obj, "text")))
            }
            if (toolName == "team_message_broadcast") {
                let ids = JsonArray()
                for (i in 0..rows.size()) {
                    let row = rows.get(i).getOrThrow().asObject()
                    if (hostTeamText(row, "sessionId") != actorSessionId && row.get("active").getOrThrow().asBool().getValue()) {
                        ids.add(JsonString(s.board.send(actorSessionId, hostTeamText(row, "id"), hostTeamText(obj, "text"))))
                    }
                }
                let out = JsonObject(); out.put("messageIds", ids); return out.toString()
            }
            if (toolName == "team_member_stop") {
                if (actorSessionId != s.leader) { throw Exception("team-leader-required") }
                let m = member(s, hostTeamText(obj, "memberId")); m.stopped = true
                if (let Some(runner) <- m.runner) { runner.cancel(m.id) }
                return "{\"stopping\":true}"
            }
            throw Exception("team-unknown-tool")
        }
    }
    // body 是 params 对象，而非完整 JSON-RPC 帧；拒绝 actor/路径等所有额外字段。
    public func request(method: String, body: String): String {
        if (!HostTeamRuntime.accepts(method)) { throw Exception("team-unknown-method") }
        let obj = JsonValue.fromStr(body).asObject(); let id = hostTeamText(obj, "teamSessionId")
        let args = JsonObject()
        for ((key, value) in obj.getFields()) { if (key != "teamSessionId") { args.put(key, value) } }
        var name = "team_"
        var first = true
        for (part in method.split("/")) {
            if (first) { first = false; continue }
            if (name != "team_") { name += "_" }; name += part
        }
        let result = tools(id, id).execute(name, args.toString())
        if (!result.allowed) { throw Exception("team-bad-args-or-dispatch:${result.why}") }
        return result.why
    }
    private func panel(s: HostTeamState): String {
        let obj = JsonValue.fromStr(s.board.snapshot()).asObject()
        let tasks = obj.get("tasks").getOrThrow().asArray()
        for (i in 0..tasks.size()) {
            let row = tasks.get(i).getOrThrow().asObject(); row.put("status", JsonString(hostTeamText(row, "phase")))
        }
        let rows = obj.get("members").getOrThrow().asArray()
        for (i in 0..rows.size()) {
            let row = rows.get(i).getOrThrow().asObject(); let id = hostTeamText(row, "id")
            var status = "idle"
            if (let Some(m) <- s.members.get(id)) {
                if (m.fault.size > 0) { status = "error"; row.put("error", JsonString(m.fault)) }
                else if (m.stopped) { status = "stopped" }
                else if (let Some(runner) <- m.runner) { if (runner.running(id)) { status = "running" } }
            }
            row.put("status", JsonString(status))
        }
        obj.put("teamSessionId", JsonString(s.leader)); return obj.toString()
    }
    public func describe(teamSessionId: String): String {
        return synchronized(mtx) { panel(state(teamSessionId)) }
    }
    // 必须由主循环计时调用，无论当前选中哪份会话；describe 不承担调度职责。
    public func poll(): Unit {
        synchronized(mtx) {
            if (closing) { return }
            for ((_, s) in teams) {
                let rows = JsonValue.fromStr(s.board.snapshot()).asObject().get("members").getOrThrow().asArray()
                for (i in 0..rows.size()) {
                    let row = rows.get(i).getOrThrow().asObject(); let id = hostTeamText(row, "id")
                    if (hostTeamText(row, "role") == "leader" || !row.get("active").getOrThrow().asBool().getValue()) { continue }
                    if (!s.members.contains(id) && JsonValue.fromStr(s.board.pending(hostTeamText(row, "sessionId"))).asArray().size() == 0) { continue }
                    let m = member(s, id)
                    try {
                        if (let Some(runner) <- m.runner) {
                            let result = runner.poll(id)
                            if (result.result.isSome()) {
                                // 已结算才归还共享写席位；正文绝不修改任务 phase。
                                if (!runner.close(timeoutMs: 0)) { continue }
                                let settled = result.result.getOrThrow()
                                m.runner = None
                                if (m.writer) { workspace.getOrThrow().releaseWriter(id); m.writer = false }
                                if (settled.interrupted && !settled.cancelled) { m.fault = settled.finishReason }
                            }
                        }
                        if (m.stopped || m.fault.size > 0) { continue }
                        deliver(s, m)
                        let inbox = AgentInbox(m.log)
                        if (inbox.sizeOf("next-turn") > 0 || inbox.sizeOf("next-step") > 0) { start(s, m) }
                        deliver(s, m)
                    } catch (e: Exception) { m.fault = e.message }
                }
            }
        }
    }
    public func answer(teamSessionId: String, memberId: String, approvalId: Int64, decision: String): String {
        return synchronized(mtx) {
            let m = member(state(teamSessionId), memberId)
            let accepted = m.desk.answer(approvalId, decision); durable(m)
            return "{\"accepted\":${accepted},\"state\":\"${m.desk.stateOf(approvalId)}\"}"
        }
    }
    // close 的等待不持服务锁：成员可能正在执行绑定团队工具，持锁 join 会造成死锁。
    public func shutdown(timeoutMs!: Int64 = 1000): Bool {
        let runners = ArrayList<TeamMemberRunner>()
        synchronized(mtx) {
            closing = true
            for ((_, s) in teams) { for ((_, m) in s.members) { if (let Some(runner) <- m.runner) { runners.add(runner) } } }
        }
        let begin = MonoTime.now(); var joined = true
        for (runner in runners) {
            let remaining = max(Int64(0), timeoutMs - (MonoTime.now() - begin).toMilliseconds())
            if (!runner.close(timeoutMs: remaining)) { joined = false }
        }
        if (!joined) { return false }
        synchronized(mtx) {
            for ((_, s) in teams) {
                for ((_, m) in s.members) {
                    if (m.writer) { workspace.getOrThrow().releaseWriter(m.id); m.writer = false }
                    if (m.lease.protects(m.path)) { durable(m); if (!m.lease.release()) { return false } }
                }
                s.board.close(); if (!s.lease.release()) { return false }
            }
        }
        return true
    }
}

// 不使用本地 fake Provider。每次真实步骤即时读取注册表/设置/凭据，密钥不进入日志。
private class HostTeamProvider {
    let state: HostTeamState
    let member: HostTeamMember
    let token: TurnToken
    let tools: ModelToolRuntime
    let attach: AttachmentStore
    let route: ?HostModelRoute
    let model: String
    let images: Bool
    init(state: HostTeamState, member: HostTeamMember, token: TurnToken, tools: ModelToolRuntime, attach: AttachmentStore) {
        this.state = state; this.member = member; this.token = token; this.tools = tools; this.attach = attach
        let custom = getVariable("SACODE_TEAM_CUSTOM_MODEL_ID") ?? ""
        if (custom.size > 0) {
            let selected = HostModelRoute(custom, "${member.sessionId}-${routingRequestId()}-${member.epoch}", member.sessionId)
            let plan = selected.select(preview: true)
            route = Some(selected); model = plan.modelId; images = plan.images
        } else {
            route = None
            let configured = ModelSettings.forUser().read()
            let registry = ProviderRegistry.forUser().describe()
            var selectedModel = configured.model; var selectedImages = false
            for (p in registry.providers) {
                if (p.id != registry.defaultProviderId || registry.defaultModel.size == 0) { continue }
                if (p.protocol != "openai-completions") { throw Exception("protocol-not-supported") }
                selectedModel = registry.defaultModel
                for (entry in p.models) { if (entry.id == selectedModel) { selectedImages = entry.image } }
            }
            model = if (selectedModel.size > 0) { selectedModel } else { getVariable("SACODE_PROVIDER_MODEL") ?? "gpt-3.5-turbo" }
            images = selectedImages
        }
    }
    func open(): Provider {
        if (let Some(selected) <- route) { return selected.open(member.log, token, attach, tools) }
        let configured = ModelSettings.forUser().read(); let registry = ProviderRegistry.forUser().describe()
        var url = configured.baseUrl; var reference = configured.credentialRef
        for (p in registry.providers) {
            if (p.id != registry.defaultProviderId || registry.defaultModel.size == 0) { continue }
            if (p.protocol != "openai-completions") { throw Exception("protocol-not-supported") }
            if (registry.defaultModel != model) { throw Exception("team-model-changed-restart-required") }
            url = p.baseUrl; reference = p.credentialRef
        }
        if (url.size == 0) { url = getVariable("SACODE_PROVIDER_BASE_URL") ?? "" }
        if (url.size == 0) { throw Exception("model-not-configured") }
        var key = ""
        if (reference.size > 0) {
            let credential = CredentialStore.forUser().resolve(reference)
            if (credential.isNone()) { throw Exception("model-credential-unavailable") }
            key = credential.getOrThrow().value
        } else { key = getVariable("SACODE_PROVIDER_KEY") ?? getVariable("STEPFUN_API_KEY") ?? "" }
        if (key.size == 0 && !url.startsWith("http://127.0.0.1:") && !url.startsWith("http://localhost:")) { throw Exception("model-credential-unavailable") }
        return RealSseProvider(url, key, modelRequestJson(model, member.log.snapshotEvents().toArray(),
            tools: tools.specs(), attachStore: attach, supportsImages: images), token)
    }
}
