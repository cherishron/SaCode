package core

import std.collection.ArrayList
import std.fs.*
import std.io.*
import std.sync.*
import std.env.getStdErr

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
// 只有这五类进模型可见历史（不变量 7 冻的集合）；其余（turn/start、stream/chunk、tool/call …）
// 持久但不进。
func isSurfaceEvent(t: String): Bool {
    return t == "system/message" || t == "developer/message" || t == "user/message" || t == "assistant/message" || t == "tool/result"
}

// 锁只保证内存态自洽，跨进程的持久与可见仍然只由 flush 决定。
public class SessionLog {
    let path: String
    // 直接改 events/flushedCount 只允许在持锁方法内部；单线程测试可直读字段，
    // 生产路径（CLI/Host）一律走下面的守护访问器。
    public let events = ArrayList<SessionEvent>()
    public var flushedCount: Int64 = 0
    public var truncatedTail: Bool = false
    let mtx = Mutex()
    // 投影缓存的键：surface 事件数 + 代次（代次只在 load 这类整体替换时 +1）。
    // 不变量 9 要的是「无关事件不触发重算」——turn/start、stream/chunk 这些持久但
    // 不进模型历史的事件只动 events，不动 surface 计数，于是下一次 derive 直接交回
    // 同一份缓存对象。键里带上代次是为了让 load 换内容后必然重建一次，
    // 不至于因为「新旧表面条数恰好相同」而端着旧缓存不放。
    var surfaceCount: Int64 = 0
    var generation: Int64 = 0
    var projBuiltSurface: Int64 = -1
    var projBuiltGeneration: Int64 = -1
    var projBuilds: Int64 = 0
    let projCache = ArrayList<String>()

    public init(path: String) {
        this.path = path
    }

    public func append(eventType: String, data: String): SessionEvent {
        mtx.lock()
        let ev = SessionEvent(Int64(events.size), eventType, data)
        events.add(ev)
        if (isSurfaceEvent(eventType)) {
            surfaceCount += 1
        }
        mtx.unlock()
        return ev
    }

    // flush = 崩溃持久 + 跨进程可见；返回 false 表示未落盘，内存态不能当作已提交。
    //
    // 发布前必须先过一道「只增不减」对照（见 mayOverwriteDurable）：内存里没有的事件，
    // 不能替磁盘上的事件做主。这条是本模块的实质修复——File.writeTo 是打开即截断，
    // 一次「草稿比磁盘短」的 flush 会把唯一真源改短，而且照样返回成功。
    //
    // 为什么不是「草稿写进临时文件再 rename 过去」：本机实测（400 次覆盖 + 3474 次
    // 并发读）std.fs 的 rename(overwrite:true) 是「先删目标、再移入」，于是并发读者
    // 有 88% 的次数看到的是**文件根本不存在**，另有 301 次直接读抛异常——
    // 比原来「短暂看到半份」更糟，因为空会话会被当成合法回放。原地整写至少保证
    // 目标始终在场。要真正的整份可见得换手段（追加发布），不是这条改名路径。
    public func flush(): Bool {
        var text = ""
        var ok = false
        mtx.lock()
        try {
            for (ev in events) {
                text += "${ev.seq}\t${escField(ev.eventType)}\t${escField(ev.data)}\n"
            }
            if (mayOverwriteDurable(text)) {
                File.writeTo(path, text.toArray())
                flushedCount = Int64(events.size)
                ok = true
            }
        } catch (e: Exception) {
            getStdErr().writeln("flush failed: ${e.message}")
            ok = false
        } finally {
            // 异常一律在这里收敛：持锁抛出会让这把锁永远再也拿不到
            mtx.unlock()
        }
        return ok
    }

    // 磁盘上每一条完整事件行都必须原样出现在草稿开头。草稿比磁盘短时，只允许少掉
    // 「回放本来就授权丢弃」的那一类尾部坏帧（字段不足 3 段），其余一律拒发。
    // 末字节不是 LF 的半帧不参与对照——它是物理残缺，不是一条待保留的事件。
    private func mayOverwriteDurable(draft: String): Bool {
        if (!exists(path)) {
            return true
        }
        var durable = ""
        try {
            durable = String.fromUtf8(File.readFrom(path))
        } catch (e: Exception) {
            // 读不回磁盘就无法证明草稿不会改短唯一真源，宁可不发
            getStdErr().writeln("flush refused: durable-unreadable")
            return false
        }
        let kept = wholeLines(durable)
        let mine = wholeLines(draft)
        var i: Int64 = 0
        while (i < kept.size && i < mine.size) {
            if (kept[i] != mine[i]) {
                getStdErr().writeln("flush refused: prefix-diverged-at-${i}")
                return false
            }
            i += 1
        }
        if (mine.size < kept.size) {
            var j = i
            while (j < kept.size) {
                if (Int64(kept[j].split("\t").size) >= 3) {
                    getStdErr().writeln("flush refused: draft-shrinks-durable-by-${kept.size - i}")
                    return false
                }
                j += 1
            }
        }
        return true
    }

    // 按 LF 切出「完整行」序列，口径与 loadLocked 一致：空段丢弃，
    // 文件末尾没有 LF 时剔除最后一段（那是写了一半的帧）。
    private func wholeLines(text: String): ArrayList<String> {
        let out = ArrayList<String>()
        if (text.size == 0) {
            return out
        }
        let bs = text.toArray()
        let parts = text.split("\n")
        var n = Int64(parts.size)
        if (bs[bs.size - 1] != 10) {
            n -= 1
        }
        var i: Int64 = 0
        while (i < n) {
            if (parts[i].size > 0) {
                out.add(parts[i])
            }
            i += 1
        }
        return out
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
            surfaceCount = 0
            generation += 1
            truncatedTail = false
            flushedCount = Int64(0)
            return true
        }
        try {
            let text = String.fromUtf8(File.readFrom(path))
            events.clear()
            surfaceCount = 0
            generation += 1
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
                let reloaded = SessionEvent(idx, unescField(parts[1]), unescField(parts[2]))
                events.add(reloaded)
                if (isSurfaceEvent(reloaded.eventType)) {
                    surfaceCount += 1
                }
                i += 1
            }
            flushedCount = Int64(events.size)
            return verifySeqContiguousLocked()
        } catch (e: IOException) {
            return false
        }
    }

    // 只有 surface 事件进模型历史；turn/step/tool/call 等持久但不进。
    // 键（surface 条数 + 代次）没变时交回**同一个缓存对象**，不重新分配——
    // 这就是不变量 9 的「无关事件不触发下游重算」。代价是返回的列表按约定只读：
    // 调用方就地改它等于改缓存，Host 侧只做遍历拼帧。
    public func deriveMessages(): ArrayList<String> {
        mtx.lock()
        if (projBuiltSurface != surfaceCount || projBuiltGeneration != generation) {
            projCache.clear()
            for (ev in events) {
                if (isSurfaceEvent(ev.eventType)) {
                    projCache.add("${ev.eventType}: ${ev.data}")
                }
            }
            projBuiltSurface = surfaceCount
            projBuiltGeneration = generation
            projBuilds += 1
        }
        let out = projCache
        mtx.unlock()
        return out
    }

    // 投影实际重算了几次：可观测的「有没有白重算」计数，供用例与遥测读。
    public func projectionBuilds(): Int64 {
        mtx.lock()
        let n = projBuilds
        mtx.unlock()
        return n
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
