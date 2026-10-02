package core

import std.collection.ArrayList
import std.fs.*
import std.io.*
import std.sync.*

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

// 落盘格式是按行的 TSV，字段里的裸控制字符会把一条事件劈成两行，回放时
// 中段缺帧会被判整份拒绝。所以只转义会破坏帧结构的四个字符，回放时对称还原。
func escField(s: String): String {
    let out = ArrayList<Byte>()
    for (b in s.toArray()) {
        let n = Int64(b)
        if (n == 92) {
            out.add(92)
            out.add(92)
        } else if (n == 10) {
            out.add(92)
            out.add(110)
        } else if (n == 13) {
            out.add(92)
            out.add(114)
        } else if (n == 9) {
            out.add(92)
            out.add(116)
        } else {
            out.add(b)
        }
    }
    return String.fromUtf8(out.toArray())
}

// 认不出的转义序列保留反斜杠本身，不做「猜一个字符」的降级：
// 宁可原样交回，也不要把日志里没写过的字符读出来。
func unescField(s: String): String {
    let bs = s.toArray()
    let out = ArrayList<Byte>()
    var i: Int64 = 0
    while (i < Int64(bs.size)) {
        let n = Int64(bs[i])
        var handled = false
        if (n == 92 && i + 1 < Int64(bs.size)) {
            let m = Int64(bs[i + 1])
            if (m == 92) {
                out.add(92)
                i += 1
                handled = true
            } else if (m == 110) {
                out.add(10)
                i += 1
                handled = true
            } else if (m == 114) {
                out.add(13)
                i += 1
                handled = true
            } else if (m == 116) {
                out.add(9)
                i += 1
                handled = true
            }
        }
        if (!handled) {
            out.add(bs[i])
        }
        i += 1
    }
    return String.fromUtf8(out.toArray())
}

// 会话即事件日志：events 是唯一真相源，模型可见历史由 deriveMessages 投影得到。
//
// 并发面：turn 线程在 append 的同时，桌面/CLI 还要读投影。写者之间仍由 WriteLease
// 保证「同一会话一个写者」，但**同一进程内的多个线程**共享的是同一个 SessionLog
// 对象（turn 线程写、主线程读），所以这里所有访问都过锁：不加锁时两个线程
// 同时读 size 会发出重复 seq，投影读到半改写的列表会撕裂。
// 锁只保证内存态自洽，跨进程的持久与可见仍然只由 flush 决定。
public class SessionLog {
    let path: String
    // 直接改 events/flushedCount 只允许在持锁方法内部；单线程测试可直读字段，
    // 生产路径（CLI/Host）一律走下面的守护访问器。
    public let events = ArrayList<SessionEvent>()
    public var flushedCount: Int64 = 0
    public var truncatedTail: Bool = false
    let mtx = Mutex()

    public init(path: String) {
        this.path = path
    }

    public func append(eventType: String, data: String): SessionEvent {
        mtx.lock()
        let ev = SessionEvent(Int64(events.size), eventType, data)
        events.add(ev)
        mtx.unlock()
        return ev
    }

    // flush = 崩溃持久 + 跨进程可见；返回 false 表示未落盘，内存态不能当作已提交。
    public func flush(): Bool {
        var text = ""
        var ok = false
        mtx.lock()
        for (ev in events) {
            text += "${ev.seq}\t${escField(ev.eventType)}\t${escField(ev.data)}\n"
        }
        try {
            File.writeTo(path, text.toArray())
            flushedCount = Int64(events.size)
            ok = true
        } catch (e: IOException) {
            println("flush failed: ${e.message}")
            ok = false
        }
        mtx.unlock()
        return ok
    }

    public func load(): Bool {
        var ok = false
        mtx.lock()
        try {
            ok = loadLocked()
        } catch (e: Exception) {
            ok = false
        }
        mtx.unlock()
        return ok
    }

    // 回放：只信任已落盘内容。物理截断/不合法的**尾帧**丢弃并保留已提交前缀
    // （truncatedTail 置真，由上层把未结算流标 interrupted）；中段缺帧是逻辑损坏，
    // 整份拒绝，绝不静默前滚。
    private func loadLocked(): Bool {
        if (!exists(path)) {
            // 还没有日志文件 = 零事件，合法回放；损坏只针对「已有内容但序号断裂/尾帧坏掉」
            events.clear()
            truncatedTail = false
            flushedCount = Int64(0)
            return true
        }
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
                events.add(SessionEvent(idx, unescField(parts[1]), unescField(parts[2])))
                i += 1
            }
            flushedCount = Int64(events.size)
            return verifySeqContiguousLocked()
        } catch (e: IOException) {
            return false
        }
    }

    // 只有 surface 事件进模型历史；turn/step/tool/call 等持久但不进。
    public func deriveMessages(): ArrayList<String> {
        let out = ArrayList<String>()
        mtx.lock()
        for (ev in events) {
            if (ev.eventType == "system/message" || ev.eventType == "user/message" || ev.eventType == "assistant/message" || ev.eventType == "tool/result") {
                out.add("${ev.eventType}: ${ev.data}")
            }
        }
        mtx.unlock()
        return out
    }

    public func verifySeqContiguous(): Bool {
        mtx.lock()
        let ok = verifySeqContiguousLocked()
        mtx.unlock()
        return ok
    }

    // 以下访问器是生产路径唯一允许的读法：一次调用内部一致，不会读到半改写的状态。
    public func eventCount(): Int64 {
        mtx.lock()
        let n = Int64(events.size)
        mtx.unlock()
        return n
    }

    public func durableCount(): Int64 {
        mtx.lock()
        let n = flushedCount
        mtx.unlock()
        return n
    }

    // 内存可见但还没跨进程可见的那部分：非 0 就是「尚未 flush」，不能当已提交
    public func pendingCount(): Int64 {
        mtx.lock()
        let n = Int64(events.size) - flushedCount
        mtx.unlock()
        return n
    }

    public func isTruncatedTail(): Bool {
        mtx.lock()
        let t = truncatedTail
        mtx.unlock()
        return t
    }

    // 取一份不可变快照出去遍历：调用方拿到的是副本，不会与并发写者共享内部列表
    public func snapshotEvents(): ArrayList<SessionEvent> {
        let out = ArrayList<SessionEvent>()
        mtx.lock()
        for (ev in events) {
            out.add(ev)
        }
        mtx.unlock()
        return out
    }

    private func verifySeqContiguousLocked(): Bool {
        var i: Int64 = 0
        while (i < Int64(events.size)) {
            if (events[i].seq != i) {
                return false
            }
            i += 1
        }
        return true
    }
}
