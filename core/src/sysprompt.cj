package core

// 系统提示的组装：不硬编一条字符串，而是从 ToolRegistry 这份真源读出
// 工具名与描述——工具增减时系统提示自动跟着变，模型看到的工具集和
// 核心实际登记的始终一致。角色定义在最前，工具清单追加在后面。
public class SystemPromptBuilder {
    let registry: ToolRegistry

    public init(registry: ToolRegistry) {
        this.registry = registry
    }

    public func build(): String {
        var out = "you are dsh\n\n"
        for (name in registry.list()) {
            out += "${name}: ${registry.describe(name)}\n"
        }
        return out
    }
}
