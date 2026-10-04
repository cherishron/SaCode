package core
import std.collection.*

// 会话查询：对同一份 SessionLog 提供按事件类型、按关键词两种过滤器；空结果
// 安全返 ArrayList 空数组，不抛。纯进程内，只读投影。
public class SessionQuery {
    let log: SessionLog

    public init(log: SessionLog) {
        this.log = log
    }

    public func byType(t: String): ArrayList<String> {
        let out = ArrayList<String>()
        for (event in log.snapshotEvents()) {
            if (event.eventType == t) {
                out.add(event.data)
            }
        }
        return out
    }

    public func byKeyword(k: String): ArrayList<String> {
        let out = ArrayList<String>()
        for (event in log.snapshotEvents()) {
            let pos = event.data.indexOf(k) ?? Int64(-1)
            if (pos >= 0) {
                out.add(event.data)
            }
        }
        return out
    }

    public func countAll(): Int64 {
        var n: Int64 = 0
        for (_ in log.snapshotEvents()) {
            n = n + 1
        }
        return n
    }
}
