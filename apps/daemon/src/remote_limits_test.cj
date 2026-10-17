package daemon
import core.*

import std.collection.*
import std.unittest.*

// 设计 §7 限额的语义测试。这一层只验槽位算术与拒绝原因，
// 认证与授权由 remote_gate_test.cj 那批用例负责。

@Test
func rpcSlotsAllowEightPerDeviceThenDenyNinth() {
    let lm = RemoteConcurrencyLimiter()
    var allowed: Int64 = 0
    var lastReason = ""
    for (i in 0..9) {
        let slot = lm.acquireRpc("dev-a")
        if (slot.allowed) { allowed += 1 } else { lastReason = slot.reason }
    }
    @Expect(allowed, RPC_PER_DEVICE_LIMIT)
    @Expect(lastReason == CONCURRENCY_DENY_RPC, true)
    @Expect(lm.rpcHeldBy("dev-a"), RPC_PER_DEVICE_LIMIT)
}

@Test
func rpcSlotsArePerDeviceNotGlobal() {
    // 设备 A 打满不能影响设备 B——否则一台失控客户端能把整个实例锁死。
    let lm = RemoteConcurrencyLimiter()
    for (i in 0..8) { lm.acquireRpc("dev-a") }
    let other = lm.acquireRpc("dev-b")
    @Expect(other.allowed, true)
    @Expect(lm.rpcHeldBy("dev-b"), Int64(1))
}

@Test
func rpcSlotReleaseFreesCapacityAgain() {
    let lm = RemoteConcurrencyLimiter()
    for (i in 0..8) { lm.acquireRpc("dev-a") }
    @Expect(lm.acquireRpc("dev-a").allowed, false)
    lm.releaseRpc("dev-a")
    @Expect(lm.acquireRpc("dev-a").allowed, true)
    @Expect(lm.rpcHeldBy("dev-a"), RPC_PER_DEVICE_LIMIT)
}

@Test
func sseSlotsDenyThirdStreamForSameDevice() {
    let lm = RemoteConcurrencyLimiter()
    @Expect(lm.acquireSse("dev-a").allowed, true)
    @Expect(lm.acquireSse("dev-a").allowed, true)
    let third = lm.acquireSse("dev-a")
    @Expect(third.allowed, false)
    @Expect(third.reason == CONCURRENCY_DENY_SSE_DEVICE, true)
    // 被拒的那条不能占住槽位，否则拒绝一次就永久少一条可用流。
    @Expect(lm.sseHeldBy("dev-a"), SSE_PER_DEVICE_LIMIT)
    @Expect(lm.sseTotalHeld(), SSE_PER_DEVICE_LIMIT)
}

@Test
func sseInstanceCapAppliesAcrossDevices() {
    let lm = RemoteConcurrencyLimiter()
    var accepted: Int64 = 0
    var lastReason = ""
    // 每台设备只开 1 条流，靠设备数把「实例 64 条」这条上限打到；
    // 若用同一台设备连开，先撞上的是每设备 2 条的上限，读不到实例归因。
    for (i in 0..70) {
        let slot = lm.acquireSse("dev-${i}")
        if (slot.allowed) { accepted += 1 } else { lastReason = slot.reason }
    }
    @Expect(accepted, SSE_INSTANCE_LIMIT)
    @Expect(lastReason == CONCURRENCY_DENY_SSE_INSTANCE, true)
    @Expect(lm.sseTotalHeld(), SSE_INSTANCE_LIMIT)
}

@Test
func sseDeviceLimitReportsBeforeInstanceLimit() {
    // 同一台设备第 3 条流要拿到「每设备」这个更精确的归因，
    // 客户端据此知道是该关自己的流，而不是等实例腾位。
    let lm = RemoteConcurrencyLimiter()
    lm.acquireSse("dev-x")
    lm.acquireSse("dev-x")
    let denied = lm.acquireSse("dev-x")
    @Expect(denied.reason == CONCURRENCY_DENY_SSE_DEVICE, true)
}

@Test
func sseReleaseFreesBothDeviceAndInstanceCounters() {
    let lm = RemoteConcurrencyLimiter()
    lm.acquireSse("dev-a")
    lm.acquireSse("dev-a")
    @Expect(lm.acquireSse("dev-a").allowed, false)
    lm.releaseSse("dev-a")
    let again = lm.acquireSse("dev-a")
    @Expect(again.allowed, true)
    @Expect(lm.sseHeldBy("dev-a"), SSE_PER_DEVICE_LIMIT)
    @Expect(lm.sseTotalHeld(), SSE_PER_DEVICE_LIMIT)
}

@Test
func daemonLedgerUsesInstanceLevelBound() {
    // 这条只钉「daemon 传的是 §7 那个实例级额度常量」这一层接线；
    // 「有界 + 超限按插入序淘汰最早一条」的行为由 idempotency_test.cj 的 cap:3 用例钉。
    @Expect(idempotencyLedger.cap, IDEMPOTENCY_LEDGER_LIMIT)
}
