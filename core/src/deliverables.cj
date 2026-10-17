package core

public class PresentedRecord {
    public let turn: String
    public let callId: String
    public let files: String
    public init(turn: String, callId: String, files: String) {
        this.turn = turn
        this.callId = callId
        this.files = files
    }
}

// 产出物服务：`deliverables/presented` 与 `workspace/changes` 都是 log-only 事件，
// 不进模型请求（isSurfaceEvent 白名单里没有它们）。
//
// 事件编码：
// - `deliverables/presented`：`<turn>|<callId>|<file1,file2,...>`——本切片假设字段
//   不含 `|` 与 `,`（与 goal/todo 同一套权衡，未来放开需换长度前缀编码）。
// - `workspace/changes`：`<turn>`——每轮顶层停止时追加一条；摘要本身不在日志里
//   （与上游 workspaceChanges.summary 服务存活期一致）。
public class DeliverablesService {
    let log: SessionLog

    public init(log: SessionLog) {
        this.log = log
    }

    public func present(turn: Int64, callId: String, files: Array<String>): Unit {
        var joined = ""
        for (i in 0..files.size) {
            if (i > 0) { joined += "," }
            joined += files[i]
        }
        log.append("deliverables/presented", "${turn}|${callId}|${joined}")
    }

    public func recordTurnEnd(turn: Int64): Unit {
        log.append("workspace/changes", "${turn}")
    }

    // 回放最后一条 `deliverables/presented`；未 present 过返回全空字段。
    public func lastPresented(): PresentedRecord {
        var last = ""
        var seen = false
        for (event in log.snapshotEvents()) {
            if (event.eventType == "deliverables/presented") {
                last = event.data
                seen = true
            }
        }
        if (!seen) {
            return PresentedRecord("", "", "")
        }
        let fields = last.split("|")
        let t = if (fields.size > 0) { fields[0] } else { "" }
        let c = if (fields.size > 1) { fields[1] } else { "" }
        let f = if (fields.size > 2) { fields[2] } else { "" }
        return PresentedRecord(t, c, f)
    }

    // 回放最后一条 `workspace/changes` 的 turn 号；从未记录返回 ""。
    public func lastTurn(): String {
        var value = ""
        for (event in log.snapshotEvents()) {
            if (event.eventType == "workspace/changes") {
                value = event.data
            }
        }
        return value
    }
}
