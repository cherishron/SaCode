package core
import std.unittest.*
import stdx.encoding.json.*
import std.fs.*

func acpRuntimeCreateArgs(): String {
    return "{\"sessionId\":\"s1\",\"taskId\":\"task\",\"requestId\":\"request\",\"peerId\":\"opencode\",\"taskText\":\"fixture task\"}"
}
func acpRuntimePollArgs(): String { return "{\"sessionId\":\"s1\",\"delegationId\":\"delegation-1\"}" }
func acpRuntimePending(api: AcpRuntimeApi): Int64 {
    for (_ in 0..1000) {
        let view = JsonValue.fromStr(api.dispatch("acp/delegation/poll", acpRuntimePollArgs())).asObject()
        let pending = view.get("permissions").getOrThrow().asArray()
        if (pending.size() > 0) { return pending.get(0).getOrThrow().asObject().get("approvalId").getOrThrow().asInt().getValue() }
        sleep(2 * Duration.millisecond)
    }
    throw Exception("fixture-no-runtime-permission")
}

@Test
func acpRuntimeApiSharesCreatePollAndExactPermissionAnswer() {
    let f = AcpTaskFixture("end_turn", program: acpLiveProgram())
    try {
        let api = AcpRuntimeApi(f.service, ApprovalDesk(f.log), f.lease, f.root)
        api.dispatch("acp/delegation/create", acpRuntimeCreateArgs())
        let id = acpRuntimePending(api)
        let answer = api.dispatch("acp/delegation/answer", "{\"sessionId\":\"s1\",\"delegationId\":\"delegation-1\",\"approvalId\":${id},\"decision\":\"allowed-once\",\"optionId\":\"once\"}")
        @Expect(JsonValue.fromStr(answer).asObject().get("state").getOrThrow().asString().getValue(), "sent")
        for (_ in 0..1000) {
            if (f.service.describe("delegation-1").phase == "completed") { break }
            sleep(2 * Duration.millisecond)
        }
        @Expect(f.service.describe("delegation-1").phase, "completed")
        let duplicate = JsonValue.fromStr(api.dispatch("acp/delegation/create", acpRuntimeCreateArgs())).asObject()
        @Expect(duplicate.get("delegation").getOrThrow().asObject().get("phase").getOrThrow().asString().getValue(), "completed")
        @Expect(String.fromUtf8(File.readFrom(Path(f.root).join("artifact.txt"))), "approved")
        let revision = f.service.describe("delegation-1").revision
        let closed = JsonValue.fromStr(api.dispatch("acp/delegation/close", "{\"sessionId\":\"s1\",\"delegationId\":\"delegation-1\",\"revision\":${revision}}")).asObject()
        @Expect(closed.get("delegation").getOrThrow().asObject().get("phase").getOrThrow().asString().getValue(), "completed")
        @Expect(closed.get("serverAlive").getOrThrow().asBool().getValue(), false)
        @Expect(closed.get("serverExitObserved").getOrThrow().asBool().getValue(), true)
        @Expect(f.process.exitObserved(), true)
    } finally { f.close() }
}

@Test
func acpRuntimeApiRejectsForeignSessionAndExecutableArguments() {
    let f = AcpTaskFixture("end_turn", program: acpLiveProgram())
    try {
        let api = AcpRuntimeApi(f.service, ApprovalDesk(f.log), f.lease, f.root)
        @Expect(api.belongsTo("s1", f.log.path, f.root), true)
        @Expect(api.belongsTo("other", f.log.path, f.root), false)
        @Expect(api.belongsTo("s1", "other.log", f.root), false)
        @Expect(api.belongsTo("s1", f.log.path, "other-workspace"), false)
        @ExpectThrows[Exception](api.dispatch("acp/delegation/poll", "{\"sessionId\":\"other\",\"delegationId\":\"delegation-1\"}"))
        @ExpectThrows[Exception](api.dispatch("acp/delegation/create", "{\"sessionId\":\"s1\",\"taskId\":\"task\",\"requestId\":\"request\",\"peerId\":\"opencode\",\"taskText\":\"fixture task\",\"executable\":\"cmd\"}"))
        @ExpectThrows[Exception](api.dispatch("acp/delegation/poll", acpRuntimePollArgs()))
        @Expect(exists(Path(f.root).join("artifact.txt")), false)
    } finally { f.close() }
}

@Test
func acpRuntimeApiRejectsDifferentProviderBeforeCreatingTask() {
    let f = AcpTaskFixture("end_turn", program: acpLiveProgram())
    try {
        let api = AcpRuntimeApi(f.service, ApprovalDesk(f.log), f.lease, f.root)
        @ExpectThrows[Exception](api.dispatch("acp/delegation/create", "{\"sessionId\":\"s1\",\"taskId\":\"task\",\"requestId\":\"request\",\"peerId\":\"codebuddy\",\"taskText\":\"fixture task\"}"))
        @Expect(api.quiescent(), true)
        @Expect(exists(Path(f.root).join("artifact.txt")), false)
        @Expect(exists(Path(f.root).join("prompt-count")), false)
        @Expect(api.shutdown(), true)
    } finally { f.close() }
}

