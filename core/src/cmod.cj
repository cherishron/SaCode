package core
import std.collection.*

// 客户端模块：纯进程内 `ClientModuleRegistry`——按 (id, version) 注册、
// activate 加载、isLoaded 查状态；空 id/version、重名、未知 activate 都抛。

class CmEntry {
    let id: String
    let version: String
    var loaded: Bool
    init(id: String, version: String, loaded: Bool) {
        this.id = id
        this.version = version
        this.loaded = loaded
    }
}

public class ClientModuleRegistry {
    let entries = ArrayList<CmEntry>()

    public init() {}

    public func register(id: String, version: String): Unit {
        if (id.size == 0) {
            throw Exception("cmod-empty-id")
        }
        if (version.size == 0) {
            throw Exception("cmod-empty-version")
        }
        if (indexOf(id) >= 0) {
            throw Exception("cmod-duplicate-id")
        }
        entries.add(CmEntry(id, version, false))
    }

    public func activate(id: String): Unit {
        let i = indexOf(id)
        if (i < 0) {
            throw Exception("cmod-unknown-id")
        }
        entries[i].loaded = true
    }

    public func isLoaded(id: String): Bool {
        let i = indexOf(id)
        if (i < 0) {
            return false
        }
        return entries[i].loaded
    }

    public func size(): Int64 {
        return Int64(entries.size)
    }

    private func indexOf(id: String): Int64 {
        var i: Int64 = 0
        while (i < Int64(entries.size)) {
            if (entries[i].id == id) {
                return i
            }
            i = i + 1
        }
        return Int64(-1)
    }
}
