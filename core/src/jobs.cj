package core
import std.collection.ArrayList

// 与上游 `JobSpec` + `JobStatus` 对齐的 registry 切片。
// 状态机：running → { stopping | completed | failed }；stopping → killed；
// 任何终态（completed/killed/failed）不再转出。
public class JobRecord {
    public let id: String
    public let kind: String
    public let label: String
    public var status: String
    public init(id: String, kind: String, label: String, status: String) {
        this.id = id
        this.kind = kind
        this.label = label
        this.status = status
    }
}

public class JobStore {
    let items = ArrayList<JobRecord>()
    var counterBash: Int64 = 0
    var counterSubagent: Int64 = 0

    private static func isTerminal(status: String): Bool {
        return status == "completed" || status == "killed" || status == "failed"
    }

    private func find(id: String): Option<JobRecord> {
        for (item in items) {
            if (item.id == id) {
                return Some(item)
            }
        }
        return None
    }

    // id 按 `<kind>-<N>` 单调分配；每个 kind 独立计数，与上游 `JobKindMap`
    // 按 declaration merging 扩展的形态一致（本切片只落 bash/subagent 两族）。
    public func start(kind: String, label: String): String {
        if (kind != "bash" && kind != "subagent") {
            throw Exception("unknown-job-kind")
        }
        let next = if (kind == "bash") {
            counterBash += Int64(1)
            counterBash
        } else {
            counterSubagent += Int64(1)
            counterSubagent
        }
        let id = "${kind}-${next}"
        items.add(JobRecord(id, kind, label, "running"))
        return id
    }

    public func get(id: String): JobRecord {
        match (find(id)) {
            case Some(r) => r
            case None => throw Exception("unknown-job-id")
        }
    }

    public func list(): ArrayList<JobRecord> {
        return items
    }

    // 状态转移：非法转换抛，且不改动记录。
    public func mark(id: String, status: String): Unit {
        let record = get(id)
        if (isTerminal(record.status)) {
            throw Exception("job-in-terminal-state")
        }
        if (status == "running") {
            // running 只从 start 而来，mark 不允许把任何态拉回 running。
            throw Exception("illegal-job-transition")
        }
        if (status != "stopping" && status != "completed" && status != "killed" && status != "failed") {
            throw Exception("unknown-job-status")
        }
        if (status == "killed" && record.status != "stopping") {
            // killed 是 stopping 的独占后继；running→killed 视为跳过 stop 步骤，非法。
            throw Exception("illegal-job-transition")
        }
        if (record.status == "stopping" && status == "completed") {
            // stopping 只能被 killed 或 failed 收束，不再「成功」。
            throw Exception("illegal-job-transition")
        }
        record.status = status
    }
}
