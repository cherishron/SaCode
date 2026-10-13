package core
import std.fs.*
import std.unittest.*
import stdx.encoding.json.*

func acpLiveProgram(): String {
    return "const fs=require('node:fs'),p=require('node:path');let prompt;const send=o=>console.log(JSON.stringify(o)),reply=(id,result)=>send({jsonrpc:'2.0',id,result});require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const q=JSON.parse(line);if(q.method==='initialize')reply(q.id,{protocolVersion:1,agentCapabilities:{}});else if(q.method==='session/new')reply(q.id,{sessionId:'fixture'});else if(q.method==='session/prompt'){prompt=q.id;send({jsonrpc:'2.0',method:'session/update',params:{sessionId:'fixture',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'awaiting permission'}}}});send({jsonrpc:'2.0',id:20,method:'session/request_permission',params:{sessionId:'fixture',toolCall:{toolCallId:'write-1',title:'write artifact'},options:[{optionId:'always',name:'always',kind:'allow_always'},{optionId:'once',name:'once',kind:'allow_once'},{optionId:'deny',name:'deny',kind:'reject_once'}]}});}else if(!q.method&&q.id===20){if(q.result?.outcome?.optionId==='once'){fs.writeFileSync(p.join(process.cwd(),'artifact.txt'),'approved');reply(prompt,{stopReason:'end_turn'});}else reply(prompt,{stopReason:'refusal'});}else if(q.method==='session/cancel')reply(prompt,{stopReason:'cancelled'});});"
}

func acpLivePending(task: AcpLiveTask): JsonObject {
    for (_ in 0..1000) {
        let view = JsonValue.fromStr(task.poll()).asObject()
        if (view.get("permissions").getOrThrow().asArray().size() > 0) { return view }
        sleep(2 * Duration.millisecond)
    }
    throw Exception("fixture-permission-not-received")
}

@Test
func acpLiveTaskRequiresActualApprovalBeforeProviderWrites() {
    let f = AcpTaskFixture("end_turn", program: acpLiveProgram())
    try {
        let desk = ApprovalDesk(f.log)
        let task = AcpLiveTask(f.service, desk, f.lease, f.snapshot.id, f.snapshot.revision, "fixture task", timeoutMs: 5000)
        let view = acpLivePending(task)
        let ticket = view.get("permissions").getOrThrow().asArray().get(0).getOrThrow().asObject()
        let id = ticket.get("approvalId").getOrThrow().asInt().getValue()
        @Expect(ticket.get("allowOnceOption").getOrThrow().asString().getValue(), "once")
        @Expect(ticket.get("denyOnceOption").getOrThrow().asString().getValue(), "deny")
        @Expect(view.get("workerFinished").getOrThrow().asBool().getValue(), false)
        @Expect(view.get("updates").getOrThrow().asArray().size(), 1)
        @Expect(exists(Path(f.root).join("artifact.txt")), false)
        @Expect(desk.stateOf(id), "pending")
        @Expect(task.answer(id, "allowed-once", "always").state, "not-sent")
        @Expect(exists(Path(f.root).join("artifact.txt")), false)
        @Expect(task.answer(id, "allowed-once", "once").state, "sent")
        @Expect(task.wait(timeoutMs: 6000).phase, "completed")
        @Expect(String.fromUtf8(File.readFrom(Path(f.root).join("artifact.txt"))), "approved")
        @Expect(task.answer(id, "allowed-once", "once").state, "not-sent")
        for (event in f.log.snapshotEvents()) {
            @Expect(event.eventType == "tool/result" || event.eventType == "goal/claim", false)
        }
    } finally { f.close() }
}

