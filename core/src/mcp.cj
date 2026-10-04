package core
import std.collection.*

// MCP 服务器注册表：log-only `mcp/server` 事件承载 `register::<name>::<transport>`
// 与 `deregister::<name>`；`list()` 返回当前 active 名称；`isRegistered(name)` 查
// 单条。重名 register 走 noop（已在则不重复落事件）。
//
// 本切片假设 name/transport 不含 `::`；未来放开需换长度前缀编码。

class McpEntry {
    let name: String
    var active: Bool
    init(name: String, active: Bool) {
        this.name = name
        this.active = active
    }
}

public class McpRegistry {
    let log: SessionLog
    let entries = ArrayList<McpEntry>()

    public init(log: SessionLog) {
        this.log = log
        for (event in log.snapshotEvents()) {
            if (event.eventType != "mcp/server") {
                continue
            }
            let body = event.data
            if (body.startsWith("register::")) {
                let rest = body[10..body.size]
                let idx = rest.indexOf("::") ?? Int64(-1)
                let name = if (idx < 0) { rest } else { rest[0..idx] }
                ensureActive(name)
            } else if (body.startsWith("deregister::")) {
                let name = body[12..body.size]
                let i = indexOf(name)
                if (i >= 0) {
                    entries[i].active = false
                }
            }
        }
    }

    public func register(name: String, transport: String): Unit {
        if (name.size == 0) {
            throw Exception("mcp-empty-name")
        }
        if (transport.size == 0) {
            throw Exception("mcp-empty-transport")
        }
        let i = indexOf(name)
        if (i >= 0 && entries[i].active) {
            return
        }
        log.append("mcp/server", "register::${name}::${transport}")
        ensureActive(name)
    }

    public func deregister(name: String): Unit {
        let i = indexOf(name)
        if (i < 0 || !entries[i].active) {
            return
        }
        log.append("mcp/server", "deregister::${name}")
        entries[i].active = false
    }

    public func isRegistered(name: String): Bool {
        let i = indexOf(name)
        if (i < 0) {
            return false
        }
        return entries[i].active
    }

    public func list(): ArrayList<String> {
        let out = ArrayList<String>()
        for (e in entries) {
            if (e.active) {
                out.add(e.name)
            }
        }
        return out
    }

    private func indexOf(name: String): Int64 {
        var i: Int64 = 0
        while (i < Int64(entries.size)) {
            if (entries[i].name == name) {
                return i
            }
            i = i + 1
        }
        return Int64(-1)
    }

    private func ensureActive(name: String): Unit {
        let i = indexOf(name)
        if (i >= 0) {
            entries[i].active = true
        } else {
            entries.add(McpEntry(name, true))
        }
    }
}
