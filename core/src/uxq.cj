package core
import std.collection.*

// 用户提问：log-only `user-questions/request` `<id>::<question>` 与
// `user-questions/answer` `<id>::<answer>` 事件对。状态机 pending → answered
// 一次性 consume（第二次 answer 抛 `uxq-already-answered` 且不落事件），
// answer 未知 id 抛 `uxq-unknown`。askTimed 计时与 options 结构留待后续批次。
//
// 本切片假设 id/question/answer 不含 `::`；未来放开需换长度前缀编码。

class UxqItem {
    let id: String
    var status: String
    var answer: String
    init(id: String, status: String, answer: String) {
        this.id = id
        this.status = status
        this.answer = answer
    }
}

class UxqSplit {
    let v0Name: String
    let v1Name: String
    init(a: String, b: String) {
        v0Name = a
        v1Name = b
    }
}

public class UserQuestionStore {
    let log: SessionLog
    let items = ArrayList<UxqItem>()

    public init(log: SessionLog) {
        this.log = log
        for (event in log.snapshotEvents()) {
            let t = event.eventType
            if (t == "user-questions/request") {
                let parts = splitOnce(event.data, "::")
                items.add(UxqItem(parts.v0Name, "pending", ""))
            } else if (t == "user-questions/answer") {
                let parts = splitOnce(event.data, "::")
                let i = indexOf(parts.v0Name)
                if (i >= 0) {
                    items[i].status = "answered"
                    items[i].answer = parts.v1Name
                }
            }
        }
    }

    public func ask(id: String, question: String): Unit {
        if (id.size == 0) {
            throw Exception("uxq-empty-id")
        }
        if (question.size == 0) {
            throw Exception("uxq-empty-question")
        }
        if (indexOf(id) >= 0) {
            return
        }
        log.append("user-questions/request", "${id}::${question}")
        items.add(UxqItem(id, "pending", ""))
    }

    public func answer(id: String, text: String): Unit {
        let i = indexOf(id)
        if (i < 0) {
            throw Exception("uxq-unknown")
        }
        if (items[i].status == "answered") {
            throw Exception("uxq-already-answered")
        }
        log.append("user-questions/answer", "${id}::${text}")
        items[i].status = "answered"
        items[i].answer = text
    }

    public func status(id: String): String {
        let i = indexOf(id)
        if (i < 0) {
            throw Exception("uxq-unknown")
        }
        return items[i].status
    }

    public func answerOf(id: String): String {
        let i = indexOf(id)
        if (i < 0) {
            throw Exception("uxq-unknown")
        }
        return items[i].answer
    }

    private func indexOf(id: String): Int64 {
        var i: Int64 = 0
        while (i < Int64(items.size)) {
            if (items[i].id == id) {
                return i
            }
            i = i + 1
        }
        return Int64(-1)
    }

    private static func splitOnce(s: String, sep: String): UxqSplit {
        let idx = s.indexOf(sep) ?? Int64(-1)
        if (idx < 0) {
            return UxqSplit(s, "")
        }
        return UxqSplit(s[0..idx], s[(idx + sep.size)..s.size])
    }
}
