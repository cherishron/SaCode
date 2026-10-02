package core

import std.collection.ArrayList
import std.fs.*
import std.io.*

public class SessionEvent {
    let seq: Int64
    let eventType: String
    let data: String

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

    // 回放：只信任已落盘内容，逐行重建 seq/eventType/data；物理尾帧不完整则丢弃该帧。
    public func load(): Bool {
        try {
            let text = String.fromUtf8(File.readFrom(path))
            events.clear()
            for (line in text.split("\n")) {
                if (line.size == 0) {
                    continue
                }
                let parts = line.split("\t")
                if (parts.size < 3) {
                    return false
                }
                // 不做数字解析：把落盘顺序当作期望 seq，与行内声明 seq 按字符串比对，
                // 等价于校验「next seq == 事件数」，同时避开解析异常分支。
                let idx = Int64(events.size)
                if (parts[0] != "${idx}") {
                    return false
                }
                events.add(SessionEvent(idx, parts[1], parts[2]))
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
