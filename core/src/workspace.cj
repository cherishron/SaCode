package core
import std.fs.*

// 会话绑定的项目目录由日志回放；它是相对文件路径的基准，不是权限沙箱。
public class SessionWorkspace {
    let log: SessionLog
    let fallback: String
    public init(log: SessionLog, fallback!: String = "") {
        this.log = log
        this.fallback = fallback
    }
    public func directory(): String {
        var value = ""
        for (event in log.snapshotEvents()) {
            if (event.eventType == "workspace/directory") { value = event.data }
        }
        return value
    }
    public func effectiveDirectory(): String {
        let value = directory()
        return if (value.size == 0) { fallback } else { value }
    }
    public func available(): Bool {
        try { return FileInfo(effectiveDirectory()).isDirectory() }
        catch (e: Exception) { return false }
    }
    public func setDirectory(path: String): Bool {
        if (path.size == 0) { throw Exception("bad-workspace-directory") }
        let resolved = canonicalize(path).toString()
        if (!FileInfo(resolved).isDirectory()) { throw Exception("bad-workspace-directory") }
        if (directory() == resolved) { return false }
        log.append("workspace/directory", resolved)
        return true
    }
}
