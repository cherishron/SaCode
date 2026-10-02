package core

import std.collection.ArrayList

// 在途工具调用登记：callId 是「取消哪一笔」的键。
// 只由宿主主循环增删（收帧的线程只往 sink 里塞），所以不加锁——
// 与 ListenerRegistry 同一取舍：跨线程的数据只经由线程安全的 sink 流动。
public class InflightCalls {
    var items = ArrayList<Int64>()

    // 同一 callId 两笔在途 = 调用方的配对逻辑已经出错，明确拒绝，不把两笔混成一笔。
    public func add(callId: Int64): Bool {
        if (has(callId)) {
            return false
        }
        items.add(callId)
        return true
    }

    public func has(callId: Int64): Bool {
        for (c in items) {
            if (c == callId) {
                return true
            }
        }
        return false
    }

    // 结果帧到手 = 这一笔已经结算：摘掉它，之后的取消只能说「没这条」，不能假装取消成功。
    public func settle(callId: Int64): Bool {
        let keep = ArrayList<Int64>()
        var found = false
        for (c in items) {
            if (c == callId && !found) {
                found = true
            } else {
                keep.add(c)
            }
        }
        if (found) {
            items = keep
        }
        return found
    }

    // 快照：调用方改它不影响登记（与 ToolRegistry.list 同一约定）。
    public func list(): ArrayList<Int64> {
        let out = ArrayList<Int64>()
        for (c in items) {
            out.add(c)
        }
        return out
    }

    public func count(): Int64 {
        return Int64(items.size)
    }
}
