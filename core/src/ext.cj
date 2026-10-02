package core

import std.collection.ArrayList

// 扩展注册表：CLI 与桌面宿主共用同一实例，是「有哪些工具/谁在监听」的唯一真源。
// 审批口径 fail-closed：查不到的工具一律视为需要审批，绝不因注册缺失而放行。
public class ToolSpec {
    public let name: String
    public let description: String
    public let params: String
    public let needsApproval: Bool

    public init(name: String, description: String, params: String, needsApproval: Bool) {
        this.name = name
        this.description = description
        this.params = params
        this.needsApproval = needsApproval
    }
}

public class ToolRegistry {
    var specs = ArrayList<ToolSpec>()

    // 重名拒绝并保留先登记的描述，避免后到者静默覆盖已有工具语义。
    public func register(spec: ToolSpec): Bool {
        if (has(spec.name)) {
            return false
        }
        specs.add(spec)
        return true
    }

    public func has(name: String): Bool {
        for (s in specs) {
            if (s.name == name) {
                return true
            }
        }
        return false
    }

    public func count(): Int64 {
        return Int64(specs.size)
    }

    // 返回副本：调用方改动快照不得反向影响注册表。
    public func list(): ArrayList<String> {
        let out = ArrayList<String>()
        for (s in specs) {
            out.add(s.name)
        }
        return out
    }

    public func describe(name: String): String {
        for (s in specs) {
            if (s.name == name) {
                return s.description
            }
        }
        return ""
    }

    // 只走已证实的 ArrayList.add/size/for：不依赖不确定的删除重载。
    public func unregister(name: String): Bool {
        let keep = ArrayList<ToolSpec>()
        var found = false
        for (s in specs) {
            if (s.name == name && !found) {
                found = true
            } else {
                keep.add(s)
            }
        }
        if (found) {
            specs = keep
        }
        return found
    }

    public func paramsOf(name: String): String {
        for (s in specs) {
            if (s.name == name) {
                return s.params
            }
        }
        return ""
    }

    // fail-closed：未注册 == 需要审批
    public func requiresApproval(name: String): Bool {
        for (s in specs) {
            if (s.name == name) {
                return s.needsApproval
            }
        }
        return true
    }
}

class Listener {
    let handle: Int64
    let event: String

    init(handle: Int64, event: String) {
        this.handle = handle
        this.event = event
    }
}

// 监听登记表：卸载扩展后必须能证明残留为 0，所以句柄一次性使用。
public class ListenerRegistry {
    var items = ArrayList<Listener>()
    var nextHandle: Int64 = 1

    public func on(event: String): Int64 {
        let h = nextHandle
        nextHandle = nextHandle + 1
        items.add(Listener(h, event))
        return h
    }

    public func off(handle: Int64): Bool {
        let keep = ArrayList<Listener>()
        var found = false
        for (it in items) {
            if (it.handle == handle && !found) {
                found = true
            } else {
                keep.add(it)
            }
        }
        if (found) {
            items = keep
        }
        return found
    }

    public func count(): Int64 {
        return Int64(items.size)
    }

    public func countFor(event: String): Int64 {
        var n: Int64 = 0
        for (it in items) {
            if (it.event == event) {
                n += 1
            }
        }
        return n
    }
}
