package core
import std.collection.*

// LSP 上游契约（M4）：`ctx.lsp` 语言服务协议窄化——本切片只做符号（symbol）
// 注册表：`define(symbolId, kind, location)` + `lookup(symbolId)` + `rename(...)`。
// 空 symbolId/kind/location 抛；重名走 noop（不覆盖原位置）。

class LspSymbol {
    let id: String
    let kind: String
    var location: String
    init(id: String, kind: String, location: String) {
        this.id = id
        this.kind = kind
        this.location = location
    }
}

public class LspSymbolRegistry {
    let symbols = ArrayList<LspSymbol>()

    public init() {}

    public func define(id: String, kind: String, location: String): Unit {
        if (id.size == 0) {
            throw Exception("lsp-empty-id")
        }
        if (kind.size == 0) {
            throw Exception("lsp-empty-kind")
        }
        if (location.size == 0) {
            throw Exception("lsp-empty-location")
        }
        if (indexOf(id) >= 0) {
            return
        }
        symbols.add(LspSymbol(id, kind, location))
    }

    public func lookup(id: String): String {
        let i = indexOf(id)
        if (i < 0) {
            return ""
        }
        return symbols[i].location
    }

    public func rename(id: String, newLocation: String): Unit {
        let i = indexOf(id)
        if (i < 0) {
            throw Exception("lsp-unknown-id")
        }
        if (newLocation.size == 0) {
            throw Exception("lsp-empty-location")
        }
        symbols[i].location = newLocation
    }

    public func count(): Int64 {
        return Int64(symbols.size)
    }

    private func indexOf(id: String): Int64 {
        var i: Int64 = 0
        while (i < Int64(symbols.size)) {
            if (symbols[i].id == id) {
                return i
            }
            i = i + 1
        }
        return Int64(-1)
    }
}
