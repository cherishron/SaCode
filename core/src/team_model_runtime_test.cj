package core

import std.fs.*
import std.unittest.*

// 只替换入口派发接缝，注册、审批、guard 与审计全部使用真实核心管线。
private class TeamRuntimeDispatch {
    var count: Int64 = 0
    var session = ""
    var name = ""
    var args = ""
    func dispatch(session: String, name: String, args: String): String {
        count += 1
        this.session = session
        this.name = name
        this.args = args
        return "{\"team\":\"bound\"}"
    }
    func tools(): TeamTools {
        return TeamTools("bound-session", { s, n, a => dispatch(s, n, a) })
    }
}

private func teamRuntimeCall(name: String, args: String): ModelToolCall {
    let call = ModelToolCall(0)
    call.id = "team-runtime-call"
    call.name = name
    call.args = args
    return call
}

private func teamRuntimeAudit(log: SessionLog, kind: String): Int64 {
    var count: Int64 = 0
    for (event in log.snapshotEvents()) {
        if (event.eventType == kind) { count += 1 }
    }
    return count
}

@Test
func teamModelDescribeIsRegisteredAndAudited() {
    let log = SessionLog("team-model-describe-unused.log")
    let dispatch = TeamRuntimeDispatch()
    let runtime = ModelToolRuntime(log, false, team: Some(dispatch.tools()))
    var count: Int64 = 0
    for (spec in runtime.specs()) {
        if (spec.name.startsWith("team_")) { count += 1 }
    }
    @Expect(count, Int64(9))
    @Expect(runtime.registry.requiresApproval("team_describe"), false)
    let result = runtime.execute(teamRuntimeCall("team_describe", "{}"))
    @Expect(result.allowed, true)
    @Expect(result.why, "{\"team\":\"bound\"}")
    @Expect(dispatch.count, Int64(1))
    @Expect(dispatch.session, "bound-session")
    @Expect(dispatch.name, "team_describe")
    @Expect(dispatch.args, "{}")
    @Expect(teamRuntimeAudit(log, "tool/runtime/call"), Int64(1))
    @Expect(teamRuntimeAudit(log, "tool/runtime/result"), Int64(1))
}

@Test
func teamModelWithoutInjectionDoesNotExposeTeam() {
    let log = SessionLog("team-model-absent-unused.log")
    let runtime = ModelToolRuntime(log, false)
    for (spec in teamToolSpecs()) { @Expect(runtime.registry.has(spec.name), false) }
    @Expect(runtime.execute(teamRuntimeCall("team_describe", "{}")).allowed, false)
    let registry = ToolRegistry()
    registry.register(teamToolSpecs()[0])
    let manual = ToolRuntime(log, registry)
    @Expect(manual.execute("team_describe", "{}", "", true).why, "unknown-tool:team_describe")
}

@Test
func teamModelMessageWithoutApprovalDoesNotDispatch() {
    let log = SessionLog("team-model-denied-unused.log")
    let dispatch = TeamRuntimeDispatch()
    let runtime = ModelToolRuntime(log, false, team: Some(dispatch.tools()))
    let result = runtime.execute(teamRuntimeCall("team_message_send", "{\"target\":\"member\",\"text\":\"hello\"}"))
    @Expect(result.allowed, false)
    @Expect(result.why, "approval-not-granted:unknown")
    @Expect(dispatch.count, Int64(0))
    @Expect(teamRuntimeAudit(log, "tool/runtime/result"), Int64(1))
}

@Test
func teamModelGuardDenialDoesNotDispatch() {
    let log = SessionLog("team-model-guard-unused.log")
    let dispatch = TeamRuntimeDispatch()
    let desk = ApprovalDesk(log)
    let args = "{\"target\":\"member\",\"text\":\"hello\"}"
    let id = desk.askForCall("team_message_send", args)
    @Expect(desk.answer(id, "allowed-once"), true)
    let runtime = ModelToolRuntime(log, false, team: Some(dispatch.tools()), desk: desk,
        approval: { _ => id }, guard: { _, _ => false })
    let result = runtime.execute(teamRuntimeCall("team_message_send", args))
    @Expect(result.allowed, false)
    @Expect(result.why, "guard-denied")
    @Expect(dispatch.count, Int64(0))
    @Expect(teamRuntimeAudit(log, "tool/runtime/result"), Int64(1))
}

