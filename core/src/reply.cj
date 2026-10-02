package core
import std.collection.ArrayList
import std.sync.*

// 应答登记表：读线程按帧里的 id 入表，等待方只取自己那条 id 的帧。
// 三条硬约束：
//   1) 表满时回压等待，一条帧都不丢（丢帧计数结构性为 0）；
//   2) 等待方已放弃后才到的帧记入迟到账，不吞掉也不冒充别的请求的应答；
//   3) 从来没人登记过的帧（id 为 null 或乱发）记入无主账，不能被任何在途请求认领。
public class ReplyTable {
    let cap: Int64
    let mtx = Mutex()
    let cond: Condition
    let ids = ArrayList<Int64>()
    let frames = ArrayList<String>()
    let pending = ArrayList<Int64>()
    // 已放弃但允许迟到的 id 有界保留：宿主长时间运行时不能让它无界长大
    let abandoned = ArrayList<Int64>()
    let lateCnt = AtomicInt64(0)
    let strayCnt = AtomicInt64(0)
    let overCnt = AtomicInt64(0)
    var stopping = false

    public init(cap: Int64) {
        this.cap = cap
        mtx.lock()
        this.cond = mtx.condition()
        mtx.unlock()
    }

    // 收束阶段放行可能卡在回压里的读线程：先 stop 再 join
    public func stop() {
        mtx.lock()
        stopping = true
        cond.notifyAll()
        mtx.unlock()
    }

    // 发请求前先登记：应答可能比这次 write 返回得还快
    public func track(id: Int64) {
        mtx.lock()
        pending.add(id)
        mtx.unlock()
    }

    // 等待方收手（拿到应答或超时）后摘掉登记：此后同 id 的帧只能记成迟到
    public func untrack(id: Int64) {
        mtx.lock()
        let kept = ArrayList<Int64>()
        for (v in pending) {
            if (v != id) {
                kept.add(v)
            }
        }
        pending.clear()
        for (v in kept) {
            pending.add(v)
        }
        if (Int64(abandoned.size) < cap) {
            abandoned.add(id)
        }
        mtx.unlock()
    }

    public func put(id: Int64, frame: String) {
        mtx.lock()
        if (containsPending(id)) {
            // 收束时不再受 cap 约束：宁可临时超一点，也不丢帧
            while (Int64(frames.size) >= cap && !stopping) {
                overCnt.fetchAdd(1)
                cond.wait(timeout: 20 * Duration.millisecond)
            }
            ids.add(id)
            frames.add(frame)
            cond.notifyAll()
        } else if (containsAbandoned(id)) {
            lateCnt.fetchAdd(1)
            dropAbandoned(id)
        } else {
            strayCnt.fetchAdd(1)
        }
        mtx.unlock()
    }

    public func take(id: Int64, timeoutMs: Int64): Option<String> {
        var waited: Int64 = 0
        var out: Option<String> = None
        var done = false
        while (!done && waited < timeoutMs) {
            mtx.lock()
            let i = findFrame(id)
            if (i >= 0) {
                out = Some(frames[i])
                removeSlotAt(i)
                // 腾出了位置，叫醒可能卡在回压里的读线程
                cond.notifyAll()
                done = true
            } else {
                cond.wait(timeout: 20 * Duration.millisecond)
                waited += 20
            }
            mtx.unlock()
        }
        return out
    }

    public func late(): Int64 {
        return lateCnt.load()
    }

    public func unsolicited(): Int64 {
        return strayCnt.load()
    }

    public func overflow(): Int64 {
        return overCnt.load()
    }

    // 本端从不丢帧：回压只报信号。这里返回 0 是结构性的，不是统计出来的
    public func dropped(): Int64 {
        return Int64(0)
    }

    private func containsPending(id: Int64): Bool {
        var hit = false
        for (v in pending) {
            if (v == id) {
                hit = true
            }
        }
        return hit
    }

    private func containsAbandoned(id: Int64): Bool {
        var hit = false
        for (v in abandoned) {
            if (v == id) {
                hit = true
            }
        }
        return hit
    }

    private func dropAbandoned(id: Int64) {
        let kept = ArrayList<Int64>()
        for (v in abandoned) {
            if (v != id) {
                kept.add(v)
            }
        }
        abandoned.clear()
        for (v in kept) {
            abandoned.add(v)
        }
    }

    private func findFrame(id: Int64): Int64 {
        var idx: Int64 = -1
        var i: Int64 = 0
        while (i < Int64(ids.size)) {
            if (ids[i] == id) {
                idx = i
                break
            }
            i += 1
        }
        return idx
    }

    private func removeSlotAt(pos: Int64) {
        let keepIds = ArrayList<Int64>()
        let keepFrames = ArrayList<String>()
        var i: Int64 = 0
        while (i < Int64(ids.size)) {
            if (i != pos) {
                keepIds.add(ids[i])
                keepFrames.add(frames[i])
            }
            i += 1
        }
        ids.clear()
        frames.clear()
        for (v in keepIds) {
            ids.add(v)
        }
        for (v in keepFrames) {
            frames.add(v)
        }
    }
}
