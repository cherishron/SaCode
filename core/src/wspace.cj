package core
import std.collection.*

// 工作区上游契约（M5/M6）：log-only `workspace/change` 事件承载
// `create::<id>::<path>` / `archive::<id>` / `pin::<id>::<sessionId>`；
// `list()` 只回未归档者；`pinned(id)` 取会话集合序列。
//
// 本切片假设 id/path/sessionId 不含 `::`。

class WsEntry {
    let id: String
    let path: String
    var archived: Bool
    let pinnedIds = ArrayList<String>()
    init(id: String, path: String, archived: Bool) {
        this.id = id
        this.path = path
        this.archived = archived
    }
}

public class WorkspaceRegistry {
    let log: SessionLog
    let entries = ArrayList<WsEntry>()

    public init(log: SessionLog) {
        this.log = log
        for (event in log.snapshotEvents()) {
            if (event.eventType != "workspace/change") {
                continue
            }
            let body = event.data
            if (body.startsWith("create::")) {
                let rest = body[8..body.size]
                let idx = rest.indexOf("::") ?? Int64(-1)
                let id = if (idx < 0) { rest } else { rest[0..idx] }
                let path = if (idx < 0) { "" } else { rest[(idx + 2)..rest.size] }
                if (indexOf(id) < 0) {
                    entries.add(WsEntry(id, path, false))
                }
            } else if (body.startsWith("archive::")) {
                let id = body[9..body.size]
                let i = indexOf(id)
                if (i >= 0) {
                    entries[i].archived = true
                }
            } else if (body.startsWith("pin::")) {
                let rest = body[5..body.size]
                let idx = rest.indexOf("::") ?? Int64(-1)
                if (idx < 0) {
                    continue
                }
                let id = rest[0..idx]
                let sid = rest[(idx + 2)..rest.size]
                let i = indexOf(id)
                if (i >= 0) {
                    entries[i].pinnedIds.add(sid)
                }
            }
        }
    }

    public func create(id: String, path: String): Unit {
        if (id.size == 0) {
            throw Exception("ws-empty-id")
        }
        if (path.size == 0) {
            throw Exception("ws-empty-path")
        }
        if (indexOf(id) >= 0) {
            throw Exception("ws-duplicate-id")
        }
        log.append("workspace/change", "create::${id}::${path}")
        entries.add(WsEntry(id, path, false))
    }

    public func archive(id: String): Unit {
        let i = indexOf(id)
        if (i < 0) {
            throw Exception("ws-unknown-id")
        }
        if (entries[i].archived) {
            return
        }
        log.append("workspace/change", "archive::${id}")
        entries[i].archived = true
    }

    public func pin(id: String, sessionId: String): Unit {
        let i = indexOf(id)
        if (i < 0) {
            throw Exception("ws-unknown-id")
        }
        if (sessionId.size == 0) {
            throw Exception("ws-empty-session")
        }
        log.append("workspace/change", "pin::${id}::${sessionId}")
        entries[i].pinnedIds.add(sessionId)
    }

    public func list(): ArrayList<String> {
        let out = ArrayList<String>()
        for (e in entries) {
            if (!e.archived) {
                out.add(e.id)
            }
        }
        return out
    }

    public func pinned(id: String): ArrayList<String> {
        let i = indexOf(id)
        if (i < 0) {
            throw Exception("ws-unknown-id")
        }
        return entries[i].pinnedIds
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