@Test
func teamModelExactApprovalDispatchesBoundIdentityOnce() {
    let log = SessionLog("team-model-approved-unused.log")
    let dispatch = TeamRuntimeDispatch()
    let desk = ApprovalDesk(log)
    let args = "{ \"target\":\"member\", \"text\":\"hello\" }"
    let id = desk.askForCall("team_message_send", args)
    @Expect(desk.answer(id, "allowed-once"), true)
    let runtime = ModelToolRuntime(log, false, team: Some(dispatch.tools()), desk: desk, approval: { _ => id })
    @Expect(runtime.execute(teamRuntimeCall("team_message_send", "{\"target\":\"other\",\"text\":\"hello\"}")).why, "approval-arguments-mismatch")
    @Expect(dispatch.count, Int64(0))
    @Expect(desk.stateOf(id), "allowed-once")
    @Expect(runtime.execute(teamRuntimeCall("team_message_send", args)).allowed, true)
    @Expect(dispatch.count, Int64(1))
    @Expect(dispatch.session, "bound-session")
    @Expect(dispatch.name, "team_message_send")
    @Expect(dispatch.args, args)
    @Expect(desk.stateOf(id), "used")
    @Expect(runtime.execute(teamRuntimeCall("team_message_send", args)).allowed, false)
    @Expect(dispatch.count, Int64(1))
    @Expect(teamRuntimeAudit(log, "tool/runtime/call"), Int64(3))
    @Expect(teamRuntimeAudit(log, "tool/runtime/result"), Int64(3))
}

@Test
func teamModelCancelledBeforeCallDoesNotDispatch() {
    let log = SessionLog("team-model-cancelled-unused.log")
    let dispatch = TeamRuntimeDispatch()
    let token = TurnToken()
    token.cancel()
    let runtime = ModelToolRuntime(log, false, team: Some(dispatch.tools()), lspToken: token)
    @Expect(runtime.execute(teamRuntimeCall("team_describe", "{}")).allowed, false)
    @Expect(dispatch.count, Int64(0))
}

@Test
func teamModelCancellationDuringApprovalDoesNotConsumeOrDispatch() {
    let log = SessionLog("team-model-approval-cancel-unused.log")
    let dispatch = TeamRuntimeDispatch()
    let token = TurnToken()
    let desk = ApprovalDesk(log)
    let args = "{\"target\":\"member\",\"text\":\"hello\"}"
    let id = desk.askForCall("team_message_send", args)
    @Expect(desk.answer(id, "allowed-once"), true)
    let runtime = ModelToolRuntime(log, false, team: Some(dispatch.tools()), desk: desk,
        lspToken: token, approval: { _ => token.cancel(); id })
    @Expect(runtime.execute(teamRuntimeCall("team_message_send", args)).allowed, false)
    @Expect(dispatch.count, Int64(0))
    @Expect(desk.stateOf(id), "allowed-once")
}

@Test
func teamManualRuntimeRegistersAllBoundExecutorsAndAudits() {
    let log = SessionLog("team-manual-unused.log")
    let dispatch = TeamRuntimeDispatch()
    let registry = ToolRegistry()
    for (spec in teamToolSpecs()) { registry.register(spec) }
    let runtime = ToolRuntime(log, registry, team: Some(dispatch.tools()))
    let names = ["team_describe", "team_member_create", "team_message_send", "team_message_broadcast",
        "team_task_create", "team_task_assign", "team_task_claim", "team_task_complete", "team_member_stop"]
    let args = ["{}", "{\"name\":\"member\",\"role\":\"worker\"}", "{\"target\":\"member\",\"text\":\"hello\"}",
        "{\"text\":\"hello\"}", "{\"title\":\"task\",\"dependencies\":[]}", "{\"taskId\":\"task\",\"memberId\":\"member\"}",
        "{\"taskId\":\"task\"}", "{\"taskId\":\"task\",\"result\":\"done\"}", "{\"memberId\":\"member\"}"]
    for (i in 0..names.size) {
        @Expect(runtime.execute(names[i], args[i], "allowed-once", true).allowed, true)
        @Expect(dispatch.name, names[i])
        @Expect(dispatch.args, args[i])
        @Expect(runtime.lastDetail.stage, "ran")
    }
    @Expect(dispatch.count, Int64(9))
    @Expect(teamRuntimeAudit(log, "tool/call"), Int64(9))
    @Expect(teamRuntimeAudit(log, "tool/result"), Int64(9))
}
