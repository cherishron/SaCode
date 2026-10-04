package core

import std.fs.*
import std.collection.ArrayList
import std.unicode.*

// 目录仅发现日志，摘要仍由 SessionLog 回放得出，不保存第二份会话索引。
// 保留根目录的旧会话，新增会话目录约定为 sessions/<目录>/session.log。
public class SessionCatalogEntry {
    public let id: String
    public let title: String
    public let durable: Int64
    public let status: String
    public let workspaceDirectory: String
    public init(id: String, title: String, durable: Int64, status: String, workspaceDirectory!: String = "") {
        this.id = id
        this.title = title
        this.durable = durable
        this.status = status
        this.workspaceDirectory = workspaceDirectory
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
            if (event.eventType == "session/title") { title = event.data; break }
            if (event.eventType == "user/message" && event.data.size > 0) {
                title = event.data
                break
            }
        }
        let status = if (log.isTruncatedTail()) { "truncated-tail" } else { "ready" }
        // 工作区归属与打开会话使用同一日志投影；不能因标题已找到而漏掉后续目录变更。
        return SessionCatalogEntry(id, title, log.durableCount(), status,
            workspaceDirectory: SessionWorkspace(log).directory())
    }

    public func indexPath(): String {
        return "${canonicalize(root).toString()}/session.log"
    }

    // 只接收目录清单中的不透明 ID，客户端不能借此传入任意文件路径。
    public func pathFor(id: String): String {
        let base = canonicalize(root).toString()
        if (id == "current" && !exists(indexPath())) { return indexPath() }
        for (item in list()) {
            if (item.id == id) {
                if (item.status == "replay-rejected") { throw Exception("replay-rejected") }
                return if (id == "current") { indexPath() } else { "${base}/${id}/session.log" }
            }
        }
        throw Exception("unknown-session")
    }

    public func selectedId(): String {
        if (exists(indexPath()) && canonicalize(indexPath()).parent.toString() != canonicalize(root).toString()) {
            throw Exception("invalid-session-directory")
        }
        let index = SessionLog(indexPath())
        if (!index.load()) { throw Exception("catalog-index-rejected") }
        var id = "current"
        for (event in index.snapshotEvents()) {
            if (event.eventType == "workspace/session-selected") { id = event.data }
        }
        return id
    }

    // 调用方持有根日志租约并完成 flush 后，选择才算持久化成功。
    public func select(index: SessionLog, id: String): Unit {
        pathFor(id)
        index.append("workspace/session-selected", id)
    }

    public func create(title: String): String {
        for (b in title.toArray()) {
            if (b < 32 || b == 127) { throw Exception("bad-session-title") }
        }
        let name = title.trimStart({r => r.isWhiteSpace()}).trimEnd({r => r.isWhiteSpace()})
        if (name.size == 0 || name.size > 512) { throw Exception("bad-session-title") }
        let base = canonicalize(root).toString()
        let sessions = "${base}/sessions"
        if (!exists(sessions)) { Directory.create(sessions) }
        if (canonicalize(sessions).parent.toString() != base || !FileInfo(sessions).isDirectory()) {
            throw Exception("invalid-session-directory")
        }
        let reservation = File.createTemp(Path(sessions))
        let tempPath = reservation.info.path
        let token = reservation.info.name
        reservation.close()
        removeIfExists(tempPath, recursive: false)
        var id = ""
        var directory = ""
        var attempt: Int64 = 0
        // 临时文件名可能重复使用；独占目录创建才是最终占位屏障。
        while (id.size == 0 && attempt < 1024) {
            let candidate = "sessions/session-${token}-${attempt}"
            let path = "${base}/${candidate}"
            attempt += 1
            if (exists(path)) { continue }
            try {
                Directory.create(path)
                id = candidate
                directory = path
            } catch (e: Exception) {
                if (!exists(path)) { throw e }
            }
        }
        if (id.size == 0) { throw Exception("session-directory-conflict") }
        let log = SessionLog("${directory}/session.log")
        log.append("session/title", name)
        if (!log.flush()) { throw Exception("session-create-flush-failed") }
        return id
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
