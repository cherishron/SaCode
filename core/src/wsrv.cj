package core
import std.collection.*

// Web 服务器路由注册表：log-only `webserver/route` 事件承载 `<method>::<path>::<kind>`；
// kind 走 exact/prefix 白名单，未知 kind 抛 `webserver-bad-kind`；空 method/path 各自抛；
// 重名 (method,path) 走 noop 不重复落事件。宿主仍是 stdio NDJSON，本切片只做注册表面。
//
// 本切片假设 method/path/kind 不含 `::`。
public class WebServerRegistry {
    let log: SessionLog
    let keys = ArrayList<String>()

    public init(log: SessionLog) {
        this.log = log
        for (event in log.snapshotEvents()) {
            if (event.eventType == "webserver/route") {
                let body = event.data
                let idx = lastIndexOf(body, "::")
                if (idx >= 0) {
                    keys.add(body[0..idx])
                }
            }
        }
    }

    public func route(method: String, path: String, kind: String): Unit {
        if (method.size == 0) {
            throw Exception("webserver-empty-method")
        }
        if (path.size == 0) {
            throw Exception("webserver-empty-path")
        }
        if (kind != "exact" && kind != "prefix") {
            throw Exception("webserver-bad-kind")
        }
        let key = "${method}::${path}"
        for (k in keys) {
            if (k == key) {
                return
            }
        }
        log.append("webserver/route", "${key}::${kind}")
        keys.add(key)
    }

    public func entries(): ArrayList<String> {
        let out = ArrayList<String>()
        for (event in log.snapshotEvents()) {
            if (event.eventType == "webserver/route") {
                out.add(event.data)
            }
        }
        return out
    }

    private static func lastIndexOf(s: String, sep: String): Int64 {
        var i: Int64 = Int64(s.size) - Int64(sep.size)
        while (i >= 0) {
            if (s[i..(i + sep.size)] == sep) {
                return i
            }
            i = i - 1
        }
        return Int64(-1)
    }
}
