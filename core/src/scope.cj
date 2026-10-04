package core
import std.collection.*

// 作用域栈：上游 scope 模块（M0 基座）的窄化实现。工具与运行时读取「最后
// 进入」的作用域作为当前权限上下文；`enter(name)` / `exit(name)` 严格 LIFO，
// 退出非栈顶 → 拒绝且不落事件。变更走 log-only 事件 `scope/enter` / `scope/exit`。
//
// 本切片假设 name 不含 `::`；未来放开需换长度前缀编码。
public class ScopeStack {
    let log: SessionLog
    let stack = ArrayList<String>()

    public init(log: SessionLog) {
        this.log = log
        // 从事件流回放：按顺序 enter/exit 恢复栈态。
        for (event in log.snapshotEvents()) {
            let t = event.eventType
            if (t == "scope/enter") {
                stack.add(event.data)
            } else if (t == "scope/exit") {
                if (stack.size > 0) {
                    stack.remove((stack.size - 1)..stack.size)
                }
            }
        }
    }

    public func enter(name: String): Unit {
        if (name.size == 0) {
            throw Exception("scope-empty-name")
        }
        stack.add(name)
        log.append("scope/enter", name)
    }

    public func exit(name: String): Unit {
        if (stack.size == 0) {
            throw Exception("scope-empty-stack")
        }
        let top = stack[stack.size - 1]
        if (top != name) {
            throw Exception("scope-non-lifo")
        }
        stack.remove((stack.size - 1)..stack.size)
        log.append("scope/exit", name)
    }

    public func current(): String {
        if (stack.size == 0) {
            return ""
        }
        return stack[stack.size - 1]
    }

    public func depth(): Int64 {
        return Int64(stack.size)
    }
}
