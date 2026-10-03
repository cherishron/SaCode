package core

import std.fs.*
import std.collection.ArrayList

// 目录仅发现日志，摘要仍由 SessionLog 回放得出，不保存第二份会话索引。
// 保留根目录的旧会话，新增会话目录约定为 sessions/<目录>/session.log。
public class SessionCatalogEntry {
    public let id: String
    public let title: String
    public let durable: Int64
    public let status: String
    public init(id: String, title: String, durable: Int64, status: String) {
        this.id = id
        this.title = title
        this.durable = durable
        this.status = status
    }
}

public class SessionCatalog {
    let root: String
    public init(root: String) { this.root = root }

    private func entry(id: String, path: String): SessionCatalogEntry {
        let log = SessionLog(path)
        if (!log.load()) {
            return SessionCatalogEntry(id, "", 0, "replay-rejected")
        }
        var title = ""
        for (event in log.snapshotEvents()) {
            if (event.eventType == "user/message" && event.data.size > 0) {
                title = event.data
                break
            }
        }
        let status = if (log.isTruncatedTail()) { "truncated-tail" } else { "ready" }
        return SessionCatalogEntry(id, title, log.durableCount(), status)
    }

    public func list(): ArrayList<SessionCatalogEntry> {
        let out = ArrayList<SessionCatalogEntry>()
        let base = canonicalize(root).toString()
        let legacy = "${base}/session.log"
        if (exists(legacy) && FileInfo(legacy).isRegular()) {
            // 符号链接不能把会话目录扫描扩大到目录外。
            if (canonicalize(legacy).parent.toString() == base) {
                out.add(entry("current", legacy))
            }
        }
        let sessions = "${base}/sessions"
        if (!exists(sessions)) { return out }
        let folder = canonicalize(sessions)
        if (folder.parent.toString() != base || !FileInfo(sessions).isDirectory()) { return out }
        for (info in Directory.readFrom(sessions)) {
            if (!info.isDirectory()) { continue }
            let directory = canonicalize(info.path)
            if (directory.parent.toString() != folder.toString()) { continue }
            let path = "${directory.toString()}/session.log"
            if (!exists(path) || !FileInfo(path).isRegular()) { continue }
            if (canonicalize(path).parent.toString() != directory.toString()) { continue }
            out.add(entry("sessions/${info.name}", path))
        }
        return out
    }
}
