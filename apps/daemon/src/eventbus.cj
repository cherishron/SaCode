package daemon

import std.sync.*
import std.collection.*
import std.collection.concurrent.*

// 每条 SSE 连接拥有自己的有界队列；生产者从不调用连接 writer。
// 两个上界各给各的关闭原因（§6）：帧数越界是 overflow，字节越界是 byte-overflow，
// 被撤销/过期关流是 revoked——客户端要据此选「缩页重取」还是「降低订阅粒度」还是「重新认证」。
class EventSubscription {
    public let id: Int64
    // 建流时认证到的设备身份。空串表示本机开发态（接入未启用），它不属于任何设备，
    // 因此不能被任何「撤销这台设备」的操作波及。
    public let device: String
    let mtx = Mutex()
    let queue: ArrayBlockingQueue<String>
    let byteLimit: Int64
    var queuedBytes: Int64 = 0
    var reason = ""

    public init(id!: Int64, device!: String, frames!: Int64, bytes!: Int64) {
        this.id = id
        this.device = device
        queue = ArrayBlockingQueue<String>(frames)
        byteLimit = bytes
    }

    // 只数「还在队列里的字节」：取走就归还。否则一个慢但一直在消费的连接会在第 N 条之后
    // 被永久判超限，把背压做成自己人对自己的 denial-of-service。
    public func offer(frame: String): Bool {
        let weight = Int64(frame.toArray().size)
        synchronized(mtx) {
            if (reason != "") { return false }
            if (queuedBytes + weight > byteLimit) {
                reason = SSE_CLOSE_BYTE_OVERFLOW
                return false
            }
            if (!queue.tryAdd(frame)) {
                reason = SSE_CLOSE_OVERFLOW
                return false
            }
            queuedBytes += weight
            return true
        }
    }

    public func close(): Unit {
        synchronized(mtx) {
            if (reason == "") { reason = SSE_CLOSE_UNSUBSCRIBED }
        }
    }

    // 按原因关闭：已有关闭原因时不覆盖，第一条原因才是真因。
    public func closeWith(closingReason: String): Unit {
        synchronized(mtx) {
            if (reason == "") { reason = closingReason }
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
            if (let Some(text) <- frame) {
                let weight = Int64(text.toArray().size)
                if (queuedBytes >= weight) { queuedBytes -= weight } else { queuedBytes = Int64(0) }
            }
            return frame
        }
    }
}

class EventBus {
    let mtx = Mutex()
    let subs = HashMap<Int64, EventSubscription>()
    let frames: Int64
    let bytes: Int64
    var nextSubId: Int64 = 1

    public init(frames!: Int64 = SSE_FRAME_LIMIT, bytes!: Int64 = SSE_BYTE_LIMIT) {
        if (frames <= Int64(0) || bytes <= Int64(0)) {
            throw IllegalArgumentException("subscription-limits-must-be-positive")
        }
        this.frames = frames
        this.bytes = bytes
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

    public func subscribe(device!: String = ""): EventSubscription {
        synchronized(mtx) {
            let sub = EventSubscription(id: nextSubId, device: device, frames: frames, bytes: bytes)
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

    // 设计 §4「撤销先更新服务端版本，再关闭匹配设备的全部 SSE」。
    // 空设备串不参与匹配：本机开发态的连接不属于任何可撤销的设备。
    // 关闭后立刻从扇出表摘掉，并把关掉的条数还给调用方——审计要知道这次撤销真的断了几条流。
    public func closeFor(device!: String, reason!: String): Int64 {
        if (device.size == Int64(0)) { return Int64(0) }
        synchronized(mtx) {
            let doomed = ArrayList<Int64>()
            for ((id, sub) in subs) {
                if (sub.device == device) {
                    sub.closeWith(reason)
                    doomed.add(id)
                }
            }
            for (id in doomed) { subs.remove(id) }
            return Int64(doomed.size)
        }
    }

    // 运行指标：当前仍可接收通知的订阅数，不包含溢出关闭的连接。
    public func subscriberCount(): Int64 {
        synchronized(mtx) { return subs.size }
    }
}
