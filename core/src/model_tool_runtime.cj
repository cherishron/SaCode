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
            registry.register(ToolSpec("read", "读取工作区文件；写入已有文件前必须先读取。",
                "{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"path\"],\"properties\":{\"path\":{\"type\":\"string\"}}}", false))
            registry.register(ToolSpec("write", "按原样写入文件正文；需要一次性审批，拒绝覆盖未读取或已被外部修改的文件。",
                "{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"path\",\"content\"],\"properties\":{\"path\":{\"type\":\"string\"},\"content\":{\"type\":\"string\"}}}", true))
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
