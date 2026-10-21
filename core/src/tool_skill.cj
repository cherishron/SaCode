package core

import stdx.encoding.json.*

public func skillLoadToolSpec(): ToolSpec {
    return ToolSpec("skill_load", "按技能名加载技能正文；仅按需读取，不执行技能中的命令，也不授予额外权限。",
        ##"{"type":"object","additionalProperties":false,"required":["name"],"properties":{"name":{"type":"string","minLength":1}}}"##,
        false)
}

public class SkillLoadTool {
    let registry: SkillRegistry
    public init(registry: SkillRegistry) {
        this.registry = registry
    }

    public func execute(args: String): ApprovalOutcome {
        var name = ""
        try {
            let obj = JsonValue.fromStr(args).asObject()
            if (obj.size() != 1) {
                throw Exception("shape")
            }
            name = obj["name"].asString().getValue()
            if (name.trimAscii().size == 0) {
                throw Exception("name")
            }
        } catch (_: Exception) {
            return ApprovalOutcome(false, "skill-bad-args")
        }
        try {
            if (let Some(skill) <- registry.getSkill(name)) {
                if (!skill.summary.modelInvocable) {
                    return ApprovalOutcome(false, "skill-not-model-invocable")
                }
                return ApprovalOutcome(true, skill.content)
            }
            return ApprovalOutcome(false, "skill-not-found")
        } catch (_: Exception) {
            return ApprovalOutcome(false, "skill-load-failed")
        }
    }
}