@Test
func acpRuntimeCodeBuddyFixtureUsesOriginalPermissionAndSettlesWithoutRealModel() {
    let f = AcpTaskFixture("end_turn", program: acpLiveProgram(), peerId: "codebuddy")
    try {
        let api = AcpRuntimeApi(f.service, ApprovalDesk(f.log), f.lease, f.root, peerId: "codebuddy")
        api.dispatch("acp/delegation/create", "{\"sessionId\":\"s1\",\"taskId\":\"task\",\"requestId\":\"request\",\"peerId\":\"codebuddy\",\"taskText\":\"fixture task\"}")
        let id = acpRuntimePending(api)
        @Expect(exists(Path(f.root).join("artifact.txt")), false)
        api.dispatch("acp/delegation/answer", "{\"sessionId\":\"s1\",\"delegationId\":\"delegation-1\",\"approvalId\":${id},\"decision\":\"allowed-once\",\"optionId\":\"once\"}")
        for (_ in 0..1000) {
            if (f.service.describe("delegation-1").phase == "completed") { break }
            sleep(2 * Duration.millisecond)
        }
        @Expect(f.service.describe("delegation-1").peerId, "codebuddy")
        @Expect(f.service.describe("delegation-1").phase, "completed")
        @Expect(String.fromUtf8(File.readFrom(Path(f.root).join("artifact.txt"))), "approved")
        @Expect(api.shutdown(), true)
    } finally { f.close() }
}

@Test
func acpRuntimeCodeBuddyFixtureCancelRejectsLateGrantAndObservesExit() {
    let f = AcpTaskFixture("end_turn", program: acpLiveProgram(), peerId: "codebuddy")
    try {
        let api = AcpRuntimeApi(f.service, ApprovalDesk(f.log), f.lease, f.root, peerId: "codebuddy")
        api.dispatch("acp/delegation/create", "{\"sessionId\":\"s1\",\"taskId\":\"task\",\"requestId\":\"request\",\"peerId\":\"codebuddy\",\"taskText\":\"fixture task\"}")
        let id = acpRuntimePending(api)
        let revision = f.service.describe("delegation-1").revision
        api.dispatch("acp/delegation/cancel", "{\"sessionId\":\"s1\",\"delegationId\":\"delegation-1\",\"revision\":${revision}}")
        for (_ in 0..1000) {
            if (f.service.describe("delegation-1").phase == "cancelled") { break }
            sleep(2 * Duration.millisecond)
        }
        @Expect(f.service.describe("delegation-1").phase, "cancelled")
        let answer = JsonValue.fromStr(api.dispatch("acp/delegation/answer", "{\"sessionId\":\"s1\",\"delegationId\":\"delegation-1\",\"approvalId\":${id},\"decision\":\"allowed-once\",\"optionId\":\"once\"}")).asObject()
        @Expect(answer.get("state").getOrThrow().asString().getValue(), "not-sent")
        @Expect(exists(Path(f.root).join("artifact.txt")), false)
        @Expect(api.shutdown(), true)
        @Expect(f.process.exitObserved(), true)
    } finally { f.close() }
}

@Test
func acpRuntimeApiCancellationUsesExpectedRevision() {
    let f = AcpTaskFixture("end_turn", program: acpLiveProgram())
    try {
        let api = AcpRuntimeApi(f.service, ApprovalDesk(f.log), f.lease, f.root)
        api.dispatch("acp/delegation/create", acpRuntimeCreateArgs())
        acpRuntimePending(api)
        @ExpectThrows[Exception](api.dispatch("acp/delegation/cancel", "{\"sessionId\":\"s1\",\"delegationId\":\"delegation-1\",\"revision\":1}"))
        let revision = f.service.describe("delegation-1").revision
        api.dispatch("acp/delegation/cancel", "{\"sessionId\":\"s1\",\"delegationId\":\"delegation-1\",\"revision\":${revision}}")
        for (_ in 0..1000) {
            if (f.service.describe("delegation-1").phase == "cancelled") { break }
            sleep(2 * Duration.millisecond)
        }
        @Expect(f.service.describe("delegation-1").phase, "cancelled")
        @Expect(exists(Path(f.root).join("artifact.txt")), false)
    } finally { f.close() }
}

@Test
func acpRuntimeShutdownWaitsForWorkerAndProcessWithoutGrantingPendingPermission() {
    let f = AcpTaskFixture("end_turn", program: acpLiveProgram())
    try {
        let api = AcpRuntimeApi(f.service, ApprovalDesk(f.log), f.lease, f.root)
        @Expect(api.quiescent(), true)
        api.dispatch("acp/delegation/create", acpRuntimeCreateArgs())
        acpRuntimePending(api)
        @Expect(api.quiescent(), false)
        @Expect(api.shutdown(), true)
        @Expect(api.quiescent(), true)
        @Expect(f.process.exitObserved(), true)
        @Expect(exists(Path(f.root).join("artifact.txt")), false)
        @ExpectThrows[Exception](api.dispatch("acp/delegation/create", acpRuntimeCreateArgs()))
        @Expect(api.shutdown(), true)
    } finally { f.close() }
}

@Test
func acpRuntimeShutdownClosesEmptyAdmissionWithoutCreatingASecondPrompt() {
    let f = AcpTaskFixture("end_turn")
    try {
        let api = AcpRuntimeApi(f.service, ApprovalDesk(f.log), f.lease, f.root)
        @Expect(api.shutdown(), true)
        @ExpectThrows[Exception](api.dispatch("acp/delegation/create", acpRuntimeCreateArgs()))
        @Expect(exists(Path(f.root).join("prompt-count")), false)
    } finally { f.close() }
}
