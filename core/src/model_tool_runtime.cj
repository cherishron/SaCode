package core
import std.collection.ArrayList

// 模型与手工工具共用注册表、审批及文件观察管线；只有声明过的 schema 才进入请求。
public class ModelToolRuntime {
    public let registry: ToolRegistry
    let runtime: ToolRuntime
    let desk: ApprovalDesk
    let approval: (ModelToolCall) -> Int64
    let guard: (String, String) -> Bool
    public init(log: SessionLog, allowParallel: Bool,
        files!: Bool = false, workingDirectory!: String = "",
        desk!: ApprovalDesk = ApprovalDesk(log), approval!: (ModelToolCall) -> Int64 = { _ => Int64(0) },
        guard!: (String, String) -> Bool = { _, _ => true }) {
        this.registry = ToolRegistry()
        registry.register(TodoTool(log, allowParallel).spec())
        if (files) {
            registry.register(ToolSpec("read", "读取工作区文件；写入已有文件前必须先读取。大文件可按行分页：offset 为起始行（默认 0），limit 为行数上限（默认 2000，另有字节上界兜底），截断时结果尾部带 read-truncated 标记。",
                "{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"path\"],\"properties\":{\"path\":{\"type\":\"string\"},\"offset\":{\"type\":\"integer\",\"minimum\":0},\"limit\":{\"type\":\"integer\",\"minimum\":1}}}", false))
            registry.register(ToolSpec("write", "按原样写入文件正文；需要一次性审批，拒绝覆盖未读取或已被外部修改的文件。",
                "{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"path\",\"content\"],\"properties\":{\"path\":{\"type\":\"string\"},\"content\":{\"type\":\"string\"}}}", true))
            registry.register(ToolSpec("edit", "编辑文件：用 new_string 替换 old_string（需先读取）。",
                "{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"path\",\"old_string\",\"new_string\"],\"properties\":{\"path\":{\"type\":\"string\"},\"old_string\":{\"type\":\"string\"},\"new_string\":{\"type\":\"string\"}}}", true))
            registry.register(ToolSpec("glob", "查找匹配模式的文件（如 *.cj）。",
                "{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"pattern\"],\"properties\":{\"pattern\":{\"type\":\"string\"}}}", false))
            registry.register(ToolSpec("grep", "在文件内容中搜索子串。",
                "{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"pattern\"],\"properties\":{\"pattern\":{\"type\":\"string\"},\"path\":{\"type\":\"string\"}}}", false))
            registry.register(ToolSpec("bash", "执行 shell 命令（需审批）。",
                "{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"command\"],\"properties\":{\"command\":{\"type\":\"string\"},\"sandbox_mode\":{\"type\":\"string\"}}}", true))
            registry.register(ToolSpec("pwsh", "执行 PowerShell 命令（需审批）。",
                "{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"command\"],\"properties\":{\"command\":{\"type\":\"string\"},\"sandbox_mode\":{\"type\":\"string\"}}}", true))
            registry.register(ToolSpec("run_code", "执行 JavaScript 代码（PTC 运行时，需审批）。",
                "{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"code\"],\"properties\":{\"code\":{\"type\":\"string\"}}}", true))
            registry.register(ToolSpec("lsp", "从文件中提取符号（函数名、类名）。",
                "{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"path\"],\"properties\":{\"path\":{\"type\":\"string\"}}}", false))
        }
        this.runtime = ToolRuntime(log, registry, workingDirectory: workingDirectory,
            agentOwned: true, todoAllowParallel: allowParallel, modelProtocol: true)
        this.desk = desk
        this.approval = approval
        this.guard = guard
    }
    public func specs(): Array<ToolSpec> {
        let result = ArrayList<ToolSpec>()
        for (name in registry.list()) {
            result.add(ToolSpec(name, registry.describe(name), registry.paramsOf(name), registry.requiresApproval(name)))
        }
        return result.toArray()
    }
    public func execute(call: ModelToolCall): ApprovalOutcome {
        if (!registry.has(call.name)) { return ApprovalOutcome(false, "unregistered-tool:${call.name}") }
        let id = if (registry.requiresApproval(call.name)) { approval(call) } else { Int64(0) }
        return runtime.executeWithApproval(call.name, call.args, id, guard(call.name, call.args), desk)
    }
}
