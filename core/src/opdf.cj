package core
import std.collection.*

// Office → PDF：log-only `office-to-pdf/task` 事件承载 `start::<id>::<src>` /
// `done::<id>::<pdfPath>` / `fail::<id>::<reason>`；状态 pending → done/failed
// 终态不可逆。空 id/path/reason 各自抛。
//
// 本切片假设 id/src/pdfPath/reason 不含 `::`。

class OpdfEntry {
    let id: String
    var statusValue: String
    init(id: String, statusValue: String) {
        this.id = id
        this.statusValue = statusValue
    }
}

public class OfficeToPdfLedger {
    let log: SessionLog
    let entries = ArrayList<OpdfEntry>()

    public init(log: SessionLog) {
        this.log = log
        for (event in log.snapshotEvents()) {
            if (event.eventType != "office-to-pdf/task") {
                continue
            }
            let body = event.data
            if (body.startsWith("start::")) {
                let rest = body[7..body.size]
                let idx = rest.indexOf("::") ?? Int64(-1)
                let id = if (idx < 0) { rest } else { rest[0..idx] }
                entries.add(OpdfEntry(id, "pending"))
            } else if (body.startsWith("done::")) {
                let rest = body[6..body.size]
                let idx = rest.indexOf("::") ?? Int64(-1)
                let id = if (idx < 0) { rest } else { rest[0..idx] }
                let i = indexOf(id)
                if (i >= 0 && entries[i].statusValue == "pending") {
                    entries[i].statusValue = "done"
                }
            } else if (body.startsWith("fail::")) {
                let rest = body[6..body.size]
                let idx = rest.indexOf("::") ?? Int64(-1)
                let id = if (idx < 0) { rest } else { rest[0..idx] }
                let i = indexOf(id)
                if (i >= 0 && entries[i].statusValue == "pending") {
                    entries[i].statusValue = "failed"
                }
            }
        }
    }

    public func start(id: String, sourcePath: String): Unit {
        if (id.size == 0) {
            throw Exception("opdf-empty-id")
        }
        if (sourcePath.size == 0) {
            throw Exception("opdf-empty-source")
        }
        if (indexOf(id) >= 0) {
            throw Exception("opdf-duplicate-id")
        }
        log.append("office-to-pdf/task", "start::${id}::${sourcePath}")
        entries.add(OpdfEntry(id, "pending"))
    }

    public func done(id: String, pdfPath: String): Unit {
        let i = indexOf(id)
        if (i < 0) {
            throw Exception("opdf-unknown-id")
        }
        if (entries[i].statusValue != "pending") {
            throw Exception("opdf-terminal")
        }
        if (pdfPath.size == 0) {
            throw Exception("opdf-empty-pdf")
        }
        log.append("office-to-pdf/task", "done::${id}::${pdfPath}")
        entries[i].statusValue = "done"
    }

    public func fail(id: String, reason: String): Unit {
        let i = indexOf(id)
        if (i < 0) {
            throw Exception("opdf-unknown-id")
        }
        if (entries[i].statusValue != "pending") {
            throw Exception("opdf-terminal")
        }
        if (reason.size == 0) {
            throw Exception("opdf-empty-reason")
        }
        log.append("office-to-pdf/task", "fail::${id}::${reason}")
        entries[i].statusValue = "failed"
    }

    public func status(id: String): String {
        let i = indexOf(id)
        if (i < 0) {
            throw Exception("opdf-unknown-id")
        }
        return entries[i].statusValue
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
