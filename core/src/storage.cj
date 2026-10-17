package core
import std.collection.*

// 存储 hub：`domain/changed` 是 log-only 事件（不进 `isSurfaceEvent`），
// 承载 `open::<name>::<version>` / `close::<name>` / `put::<name>::<key>::<value>`
// 三种变更。open 严格序列：已在内存开启集里 → already-open；日志里已存在
// 同名 domain 且版本不同 → version-mismatch；两者都 throw 不落事件（回滚 =
// 什么都没发生）。
//
// 本切片假设 name/key/value 不含 `::`（现有 domain 命名符合），未来要放开需
// 换长度前缀编码。
public class StorageHub {
    let log: SessionLog
    let opened = ArrayList<String>()

    public init(log: SessionLog) {
        this.log = log
    }

    public func open(name: String, version: Int64): Unit {
        if (name.size == 0) {
            throw Exception("storage-invalid-name")
        }
        for (n in opened) {
            if (n == name) {
                throw Exception("storage-already-open")
            }
        }
        let want = "${version}"
        var persisted = ""
        for (event in log.snapshotEvents()) {
            if (event.eventType != "domain/changed") {
                continue
            }
            let body = event.data
            if (!body.startsWith("open::")) {
                continue
            }
            let rest = body[6..body.size]
            let (n, v) = splitOnce(rest, "::")
            if (n == name) {
                persisted = v
            }
        }
        if (persisted.size > 0 && persisted != want) {
            throw Exception("storage-version-mismatch")
        }
        opened.add(name)
        log.append("domain/changed", "open::${name}::${want}")
    }

    public func close(name: String): Unit {
        for (i in 0..opened.size) {
            if (opened[i] == name) {
                opened.remove(i..(i + 1))
                log.append("domain/changed", "close::${name}")
                return
            }
        }
    }

    public func put(name: String, key: String, value: String): Unit {
        requireOpen(name)
        log.append("domain/changed", "put::${name}::${key}::${value}")
    }

    // 回放用：日志里已有事件，不再 append。
    public func putFrom(name: String, key: String, value: String): Unit {
        requireOpen(name)
    }

    public func get(name: String, key: String): String {
        var current = ""
        for (event in log.snapshotEvents()) {
            if (event.eventType != "domain/changed") {
                continue
            }
            let body = event.data
            if (!body.startsWith("put::")) {
                continue
            }
            let rest = body[5..body.size]
            let (n, tail) = splitOnce(rest, "::")
            if (n != name) {
                continue
            }
            let (k, v) = splitOnce(tail, "::")
            if (k == key) {
                current = v
            }
        }
        return current
    }

    private func requireOpen(name: String): Unit {
        for (n in opened) {
            if (n == name) {
                return
            }
        }
        throw Exception("storage-domain-not-open")
    }

    private static func splitOnce(rest: String, sep: String): (String, String) {
        let idx = rest.indexOf(sep) ?? Int64(-1)
        if (idx < 0) {
            return (rest, "")
        }
        return (rest[0..idx], rest[(idx + sep.size)..rest.size])
    }
}
