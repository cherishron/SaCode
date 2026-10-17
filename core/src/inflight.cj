package core

import std.collection.ArrayList

public class InflightEntry {
    public let callId: Int64
    // 发起时所属的轮次：0 = 不在任何 turn 里（桌面/CLI 手动发起）
    public let epoch: Int64

    public init(callId: Int64, epoch: Int64) {
        this.callId = callId
        this.epoch = epoch
    }
}

// 在途工具调用登记：callId 是「取消哪一笔」的键，epoch 是「哪一轮发起的」。
// 只由宿主主循环增删（收帧的线程只往 sink 里塞），所以不加锁——
// 与 ListenerRegistry 同一取舍：跨线程的数据只经由线程安全的 sink 流动。
public class InflightCalls {
    var items = ArrayList<InflightEntry>()

    // 同一 callId 两笔在途 = 调用方的配对逻辑已经出错，明确拒绝，不把两笔混成一笔。
    // 跨轮次也不例外：callId 全局唯一，取消才不会指错人。
    public func add(callId: Int64, epoch!: Int64 = 0): Bool {
        if (has(callId)) {
            return false
        }
        items.add(InflightEntry(callId, epoch))
        return true
    }

    public func has(callId: Int64): Bool {
        for (e in items) {
            if (e.callId == callId) {
                return true
            }
        }
        return false
    }

    // 结果帧到手 = 这一笔已结算：摘掉它，之后的取消只能说「没这条」，不能假装取消成功。
    public func settle(callId: Int64): Bool {
        let keep = ArrayList<InflightEntry>()
        var found = false
        for (e in items) {
            if (e.callId == callId && !found) {
                found = true
            } else {
                keep.add(e)
            }
        }
        if (found) {
            items = keep
        }
        return found
    }

    // 某一轮自己发起的在途调用。取消 turn 只能动这一批——
    // 上一轮仍在途的调用与本轮无关，误伤会把一个已经没人在等的调用标成 cancelled。
    public func idsForEpoch(epoch: Int64): ArrayList<Int64> {
        let out = ArrayList<Int64>()
        for (e in items) {
            if (e.epoch == epoch) {
                out.add(e.callId)
            }
        }
        return out
    }

    // 快照：调用方改它不影响登记（与 ToolRegistry.list 同一约定）。
    public func list(): ArrayList<Int64> {
        let out = ArrayList<Int64>()
        for (e in items) {
            out.add(e.callId)
        }
        return out
    }

    public func count(): Int64 {
        return Int64(items.size)
    }
}
