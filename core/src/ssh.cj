package core
import std.collection.*

// SSH 目标注册表：log-only `ssh/target` 事件承载 `connect::<host>` /
// `disconnect::<host>`；`status(host)` 返回 "connected" / "disconnected"，
// 未知 host 抛 `ssh-unknown-host`。空 host 各自抛。
//
// 本切片假设 host 不含 `::`；未来放开需换长度前缀编码。

class SshEntry {
    let host: String
    var statusValue: String
    init(host: String, statusValue: String) {
        this.host = host
        this.statusValue = statusValue
    }
}

public class SshRegistry {
    let log: SessionLog
    let entries = ArrayList<SshEntry>()

    public init(log: SessionLog) {
        this.log = log
        for (event in log.snapshotEvents()) {
            if (event.eventType != "ssh/target") {
                continue
            }
            let body = event.data
            if (body.startsWith("connect::")) {
                let host = body[9..body.size]
                ensureSet(host, "connected")
            } else if (body.startsWith("disconnect::")) {
                let host = body[12..body.size]
                let i = indexOf(host)
                if (i >= 0) {
                    entries[i].statusValue = "disconnected"
                }
            }
        }
    }

    public func connect(host: String): Unit {
        if (host.size == 0) {
            throw Exception("ssh-empty-host")
        }
        let i = indexOf(host)
        if (i >= 0 && entries[i].statusValue == "connected") {
            return
        }
        log.append("ssh/target", "connect::${host}")
        ensureSet(host, "connected")
    }

    public func disconnect(host: String): Unit {
        let i = indexOf(host)
        if (i < 0 || entries[i].statusValue == "disconnected") {
            return
        }
        log.append("ssh/target", "disconnect::${host}")
        entries[i].statusValue = "disconnected"
    }

    public func status(host: String): String {
        let i = indexOf(host)
        if (i < 0) {
            throw Exception("ssh-unknown-host")
        }
        return entries[i].statusValue
    }

    private func indexOf(host: String): Int64 {
        var i: Int64 = 0
        while (i < Int64(entries.size)) {
            if (entries[i].host == host) {
                return i
            }
            i = i + 1
        }
        return Int64(-1)
    }

    private func ensureSet(host: String, value: String): Unit {
        let i = indexOf(host)
        if (i >= 0) {
            entries[i].statusValue = value
        } else {
            entries.add(SshEntry(host, value))
        }
    }
}
