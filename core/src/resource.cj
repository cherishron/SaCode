package core
import std.collection.*

// 客户端资源：log-only `resource/register` 事件承载 `<uri>::<mime>`；
// `lookup(uri)` 取 mime（未登记返空串），`list()` 枚举所有已登记 uri；
// 空 uri/mime 各自抛。
//
// 本切片假设 uri/mime 不含 `::`；未来放开需换长度前缀编码。

class ResEntry {
    let uri: String
    let mime: String
    init(uri: String, mime: String) {
        this.uri = uri
        this.mime = mime
    }
}

public class ResourceRegistry {
    let log: SessionLog
    let entries = ArrayList<ResEntry>()

    public init(log: SessionLog) {
        this.log = log
        for (event in log.snapshotEvents()) {
            if (event.eventType != "resource/register") {
                continue
            }
            let body = event.data
            let idx = body.indexOf("::") ?? Int64(-1)
            if (idx < 0) {
                continue
            }
            let uri = body[0..idx]
            let mime = body[(idx + 2)..body.size]
            if (indexOf(uri) < 0) {
                entries.add(ResEntry(uri, mime))
            }
        }
    }

    public func register(uri: String, mime: String): Unit {
        if (uri.size == 0) {
            throw Exception("resource-empty-uri")
        }
        if (mime.size == 0) {
            throw Exception("resource-empty-mime")
        }
        if (indexOf(uri) >= 0) {
            return
        }
        log.append("resource/register", "${uri}::${mime}")
        entries.add(ResEntry(uri, mime))
    }

    public func lookup(uri: String): String {
        let i = indexOf(uri)
        if (i < 0) {
            return ""
        }
        return entries[i].mime
    }

    public func list(): ArrayList<String> {
        let out = ArrayList<String>()
        for (e in entries) {
            out.add(e.uri)
        }
        return out
    }

    private func indexOf(uri: String): Int64 {
        var i: Int64 = 0
        while (i < Int64(entries.size)) {
            if (entries[i].uri == uri) {
                return i
            }
            i = i + 1
        }
        return Int64(-1)
    }
}
