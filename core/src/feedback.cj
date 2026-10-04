package core
import std.collection.*

// 反馈：log-only `feedback/record` 事件承载 `<turn>::<sentiment>::<comment>`；
// 空 turn 抛 `feedback-empty-turn`、空 sentiment 抛 `feedback-empty-sentiment`，
// 两者都 throw 不落事件。comment 允许为空（👍/👎 无文本评论）。
//
// 本切片假设 turn/sentiment/comment 都不含 `::`；未来放开需换长度前缀编码。
public class FeedbackStore {
    let log: SessionLog

    public init(log: SessionLog) {
        this.log = log
    }

    public func record(turn: String, sentiment: String, comment: String): Unit {
        if (turn.size == 0) {
            throw Exception("feedback-empty-turn")
        }
        if (sentiment.size == 0) {
            throw Exception("feedback-empty-sentiment")
        }
        log.append("feedback/record", "${turn}::${sentiment}::${comment}")
    }

    public func entries(): ArrayList<String> {
        let out = ArrayList<String>()
        for (event in log.snapshotEvents()) {
            if (event.eventType == "feedback/record") {
                out.add(event.data)
            }
        }
        return out
    }
}
