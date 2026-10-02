package core

import std.collection.ArrayList
import std.fs.*
import std.io.*

public class SessionEvent {
    public let seq: Int64
    public let eventType: String
    public let data: String

    public init(seq: Int64, eventType: String, data: String) {
        this.seq = seq
        this.eventType = eventType
        this.data = data
    }
}

// 会话即事件日志：events 是唯一真相源，模型可见历史由 deriveMessages 投影得到。
public class SessionLog {
    let path: String
    public let events = ArrayList<SessionEvent>()
    public var flushedCount: Int64 = 0
    public var truncatedTail: Bool = false

    public init(path: String) {
        this.path = path
    }

    public func append(eventType: String, data: String): SessionEvent {
        let ev = SessionEvent(Int64(events.size), eventType, data)
        events.add(ev)
        return ev
    }

    // flush = 崩溃持久 + 跨进程可见；返回 false 表示未落盘，内存态不能当作已提交。
    public func flush(): Bool {
        var text = ""
        for (ev in events) {
            text += "${ev.seq}\t${ev.eventType}\t${ev.data}\n"
        }
        try {
            File.writeTo(path, text.toArray())
            flushedCount = Int64(events.size)
            return true
        } catch (e: IOException) {
            println("flush failed: ${e.message}")
            return false
        }
    }

    // 回放：只信任已落盘内容。物理截断/不合法的**尾帧**丢弃并保留已提交前缀
    // （truncatedTail 置真，由上层把未结算流标 interrupted）；中段缺帧是逻辑损坏，
    // 整份拒绝，绝不静默前滚。
    public func load(): Bool {
        try {
            let text = String.fromUtf8(File.readFrom(path))
            events.clear()
            truncatedTail = false
            let lines = ArrayList<String>()
            for (line in text.split("\n")) {
                if (line.size > 0) {
                    lines.add(line)
                }
            }
            let bs = text.toArray()
            var lastValid = Int64(lines.size)
            if (lastValid > 0 && (bs.size == 0 || bs[bs.size - 1] != 10)) {
                // 末字节不是 LF：最后一行只写了一半
                lastValid = lastValid - 1
                truncatedTail = true
            }
            var i: Int64 = 0
            while (i < lastValid) {
                let parts = lines[i].split("\t")
                let idx = Int64(events.size)
                if (parts.size < 3 || parts[0] != "${idx}") {
                    if (i == lastValid - 1) {
                        truncatedTail = true
                        lastValid = i
                        break
                    }
                    return false
                }
                events.add(SessionEvent(idx, parts[1], parts[2]))
                i += 1
            }
            flushedCount = Int64(events.size)
            return verifySeqContiguous()
        } catch (e: IOException) {
            return false
        }
    }

    // 只有 surface 事件进模型历史；turn/step/tool/call 等持久但不进。
    public func deriveMessages(): ArrayList<String> {
        let out = ArrayList<String>()
        for (ev in events) {
            if (ev.eventType == "system/message" || ev.eventType == "user/message" || ev.eventType == "assistant/message" || ev.eventType == "tool/result") {
                out.add("${ev.eventType}: ${ev.data}")
            }
        }
        return out
    }

    public func verifySeqContiguous(): Bool {
        for (i in 0..events.size) {
            if (events[i].seq != Int64(i)) {
                return false
            }
        }
        return true
    }
}
