package core

import std.collection.ArrayList
import stdx.encoding.json.*

// 模型工具的参数与返回值契约；部署必须显式选择并行策略。
public class TodoTool {
    let log: SessionLog
    let allowParallel: Bool
    public init(log: SessionLog, allowParallel: Bool) {
        this.log = log
        this.allowParallel = allowParallel
    }

    public func spec(): ToolSpec {
        let policy = if (allowParallel) { "并行工作时可将多个任务标记为 in_progress。" } else { "未完成时只保留一个 in_progress 任务。" }
        return ToolSpec("todo_write", "记录多步骤任务的完整清单，开始前规划，完成后及时标记 completed；单步任务可跳过。${policy}",
            "{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"todos\"],\"properties\":{\"todos\":{\"type\":\"array\",\"items\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"content\",\"status\"],\"properties\":{\"content\":{\"type\":\"string\"},\"status\":{\"type\":\"string\",\"enum\":[\"pending\",\"in_progress\",\"completed\"]}}}}}}", false)
    }

    public func execute(args: String, agentOwned: Bool): String {
        let items = ArrayList<TodoItem>()
        try {
            let input = JsonValue.fromStr(args).asObject()
            if (input.size() != 1) { throw Exception("bad-todo-args") }
            let values = input.get("todos").getOrThrow().asArray()
            var index = Int64(0)
            while (let Some(value) <- values.get(index)) {
                let item = value.asObject()
                if (item.size() != 2) { throw Exception("bad-todo-args") }
                items.add(TodoItem(item.get("content").getOrThrow().asString().getValue(),
                    item.get("status").getOrThrow().asString().getValue()))
                index += 1
            }
        } catch (_: Exception) { throw Exception("bad-todo-args") }
        // 只有核心 agent 执行上下文拥有清单；桌面手工工具调用不享有此身份。
        if (!agentOwned) { throw Exception("todo-requires-agent-session") }
        let store = TodoStore(log, allowParallelInProgress: allowParallel)
        store.write(items.toArray())
        let canonical = store.list()
        var pending = Int64(0)
        var active = Int64(0)
        var completed = Int64(0)
        for (item in canonical) {
            if (item.status == "pending") { pending += 1 }
            else if (item.status == "in_progress") { active += 1 }
            else { completed += 1 }
        }
        return "{\"todos\":${todoListJson(canonical)},\"counts\":{\"pending\":${pending},\"inProgress\":${active},\"completed\":${completed}}}"
    }
}
