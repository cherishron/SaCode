package core
import std.collection.*

// 终端缓冲：无 PTY 窄化。log-only `terminal/chunk` 事件承载 `<sessionId>::<text>`；
// `read(sessionId)` 按顺序取该会话所有 chunk；未登记会话返 ArrayList 空数组不抛。
// 空 sessionId/text 各自抛。
//
// 本切片假设 sessionId/text 不含 `::`。
public class TerminalBuffer {
    let log: SessionLog

    public init(log: SessionLog) {
        this.log = log
    }

    public func append(sessionId: String, text: String): Unit {
        if (sessionId.size == 0) {
            throw Exception("terminal-empty-session")
        }
        if (text.size == 0) {
            throw Exception("terminal-empty-text")
        }
        log.append("terminal/chunk", "${sessionId}::${text}")
    }

    public func read(sessionId: String): ArrayList<String> {
        let out = ArrayList<String>()
        for (event in log.snapshotEvents()) {
            if (event.eventType != "terminal/chunk") {
                continue
            }
            let body = event.data
            let idx = body.indexOf("::") ?? Int64(-1)
            if (idx < 0) {
                continue
            }
            if (body[0..idx] == sessionId) {
                out.add(body[(idx + 2)..body.size])
            }
        }
        return out
    }
}
