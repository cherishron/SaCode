package core
import std.collection.*

// 溢出记录：log-only `spill/marker` 事件承载 `<turn>::<reason>` 两字段。
// 空 turn 或空 reason 都抛异常且不落事件。投影读侧只见 marker，不见被
// spill 出去的正文（那部分本就不在会话日志里）。
//
// 本切片假设 turn/reason 都不含 `::`；未来放开需换长度前缀编码。
public class SpillStore {
    let log: SessionLog

    public init(log: SessionLog) {
        this.log = log
    }

    public func record(turn: String, reason: String): Unit {
        if (turn.size == 0) {
            throw Exception("spill-empty-turn")
        }
        if (reason.size == 0) {
            throw Exception("spill-empty-reason")
        }
        log.append("spill/marker", "${turn}::${reason}")
    }

    public func markers(): ArrayList<String> {
        let out = ArrayList<String>()
        for (event in log.snapshotEvents()) {
            if (event.eventType == "spill/marker") {
                out.add(event.data)
            }
        }
        return out
    }
}
