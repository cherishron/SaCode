package daemon

import std.sync.*
import std.collection.*
import std.collection.concurrent.*

// 每条 SSE 连接拥有自己的有界队列；生产者从不调用连接 writer。
class EventSubscription {
    public let id: Int64
    let mtx = Mutex()
    let queue: ArrayBlockingQueue<String>
    var reason = ""

    public init(id: Int64, capacity: Int64) {
        this.id = id
        queue = ArrayBlockingQueue<String>(capacity)
    }

    public func offer(frame: String): Bool {
        synchronized(mtx) {
            if (reason != "") { return false }
            if (!queue.tryAdd(frame)) {
                reason = "overflow"
                return false
            }
            return true
        }
    }

    public func close(): Unit {
        synchronized(mtx) {
            if (reason == "") { reason = "unsubscribed" }
        }
    }

    public func closeReason(): String {
        synchronized(mtx) { return reason }
    }

    public func isClosed(): Bool { closeReason() != "" }

    // 等待时不持锁；关闭后不再交付残留帧，避免把缺帧流伪装成完整流。
    public func poll(timeout: Duration): Option<String> {
        if (isClosed()) { return None }
        let frame = queue.remove(timeout)
        synchronized(mtx) {
            if (reason != "") { return None }
            return frame
        }
    }
}

class EventBus {
    let mtx = Mutex()
    let subs = HashMap<Int64, EventSubscription>()
    let capacity: Int64
    var nextSubId: Int64 = 1

    public init() { capacity = 1024 }

    public init(capacity: Int64) {
        if (capacity <= 0) { throw IllegalArgumentException("subscription-capacity-must-be-positive") }
        this.capacity = capacity
    }

    // 非阻塞扇出；满队列显式关闭并移除该订阅，不阻塞其他连接、不静默丢帧。
    public func publish(method: String, params: String): Unit {
        let frame = "{\"jsonrpc\":\"2.0\",\"method\":\"${method}\",\"params\":${params}}"
        synchronized(mtx) {
            let closed = ArrayList<Int64>()
            for ((id, sub) in subs) {
                if (!sub.offer(frame)) { closed.add(id) }
            }
            for (id in closed) { subs.remove(id) }
        }
    }

    public func subscribe(): EventSubscription {
        synchronized(mtx) {
            let sub = EventSubscription(nextSubId, capacity)
            nextSubId += 1
            subs.add(sub.id, sub)
            return sub
        }
    }

    public func unsubscribe(id: Int64): Unit {
        synchronized(mtx) {
            if (let Some(sub) <- subs.remove(id)) { sub.close() }
        }
    }

    // 运行指标：当前仍可接收通知的订阅数，不包含溢出关闭的连接。
    public func subscriberCount(): Int64 {
        synchronized(mtx) { return subs.size }
    }
}
