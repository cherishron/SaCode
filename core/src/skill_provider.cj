package core

import std.collection.ArrayList

// 技能 provider 接口（第 2 段）。
// 对齐基线 RUNTIME_SKILL_PROVIDER：{ name, list, get }。
// list() 返回摘要列表（不含 content）；get(name) 返回完整定义（含 content）。
// 两者 fail-soft：缺失/坏文件返回空列表 / None，不抛（一个坏技能不让整个注册表崩，§3.2）。
public interface SkillProvider {
    func name(): String
    func list(): ArrayList<SkillSummary>
    func get(name: String): ?SkillDefinition
}

// 内置 provider：随包硬编码技能。首版为空（占位，证明聚合链路通）。
// 后续可挂 appResources/skills/ 下的内置技能。
public class BundledSkillProvider <: SkillProvider {
    public func name(): String { return "bundled" }
    public func list(): ArrayList<SkillSummary> {
        return ArrayList<SkillSummary>()
    }
    public func get(name: String): ?SkillDefinition {
        return None
    }
}
