package core
import std.collection.*

// 上下文压缩：log-only `compaction/record` 事件承载 `<reason>::<before>::<after>`
// 三字段（都用字符串避开 Int64 parse）。空 reason 抛。before/after 的数值
// 语义留给调用方保证；投影读侧只回放事件不做数值裁决。
//
// 本切片假设 reason/before/after 都不含 `::`；未来放开需换长度前缀编码。
public class CompactionLedger {
    let log: SessionLog

    public init(log: SessionLog) {
        this.log = log
    }

    public func record(reason: String, before: String, after: String): Unit {
        if (reason.size == 0) {
            throw Exception("compaction-empty-reason")
        }
        if (before.size == 0 || after.size == 0) {
            throw Exception("compaction-empty-count")
        }
        log.append("compaction/record", "${reason}::${before}::${after}")
    }

    public func entries(): ArrayList<String> {
        let out = ArrayList<String>()
        for (event in log.snapshotEvents()) {
            if (event.eventType == "compaction/record") {
                out.add(event.data)
            }
        }
        return out
    }
}
