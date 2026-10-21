package core

import stdx.encoding.json.*

public func subagentDelegateToolSpec(): ToolSpec {
    return ToolSpec("subagent_delegate",
        "委派独立子任务给已配置的子代理角色。参数 roleId 为角色 id，task 为完整任务描述；需要一次性审批，子任务继承父轮取消与权限上界。返回子任务摘要而非父会话上下文。",
        ##"{"type":"object","additionalProperties":false,"required":["roleId","task"],"properties":{"roleId":{"type":"string","minLength":1},"task":{"type":"string","minLength":1}}}"##,
        true)
}

// 只接受可信入口装配的 Runner；模型不能指定工厂、目录、模型或权限。
// Runner 自行建立独立日志、权限交集及 parentToken.child()，本层不复制这些机制。
public class SubagentDelegateTool {
    let roles: SubagentRoleStore
    let runner: SubagentRunner
    let inheritedModel: String
    let sink: FrameSink

    public init(roles: SubagentRoleStore, runner: SubagentRunner, inheritedModel: String, sink: FrameSink) {
        this.roles = roles
        this.runner = runner
        this.inheritedModel = inheritedModel
        this.sink = sink
    }

    public func execute(args: String, parentToken: TurnToken): ApprovalOutcome {
        if (parentToken.cancelled()) {
            return ApprovalOutcome(false, "subagent-cancelled")
        }
        var roleId = ""
        var task = ""
        try {
            let object = JsonValue.fromStr(args).asObject()
            if (object.size() != 2) {
                throw Exception("shape")
            }
            roleId = object["roleId"].asString().getValue()
            task = object["task"].asString().getValue()
            if (!subagentRoleIdValid(roleId) || task.trimAscii().size == 0 || task.size > 131072) {
                throw Exception("value")
            }
        } catch (_: Exception) {
            return ApprovalOutcome(false, "subagent-bad-args")
        }
        try {
            for (role in roles.load()) {
                if (role.id != roleId) {
                    continue
                }
                if (parentToken.cancelled()) {
                    return ApprovalOutcome(false, "subagent-cancelled")
                }
                let result = runner.run(role, task, inheritedModel, parentToken, sink)
                let out = JsonObject()
                out.put("roleId", JsonString(roleId))
                out.put("summary", JsonString(result.turn.text))
                out.put("cancelled", JsonBool(result.turn.cancelled))
                out.put("timedOut", JsonBool(result.timedOut))
                out.put("interrupted", JsonBool(result.turn.interrupted))
                out.put("finishReason", JsonString(result.turn.finishReason))
                out.put("chargedTokens", JsonInt(result.chargedTokens))
                out.put("pendingToolCalls", JsonInt(result.turn.pendingToolCalls))
                return ApprovalOutcome(
                    !result.turn.cancelled && !result.timedOut && !result.turn.interrupted &&
                        result.turn.pendingToolCalls == 0, out.toString())
            }
            return ApprovalOutcome(false, "subagent-role-not-found")
        } catch (_: Exception) {
            // 不把工厂异常里的凭据、内部路径或提供方原文带回主模型。
            return ApprovalOutcome(false, if (parentToken.cancelled()) {
                "subagent-cancelled"
            } else {
                "subagent-delegate-failed"
            })
        }
    }
}
