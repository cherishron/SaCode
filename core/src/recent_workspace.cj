package core
import std.collection.ArrayList
import std.fs.*
import std.sort.sort

// 最近项目仅回放已落盘的用户目录选择，不把进程 cwd 或应用数据目录登记成项目。
// 目录仍以会话事件为真源；清单ID绑定会话及事件seq，客户端不能自报任意路径。
public class RecentWorkspaceEntry {
    public let id: String
    public let directory: String
    public let available: Bool
    public let modified: Int64
    public init(id: String, directory: String, available: Bool, modified: Int64) {
        this.id = id; this.directory = directory; this.available = available; this.modified = modified
    }
}

public func recentWorkspaces(catalog: SessionCatalog): Array<RecentWorkspaceEntry> {
    let entries = catalog.list()
    let candidates = ArrayList<RecentWorkspaceEntry>()
    for (entry in entries) {
        if (entry.status != "ready") { continue }
        try {
            let path = catalog.pathFor(entry.id)
            let log = SessionLog(path)
            if (!log.load() || log.isTruncatedTail()) { continue }
            let modified = FileInfo(path).lastModificationTime.toUnixTimeStamp().toMilliseconds()
            let events = log.snapshotEvents()
            // 一份日志里后选择的目录先展示；不同会话按最后持久修改时间排序。
            var index = events.size
            while (index > 0) {
                index -= 1
                let event = events[index]
                if (event.eventType != "workspace/directory" || event.data.size == 0) { continue }
                var available = false
                try { available = FileInfo(event.data).isDirectory() } catch (_: Exception) {}
                candidates.add(RecentWorkspaceEntry("${entry.id}@${event.seq}", event.data, available, modified))
            }
        } catch (_: Exception) { /* 坏会话不提供可选目录，保留原日志。 */ }
    }
    sort(candidates, lessThan: { left, right => left.modified > right.modified }, stable: true)
    let result = ArrayList<RecentWorkspaceEntry>()
    for (candidate in candidates) {
        var seen = false
        for (existing in result) {
            if (recentDirectoryKey(existing.directory) == recentDirectoryKey(candidate.directory)) { seen = true }
        }
        if (!seen) { result.add(candidate) }
        if (result.size >= 12) { break }
    }
    return result.toArray()
}

// Windows路径分隔与大小写不能让同一个项目显示两次；失效路径也不依赖canonicalize成功。
@When[os == "Windows"]
func recentDirectoryKey(path: String): String { return path.replace("\\", "/").toAsciiLower() }
@When[os != "Windows"]
func recentDirectoryKey(path: String): String { return path }
