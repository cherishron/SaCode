package core

import std.fs.*
import std.unittest.*
import stdx.encoding.json.*

class DelegateProbeProvider <: Provider {
    var index: Int64 = 0
    public func next(): ?Chunk {
        index += 1
        if (index == 1) { return Some(Chunk("text", "子任务摘要")) }
        if (index == 2) { return Some(Chunk("usage", "10")) }
        if (index == 3) { return Some(Chunk("finish", "", reason: "stop")) }
        return None
    }
}

@Test
func delegateToolRegistrationApprovalResultAndCancellation() {
    Directory.create("../target/tmp", recursive: true)
    let root = canonicalize(Directory.createTemp("../target/tmp")).toString()
    try {
        let roles = SubagentRoleStore(root, "user", "")
        let count = Array<Int64>(1, repeat: 0)
        let token = TurnToken()
        let runner = SubagentRunner(root, root, ["read", "glob", "grep"], "build", { _, _ => true },
            { _, _, _, _ => Int64(0) }, { _, _, _ => count[0] += 1; DelegateProbeProvider() },
            platformSandbox(root))
        let tool = SubagentDelegateTool(roles, runner, "probe-model", DeliveryQueue(1000))
        let log = SessionLog("${root}/parent.log")
        log.append("mode/mode", "build")
        let desk = ApprovalDesk(log)
        let args = ##"{"roleId":"explorer","task":"读取独立任务并给出摘要"}"##
        let denied = ModelToolRuntime(log, false, desk: desk, lspToken: token, subagent: Some(tool))
        @Expect(denied.registry.has("subagent_delegate"), true)
        @Expect(denied.registry.requiresApproval("subagent_delegate"), true)
        let schema = JsonValue.fromStr(denied.registry.paramsOf("subagent_delegate")).asObject()
        @Expect(schema["additionalProperties"].asBool().getValue(), false)
        @Expect(schema["required"].asArray().size(), Int64(2))
        @Expect(denied.execute(ModelToolCall("c1", "subagent_delegate", args)).allowed, false)
        @Expect(count[0], Int64(0))
        let runtime = ModelToolRuntime(log, false, desk: desk, lspToken: token, subagent: Some(tool),
            approval: { call =>
                let id = desk.askForCall(call.name, call.args)
                desk.answer(id, "allowed-once")
                return id
            })
        let missing = runtime.execute(ModelToolCall("c2", "subagent_delegate", ##"{"roleId":"absent-role","task":"任务"}"##))
        @Expect(missing.why, "subagent-role-not-found")
        @Expect(count[0], Int64(0))
        let result = runtime.execute(ModelToolCall("c3", "subagent_delegate", args))
        @Expect(result.allowed, true)
        @Expect(JsonValue.fromStr(result.why).asObject()["summary"].asString().getValue(), "子任务摘要")
        @Expect(count[0], Int64(1))
        token.cancel()
        @Expect(runtime.execute(ModelToolCall("c4", "subagent_delegate", args)).allowed, false)
        @Expect(count[0], Int64(1))
        @Expect(ModelToolRuntime(log, false).registry.has("subagent_delegate"), false)
    } finally { removeIfExists(root, recursive: true) }
}
