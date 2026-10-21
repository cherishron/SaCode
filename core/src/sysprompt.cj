package core

// 系统提示的组装：不硬编一条字符串，而是从 ToolRegistry 这份真源读出
// 工具名与描述——工具增减时系统提示自动跟着变，模型看到的工具集和
// 核心实际登记的始终一致。角色定义在最前，工具清单追加在后面。
public class SystemPromptBuilder {
    let registry: ToolRegistry
    let skillRegistry: ?SkillRegistry

    public init(registry: ToolRegistry, skillRegistry!: ?SkillRegistry = None) {
        this.registry = registry
        this.skillRegistry = skillRegistry
    }

    public func build(goal!: ?GoalSnapshot = None, rounds!: Int64 = 0, elapsed!: Int64 = 0): String {
        var out = "you are SaCode\n\n"
        for (name in registry.list()) {
            out += "${name}: ${registry.describe(name)}\n"
        }
        // goal/change 是 log-only（不进模型可见历史），目标正文只能靠提示构造注入。
        // 不带目标 / 墓碑（phase=none）时原样返回，保持与旧 build() 逐字一致（向后兼容）。
        if (let Some(g) <- goal) {
            if (g.phase != "none") {
                out += "\n## 当前目标\n目标：${g.objective}\n状态：${g.phase}\n已执行轮次：${rounds}\n累计执行时长：${elapsed}秒\n"
                // 只有 active 才催「继续推进到完成 / 完成要有证据」；暂停或受阻不该反过来催模型冲。
                if (g.phase == "active") {
                    out += "请持续推进直到达成该目标；只有当有实际证据（测试通过、产物生成、真实副作用）表明目标达成时才可提出完成，无充分证据不得声称完成。\n"
                }
            }
        }
        if (let Some(skills) <- skillRegistry) {
            // enabled 字段待 D2 落地后过滤；当前注入所有技能的摘要，不加载正文。
            let summaries = skills.listSummaries()
            if (summaries.size > 0) {
                out += "\n## 可用技能\n"
                for (summary in summaries) {
                    let name = summary.name.replace("\r", " ").replace("\n", " ")
                    let description = summary.description.replace("\r", " ").replace("\n", " ")
                    let whenToUse = summary.whenToUse.replace("\r", " ").replace("\n", " ")
                    out += "${name}: ${description} (${whenToUse})\n"
                }
            }
        }
        return out
    }
}