@Test
func acpLiveTaskDenialReturnsToOriginalProviderWithoutWriting() {
    let f = AcpTaskFixture("end_turn", program: acpLiveProgram())
    try {
        let task = AcpLiveTask(f.service, ApprovalDesk(f.log), f.lease, f.snapshot.id, f.snapshot.revision, "fixture task", timeoutMs: 5000)
        let ticket = acpLivePending(task).get("permissions").getOrThrow().asArray().get(0).getOrThrow().asObject()
        let id = ticket.get("approvalId").getOrThrow().asInt().getValue()
        @Expect(task.answer(id + 999, "allowed-once", "once").reason, "unknown-task-approval")
        @Expect(task.answer(id, "denied", "deny").state, "sent")
        @Expect(task.wait(timeoutMs: 6000).phase, "incomplete")
        @Expect(exists(Path(f.root).join("artifact.txt")), false)
    } finally { f.close() }
}

@Test
func acpLiveTaskPlanAtStartDoesNotSendOpaqueTask() {
    let f = AcpTaskFixture("end_turn")
    try {
        ModeController(f.log).setDurable("plan", f.lease)
        let task = AcpLiveTask(f.service, ApprovalDesk(f.log), f.lease, f.snapshot.id, f.snapshot.revision, "fixture task", timeoutMs: 5000)
        task.wait(timeoutMs: 6000)
        let view = JsonValue.fromStr(task.poll()).asObject()
        @Expect(view.get("workerError").getOrThrow().asString().getValue().contains("acp-task-mode"), true)
        @Expect(exists(Path(f.root).join("prompt-count")), false)
    } finally { f.close() }
}

@Test
func acpLiveLegacyApprovalBridgeCannotBypassPlanMode() {
    let f = AcpTaskFixture("end_turn")
    try {
        let desk = ApprovalDesk(f.log)
        let bridge = AcpApprovalBridge(desk, f.service, "s1")
        let id = bridge.askPermission(f.snapshot.id, AcpPermissionProposal("acp/permission", "write", "fixture proposal"))
        ModeController(f.log).setDurable("plan", f.lease)
        @Expect(bridge.answerPermission(id, "allowed-once"), false)
        @Expect(desk.stateOf(id), "denied")
        @Expect(exists(Path(f.root).join("prompt-count")), false)
    } finally { f.close() }
}

@Test
func acpLiveTaskPlanModeRejectsGrantButCanSendDenial() {
    let f = AcpTaskFixture("end_turn", program: acpLiveProgram())
    try {
        let task = AcpLiveTask(f.service, ApprovalDesk(f.log), f.lease, f.snapshot.id, f.snapshot.revision, "fixture task", timeoutMs: 5000)
        let ticket = acpLivePending(task).get("permissions").getOrThrow().asArray().get(0).getOrThrow().asObject()
        let id = ticket.get("approvalId").getOrThrow().asInt().getValue()
        ModeController(f.log).setDurable("plan", f.lease)
        @Expect(task.answer(id, "allowed-once", "once").reason, "permission-policy-denied")
        @Expect(exists(Path(f.root).join("artifact.txt")), false)
        @Expect(task.answer(id, "denied", "deny").state, "sent")
        @Expect(task.wait(timeoutMs: 6000).phase, "incomplete")
    } finally { f.close() }
}

@Test
func acpLiveTaskCancellationMakesLatePermissionApprovalFailClosed() {
    let f = AcpTaskFixture("end_turn", program: acpLiveProgram())
    try {
        let task = AcpLiveTask(f.service, ApprovalDesk(f.log), f.lease, f.snapshot.id, f.snapshot.revision, "fixture task", timeoutMs: 5000)
        let view = acpLivePending(task)
        let ticket = view.get("permissions").getOrThrow().asArray().get(0).getOrThrow().asObject()
        let id = ticket.get("approvalId").getOrThrow().asInt().getValue()
        task.cancel(f.service.describe(f.snapshot.id).revision)
        @Expect(task.wait(timeoutMs: 6000).phase, "cancelled")
        @Expect(task.answer(id, "allowed-once", "once").state, "not-sent")
        @Expect(exists(Path(f.root).join("artifact.txt")), false)
    } finally { f.close() }
}
