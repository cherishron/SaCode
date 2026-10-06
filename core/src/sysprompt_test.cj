package core

import std.unittest.*

// 系统提示的组装：此前 `apps/cli/src/main.cj` 把系统提示硬编成一条
// `system/message "you are SaCode"`，没有从 ToolRegistry 这份真源读出工具清单——
// 工具增减时系统提示不会跟着变，模型看到的工具集和核心实际登记的不一致。
// 这几条用例把「组装」钉死：SystemPromptBuilder 从注册表读工具名与描述，
// 增减工具时提示自动跟着变。

@Test
func systemPromptListsRegisteredTools() {
    let reg = ToolRegistry()
    reg.register(ToolSpec("write", "写文件", "path content", true))
    reg.register(ToolSpec("read", "读文件", "path", false))
    let prompt = SystemPromptBuilder(reg).build()
    @Expect(prompt.contains("write"), true)
    @Expect(prompt.contains("写文件"), true)
    @Expect(prompt.contains("read"), true)
    @Expect(prompt.contains("读文件"), true)
}

// 增减工具时提示跟着变：不是硬编一份清单，而是每次 build 都从注册表实时读
@Test
func systemPromptReflectsRegistryChanges() {
    let reg = ToolRegistry()
    let prompt1 = SystemPromptBuilder(reg).build()
    @Expect(prompt1.contains("write"), false)
    reg.register(ToolSpec("write", "写文件", "path content", true))
    let prompt2 = SystemPromptBuilder(reg).build()
    @Expect(prompt2.contains("write"), true)
    @Expect(prompt2.contains("写文件"), true)
}

// 角色定义始终在最前：工具清单是追加在角色定义之后的，不是平铺成一段
@Test
func systemPromptStartsWithRoleThenTools() {
    let reg = ToolRegistry()
    reg.register(ToolSpec("write", "写文件", "path content", true))
    let prompt = SystemPromptBuilder(reg).build()
    // 角色定义 "you are SaCode" 必须出现，且工具 "write" 出现在它之后
    let parts = prompt.split("you are SaCode")
    @Expect(parts.size >= Int64(2), true)
    @Expect(prompt.contains("write"), true)
}

// ===== 目标进系统提示（让模型知道在追求什么、完成要有证据）=====
// goal/change 是 log-only（不进模型可见历史），所以目标正文必须由提示构造注入，
// 否则模型永远看不到「当前目标」——「下一轮使用更新后的目标」无从谈起。

// active 目标：正文 + 状态 + 轮次/时长 + 「完成需实际证据」规则一起进提示。
@Test
func systemPromptInjectsActiveGoalAndEvidenceRule() {
    let reg = ToolRegistry()
    let g = GoalSnapshot("goal-1", Int64(1), "active", "把 49 个模块复刻到底", "")
    let prompt = SystemPromptBuilder(reg).build(goal: g, rounds: Int64(3), elapsed: Int64(42))
    @Expect(prompt.contains("you are SaCode"), true)
    @Expect(prompt.contains("当前目标"), true)
    @Expect(prompt.contains("把 49 个模块复刻到底"), true)
    @Expect(prompt.contains("实际证据"), true)
}

// 不带目标时输出必须与原来逐字一致：这是向后兼容的反证——老调用点 build() 行为不变。
@Test
func systemPromptOmitsGoalSectionWhenNone() {
    let reg = ToolRegistry()
    reg.register(ToolSpec("write", "写文件", "path content", true))
    let withNone = SystemPromptBuilder(reg).build(goal: None)
    let plain = SystemPromptBuilder(reg).build()
    @Expect(withNone.contains("当前目标"), false)
    @Expect(plain.contains("当前目标"), false)
    @Expect(withNone == plain, true)
}

// 编辑过的新目标下一轮进提示：正文是编辑后的、轮次/时长也反映出来。
@Test
func systemPromptReflectsEditedGoalEachRound() {
    let reg = ToolRegistry()
    let edited = GoalSnapshot("goal-1", Int64(2), "active", "改用第二种方案推进", "")
    let prompt = SystemPromptBuilder(reg).build(goal: edited, rounds: Int64(5), elapsed: Int64(7))
    @Expect(prompt.contains("改用第二种方案推进"), true)
    @Expect(prompt.contains("5"), true)
    @Expect(prompt.contains("7"), true)
}

// 暂停的目标：仍展示正文与状态，但不给模型「继续推进到完成 / 完成要证据」的指令——
// 暂停语义是不再自动开下一轮，不该反过来催模型冲。
@Test
func systemPromptPausedGoalDoesNotUrgeCompletion() {
    let reg = ToolRegistry()
    let paused = GoalSnapshot("goal-1", Int64(1), "paused", "暂停中的目标", "")
    let prompt = SystemPromptBuilder(reg).build(goal: paused, rounds: Int64(1), elapsed: Int64(1))
    @Expect(prompt.contains("暂停中的目标"), true)
    @Expect(prompt.contains("请持续推进"), false)
    @Expect(prompt.contains("实际证据"), false)
}

// phase=none（删除墓碑 / 从未建立）：不注入任何目标段。
@Test
func systemPromptTombstoneGoalWritesNothing() {
    let reg = ToolRegistry()
    let none = GoalSnapshot("goal-1", Int64(0), "none", "", "")
    let prompt = SystemPromptBuilder(reg).build(goal: none)
    @Expect(prompt.contains("当前目标"), false)
}
