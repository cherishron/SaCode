package daemon
import core.*

import std.collection.*
import std.time.*
import std.unittest.*

// 设计 §6「每连接保留 1024 帧上限，并增加 4 MiB 字节上限；超过任一限额关闭并给出
// 可恢复原因」与 §4「撤销先更新服务端版本，再关闭匹配设备的全部 SSE」。
// 这一层此前在 daemon 侧完全没有单测：溢出语义只写在注释里，等于没有。
// 三条不能含糊的线：
//   1) 两个限额各自独立生效，且给出的原因要能区分（客户端据此决定补读还是缩页）；
//   2) 字节数按「仍在队列里的字节」算，消费掉就要归还——否则一个慢但一直在消费的
//      连接会被永久判超限，把背压变成 denial-of-service 自己人打自己人；
//   3) 按设备关闭只能关这台设备的流，别的设备不受影响。

@Test
func frameLimitClosesWithOverflowReasonAndKeepsOtherSubscriptions() {
    let bus = EventBus(frames: Int64(3), bytes: Int64(100000))
    let victim = bus.subscribe(device: "dev-a")
    let other = bus.subscribe(device: "dev-b")
    var accepted: Int64 = 0
    for (i in 0..6) {
        if (victim.offer("f-${i}")) { accepted += 1 }
    }
    // 恰好收下 frames 条，不多不少——静默多收就是限额没生效。
    @Expect(accepted, Int64(3))
    @Expect(victim.closeReason(), "overflow")
    // 溢出只杀这一条连接：同一条 publish 仍要送达别人。
    @Expect(other.closeReason(), "")
    bus.publish("m", "{}")
    @Expect(other.poll(10 * Duration.millisecond).isSome(), true)
    @Expect(victim.poll(10 * Duration.millisecond).isSome(), false)
}

@Test
func byteLimitClosesWithItsOwnReasonNotTheFrameOne() {
    // 每条 10 字节：6 条 60 字节还在 64 之内，第 7 条按字节越界，而按帧才 7/8 没越界。
    // 两个限额都给同一种原因，客户端就分不出「该缩页」还是「该补读」。
    let bus = EventBus(frames: Int64(8), bytes: Int64(64))
    let sub = bus.subscribe(device: "dev-a")
    var accepted: Int64 = 0
    for (i in 0..7) {
        if (sub.offer("0123456789")) { accepted += 1 }
    }
    @Expect(accepted, Int64(6))
    @Expect(sub.closeReason(), "byte-overflow")
    @Expect(sub.poll(10 * Duration.millisecond).isSome(), false)
}

@Test
func consumedBytesAreGivenBackSoASlowDrainingClientIsNotKilled() {
    // 队列字节只数「还没被取走的」。取走不还就等于把背压做成一次性死刑：
    // 客户端明明在消费，却会在第 N 条之后被永久判超限。
    let bus = EventBus(frames: Int64(100), bytes: Int64(64))
    let sub = bus.subscribe(device: "dev-a")
    var i: Int64 = 0
    while (i < Int64(6)) {
        @Expect(sub.offer("0123456789"), true)
        i += 1
    }
    var drained: Int64 = 0
    for (_ in 0..6) {
        if (let Some(taken) <- sub.poll(10 * Duration.millisecond)) {
            drained += 1
            @Expect(taken.size > Int64(0), true)
        }
    }
    @Expect(drained, Int64(6))
    // 腾空之后必须能继续收，且这条连接不该已经被判关闭。
    @Expect(sub.closeReason(), "")
    @Expect(sub.offer("0123456789"), true)
    @Expect(sub.poll(10 * Duration.millisecond).isSome(), true)
}

@Test
func closeForDeviceOnlyClosesThatDeviceAndReportsHowMany() {
    let bus = EventBus(frames: Int64(8), bytes: Int64(100000))
    let a1 = bus.subscribe(device: "dev-a")
    let a2 = bus.subscribe(device: "dev-a")
    let b = bus.subscribe(device: "dev-b")
    // 一台设备可以有 2 条 SSE（§7），撤销必须把它的两条一起关掉。
    @Expect(bus.closeFor(device: "dev-a", reason: "revoked"), Int64(2))
    @Expect(a1.closeReason(), "revoked")
    @Expect(a2.closeReason(), "revoked")
    @Expect(b.closeReason(), "")
    bus.publish("m", "{}")
    @Expect(b.poll(10 * Duration.millisecond).isSome(), true)
    @Expect(a1.poll(10 * Duration.millisecond).isSome(), false)
    // 关掉的订阅要从扇出表里摘掉，否则每条 publish 都在给死连接做无用功。
    @Expect(bus.subscriberCount(), Int64(1))
    // 再撤一次不报错也不误伤：幂等的关闭入口才敢放在轮询里反复调。
    @Expect(bus.closeFor(device: "dev-a", reason: "revoked"), Int64(0))
    @Expect(bus.closeFor(device: "dev-nope", reason: "revoked"), Int64(0))
}

@Test
func sseLimitsMatchTheDesignContractValues() {
    // §6 的两个数就是这两个数。改动它们要么改设计，要么就是偷偷放宽限额。
    @Expect(SSE_FRAME_LIMIT, Int64(1024))
    @Expect(SSE_BYTE_LIMIT, Int64(4 * 1024 * 1024))
    // 默认构造必须就用这两个限额，而不是另写一套「测试里才小」的假默认值。
    let bus = EventBus()
    let sub = bus.subscribe(device: "dev-a")
    var i: Int64 = 0
    var accepted: Int64 = 0
    while (i < Int64(1030)) {
        if (sub.offer("x")) { accepted += 1 }
        i += 1
    }
    @Expect(accepted, SSE_FRAME_LIMIT)
    @Expect(sub.closeReason(), "overflow")
}

@Test
func untaggedSubscriptionIsNotClosedByDeviceRevocation() {
    // 本机开发态（接入未启用）的连接没有 deviceId。按设备关流不能把它一起关掉，
    // 否则「撤销某台设备」会顺带打断本机桌面端——那是 §4 没要求的越权。
    let bus = EventBus(frames: Int64(8), bytes: Int64(100000))
    let local = bus.subscribe()
    @Expect(bus.closeFor(device: "dev-a", reason: "revoked"), Int64(0))
    @Expect(local.closeReason(), "")
    bus.publish("m", "{}")
    @Expect(local.poll(10 * Duration.millisecond).isSome(), true)
}
