package daemon

import std.collection.*
import std.sync.*

// 设计 §7 限额：每设备最多 8 个并发 RPC、2 条 SSE；实例最多 64 条 SSE。
// 这一层只管「槽位」，不管身份是否有效——调用方必须先过 gate 再抢槽，
// 否则未认证请求就能把某个设备的槽位打满（DoS 面从认证面挪到限额面）。
public let RPC_PER_DEVICE_LIMIT: Int64 = 8
public let SSE_PER_DEVICE_LIMIT: Int64 = 2
public let SSE_INSTANCE_LIMIT: Int64 = 64

public let CONCURRENCY_DENY_RPC: String = "rpc-per-device"
public let CONCURRENCY_DENY_SSE_DEVICE: String = "sse-per-device"
public let CONCURRENCY_DENY_SSE_INSTANCE: String = "sse-instance"

public class SlotOutcome {
    public let allowed: Bool
    public let reason: String
    public init(allowed!: Bool, reason!: String) {
        this.allowed = allowed
        this.reason = reason
    }
}

public class RemoteConcurrencyLimiter {
    let lock = Mutex()
    // 计数按 deviceId 存；归零后留在表里——表的大小受已登记设备数约束，
    // 换来的是「释放路径不需要删键」这条更不容易出错的结构。
    let rpcHeld = HashMap<String, Int64>()
    let sseHeld = HashMap<String, Int64>()
    var sseTotal: Int64 = 0

    public init() {}

    static func countOf(table: HashMap<String, Int64>, key: String): Int64 {
        return table.get(key) ?? Int64(0)
    }

    public func acquireRpc(deviceId: String): SlotOutcome {
        lock.lock()
        let held = RemoteConcurrencyLimiter.countOf(rpcHeld, deviceId)
        var ok = false
        if (held < RPC_PER_DEVICE_LIMIT) {
            rpcHeld.add(deviceId, held + 1)
            ok = true
        }
        lock.unlock()
        return if (ok) { SlotOutcome(allowed: true, reason: "") }
            else { SlotOutcome(allowed: false, reason: CONCURRENCY_DENY_RPC) }
    }

    public func releaseRpc(deviceId: String): Unit {
        lock.lock()
        let held = RemoteConcurrencyLimiter.countOf(rpcHeld, deviceId)
        if (held > Int64(0)) { rpcHeld.add(deviceId, held - 1) }
        lock.unlock()
    }

    // SSE 有两个上限：先判该设备自己的 2 条，再判实例的 64 条。
    // 顺序是有意的——设备级拒绝更精确，审计与客户端错误归因都按它给。
    public func acquireSse(deviceId: String): SlotOutcome {
        lock.lock()
        let held = RemoteConcurrencyLimiter.countOf(sseHeld, deviceId)
        var reason = ""
        if (held >= SSE_PER_DEVICE_LIMIT) {
            reason = CONCURRENCY_DENY_SSE_DEVICE
        } else if (sseTotal >= SSE_INSTANCE_LIMIT) {
            reason = CONCURRENCY_DENY_SSE_INSTANCE
        } else {
            sseHeld.add(deviceId, held + 1)
            sseTotal += 1
        }
        lock.unlock()
        return if (reason.size == 0) { SlotOutcome(allowed: true, reason: "") }
            else { SlotOutcome(allowed: false, reason: reason) }
    }

    public func releaseSse(deviceId: String): Unit {
        lock.lock()
        let held = RemoteConcurrencyLimiter.countOf(sseHeld, deviceId)
        if (held > Int64(0)) {
            sseHeld.add(deviceId, held - 1)
            sseTotal -= 1
        }
        lock.unlock()
    }

    public func rpcHeldBy(deviceId: String): Int64 {
        lock.lock()
        let n = RemoteConcurrencyLimiter.countOf(rpcHeld, deviceId)
        lock.unlock()
        return n
    }

    public func sseHeldBy(deviceId: String): Int64 {
        lock.lock()
        let n = RemoteConcurrencyLimiter.countOf(sseHeld, deviceId)
        lock.unlock()
        return n
    }

    public func sseTotalHeld(): Int64 {
        lock.lock()
        let n = sseTotal
        lock.unlock()
        return n
    }
}
