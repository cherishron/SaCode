package core
import std.collection.*

// 冻结 tools.ts 的公开命名契约；调用时必须另存 rawName，不能逆解析此名字。
// 纯函数只做命名，不代表服务器、工具Schema或连接已经准入。
public func mcpPublicToolName(serverName: String, rawName: String): String {
    let joined = "mcp__${serverName}__${rawName}"
    let input = joined.toArray()
    let output = ArrayList<Byte>()
    var i: Int64 = 0
    var changed = false
    while (i < Int64(input.size)) {
        let b = Int64(input[i])
        if ((b >= 65 && b <= 90) || (b >= 97 && b <= 122) ||
            (b >= 48 && b <= 57) || b == 45 || b == 95) {
            output.add(input[i])
            i += 1
        } else {
            output.add(95)
            changed = true
            // 上游正则没有u标志：BMP之外的码点按两个UTF-16单元替换。
            if (b >= 240) {
                output.add(95)
                i += 4
            } else if (b >= 224) {
                i += 3
            } else if (b >= 192) {
                i += 2
            } else {
                i += 1
            }
        }
    }
    let normalized = String.fromUtf8(output.toArray())
    if (!changed && normalized.size <= 64) { return normalized }
    let identity = ArrayList<Byte>()
    for (b in serverName.toArray()) { identity.add(b) }
    identity.add(0)
    for (b in rawName.toArray()) { identity.add(b) }
    let hash = sha256Hex(identity.toArray())
    let prefixSize = if (normalized.size > 51) { 51 } else { normalized.size }
    return "${normalized[0..prefixSize]}_${hash[0..12]}"
}

// 历史注册标记，保留旧日志兼容；不等同冻结上游的真实MCP连接插件。
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
