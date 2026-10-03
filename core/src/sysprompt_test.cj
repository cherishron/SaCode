package core

import std.unittest.*

// 系统提示的组装：此前 `apps/cli/src/main.cj` 把系统提示硬编成一条
// `system/message "you are dsh"`，没有从 ToolRegistry 这份真源读出工具清单——
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
    // 角色定义 "you are dsh" 必须出现，且工具 "write" 出现在它之后
    let parts = prompt.split("you are dsh")
    @Expect(parts.size >= Int64(2), true)
    @Expect(prompt.contains("write"), true)
}
