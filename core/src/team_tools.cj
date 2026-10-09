package core

import stdx.encoding.json.*

// 声明面与输入守卫共用字段定义，身份永远来自入口绑定，不来自模型参数。
private class TeamToolDefinition {
    let name: String
    let description: String
    let fields: Array<String>

    init(name: String, description: String, fields: Array<String>) {
        this.name = name
        this.description = description
        this.fields = fields
    }

    func schema(): String {
        let properties = JsonObject()
        let required = JsonArray()
        for (field in fields) {
            let shape = JsonObject()
            if (field == "dependencies") {
                shape.put("type", JsonString("array"))
                let item = JsonObject()
                item.put("type", JsonString("string"))
                item.put("minLength", JsonInt(1))
                shape.put("items", item)
            } else {
                shape.put("type", JsonString("string"))
                shape.put("minLength", JsonInt(1))
            }
            properties.put(field, shape)
            required.add(JsonString(field))
        }
        let out = JsonObject()
        out.put("type", JsonString("object"))
        out.put("properties", properties)
        out.put("required", required)
        out.put("additionalProperties", JsonBool(false))
        return out.toString()
    }
}

private func teamToolDefinitions(): Array<TeamToolDefinition> {
    return [
        TeamToolDefinition("team_describe", "读取当前绑定会话的团队概况。", []),
        TeamToolDefinition("team_member_create", "为团队创建指定名称与角色的成员。", ["name", "role"]),
        TeamToolDefinition("team_message_send", "以绑定会话身份向指定成员发送消息。", ["target", "text"]),
        TeamToolDefinition("team_message_broadcast", "以绑定会话身份向团队广播消息。", ["text"]),
        TeamToolDefinition("team_task_create", "创建标题与前置依赖明确的团队任务。", ["title", "dependencies"]),
        TeamToolDefinition("team_task_assign", "将指定团队任务分配给指定成员。", ["taskId", "memberId"]),
        TeamToolDefinition("team_task_claim", "以绑定会话身份认领指定团队任务。", ["taskId"]),
        TeamToolDefinition("team_task_complete", "以绑定会话身份提交指定任务的完成结果。", ["taskId", "result"]),
        TeamToolDefinition("team_member_stop", "停止指定团队成员。", ["memberId"])
    ]
}

public func teamToolSpecs(): Array<ToolSpec> {
    return teamToolDefinitions().map<ToolSpec>({ definition =>
        ToolSpec(definition.name, definition.description, definition.schema(), definition.name != "team_describe")
    })
}

// 这里只提供守卫与转发原语，不创建团队后端、不负责授权或持久化。
// 入口须将经过认证的会话身份和真实派发器绑定进来；审批由上层工具管线处理。
public class TeamTools {
    private let boundSessionId: String
    private let dispatch: (String, String, String) -> String

    public init(boundSessionId: String, dispatch: (String, String, String) -> String) {
        this.boundSessionId = boundSessionId
        this.dispatch = dispatch
    }

    public func execute(name: String, args: String): ApprovalOutcome {
        if (boundSessionId.trimAscii().size == 0) { return denied("team-identity-unbound") }
        for (definition in teamToolDefinitions()) {
            if (definition.name != name) { continue }
            try {
                let object = JsonValue.fromStr(args).asObject()
                // 所有字段必填且禁止额外字段，describe 也必须恰好是空对象。
                if (object.size() != definition.fields.size) { return denied("team-bad-args") }
                for (field in definition.fields) {
                    let value = object.get(field).getOrThrow()
                    if (field == "dependencies") {
                        let dependencies = value.asArray()
                        for (i in 0..dependencies.size()) {
                            if (dependencies[i].asString().getValue().trimAscii().size == 0) {
                                return denied("team-bad-args")
                            }
                        }
                    } else if (value.asString().getValue().trimAscii().size == 0) {
                        return denied("team-bad-args")
                    }
                }
            } catch (_: Exception) { return denied("team-bad-args") }
            // 参数保留原始字节；只有校验全部成功之后才触及派发器。
            try {
                return ApprovalOutcome(true, dispatch(boundSessionId, name, args))
            } catch (_: Exception) { return denied("team-dispatch-failed") }
        }
        return denied("team-unknown-tool")
    }

    private func denied(reason: String): ApprovalOutcome {
        let error = JsonObject()
        error.put("error", JsonString(reason))
        return ApprovalOutcome(false, error.toString(), structured: true)
    }
}
