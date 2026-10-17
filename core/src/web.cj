package core
import std.collection.*

// Web 客户端窄化：log-only `web/allow` / `web/deny` 事件承载 `<host>`；
// `web/fetch` 事件承载 `<url>::<method>`；host 提取用 `scheme://<host>/...`
// 简易规则（找不到 `://` 或无 path 段则整段作 host）。fetch 时 host 不在允许集
// 抛 `web-host-not-allowed`；deny 覆盖前态；未允许 host 的 fetch 不落事件。

class HostEntry {
    let host: String
    var allowed: Bool
    init(host: String, allowed: Bool) {
        this.host = host
        this.allowed = allowed
    }
}

public class WebClient {
    let log: SessionLog
    let hosts = ArrayList<HostEntry>()

    public init(log: SessionLog) {
        this.log = log
        for (event in log.snapshotEvents()) {
            let t = event.eventType
            if (t == "web/allow") {
                ensureHost(event.data, true)
            } else if (t == "web/deny") {
                ensureHost(event.data, false)
            }
        }
    }

    public func allow(host: String): Unit {
        if (host.size == 0) {
            throw Exception("web-empty-host")
        }
        let e = find(host)
        if (e >= 0 && hosts[e].allowed) {
            return
        }
        log.append("web/allow", host)
        ensureHost(host, true)
    }

    public func deny(host: String): Unit {
        if (host.size == 0) {
            throw Exception("web-empty-host")
        }
        let e = find(host)
        if (e >= 0 && !hosts[e].allowed) {
            return
        }
        log.append("web/deny", host)
        ensureHost(host, false)
    }

    public func fetch(url: String, method: String): Unit {
        if (url.size == 0) {
            throw Exception("web-empty-url")
        }
        if (method.size == 0) {
            throw Exception("web-empty-method")
        }
        let host = extractHost(url)
        let e = find(host)
        if (e < 0 || !hosts[e].allowed) {
            throw Exception("web-host-not-allowed")
        }
        log.append("web/fetch", "${url}::${method}")
    }

    public func fetchCount(): Int64 {
        var n: Int64 = 0
        for (event in log.snapshotEvents()) {
            if (event.eventType == "web/fetch") {
                n = n + 1
            }
        }
        return n
    }

    private static func extractHost(url: String): String {
        let sep = "://"
        let schemeEnd = url.indexOf(sep) ?? Int64(-1)
        let rest = if (schemeEnd < 0) { url } else { url[(schemeEnd + 3)..url.size] }
        let slash = rest.indexOf("/") ?? Int64(-1)
        if (slash < 0) {
            return rest
        }
        return rest[0..slash]
    }

    private func find(host: String): Int64 {
        var i: Int64 = 0
        while (i < Int64(hosts.size)) {
            if (hosts[i].host == host) {
                return i
            }
            i = i + 1
        }
        return Int64(-1)
    }

    private func ensureHost(host: String, allowed: Bool): Unit {
        let i = find(host)
        if (i >= 0) {
            hosts[i].allowed = allowed
        } else {
            hosts.add(HostEntry(host, allowed))
        }
    }
}
