package core
import std.collection.*

// 会话引用：上游 §225 里 FileReference 候选 + SessionReferenceMention 的窄化
// 面。`add(kind, path, version)` 落 log-only `session/reference` 事件 `kind::path::version`；
// 空 kind 或空 path 拒；同一三元组重复登记走 dedupe（事件层 dedupe，只落一条）。
//
// 本切片假设 kind/path/version 都不含 `::`；未来放开需换长度前缀编码。
public class SessionReferenceStore {
    let log: SessionLog
    let seen = HashSet<String>()

    public init(log: SessionLog) {
        this.log = log
        for (event in log.snapshotEvents()) {
            if (event.eventType == "session/reference") {
                seen.add(event.data)
            }
        }
    }

    public func add(kind: String, path: String, version: String): Unit {
        if (kind.size == 0) {
            throw Exception("xref-invalid-kind")
        }
        if (path.size == 0) {
            throw Exception("xref-not-found")
        }
        let key = "${kind}::${path}::${version}"
        if (seen.contains(key)) {
            return
        }
        seen.add(key)
        log.append("session/reference", key)
    }

    public func candidates(): ArrayList<String> {
        let out = ArrayList<String>()
        for (event in log.snapshotEvents()) {
            if (event.eventType == "session/reference") {
                out.add(event.data)
            }
        }
        return out
    }
}
