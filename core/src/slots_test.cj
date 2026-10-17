package core
import std.collection.*
import std.fs.*
import std.unittest.*

// 槽位上游契约（M5/M6）：`ctx.slots.register(slotId, kind)` 后 slot 存在但未
// 激活；`activate(slotId)` 走 `slots/activate` 事件；同一 slot 二次激活 noop；
// 未知 slot 激活拒绝。本切片以 log-only 事件承载注册与激活，投影可读回。

@Test
func slotsRegisterThenActivateEmitsTwoEvents() {
    let root = "core-slots-happy"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let slots = SlotRegistry(log)
    slots.register("sidebar-right", "panel")
    slots.activate("sidebar-right")
    @Expect(slots.isRegistered("sidebar-right"), true)
    @Expect(slots.isActivated("sidebar-right"), true)
    @Expect(slots.eventCount(log), Int64(2))
    removeIfExists(root, recursive: true)
}

@Test
func slotsActivateUnknownRejected() {
    let root = "core-slots-unknown"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let slots = SlotRegistry(log)
    var threw = false
    try {
        slots.activate("ghost")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    @Expect(slots.eventCount(log), Int64(0))
    removeIfExists(root, recursive: true)
}

@Test
func slotsDuplicateActivateIsNoop() {
    let root = "core-slots-noop"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let slots = SlotRegistry(log)
    slots.register("sidebar-right", "panel")
    slots.activate("sidebar-right")
    slots.activate("sidebar-right")
    // 第二次 activate 走 noop 分支，只落 1 个 activate 事件。
    @Expect(slots.eventCount(log), Int64(2))
    removeIfExists(root, recursive: true)
}

@Test
func slotsEventsAreLogOnlyAcrossReplay() {
    let root = "core-slots-replay"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let slots = SlotRegistry(log)
    log.append("user/message", "开工")
    slots.register("sidebar-right", "panel")
    slots.activate("sidebar-right")
    @Expect(log.flush(), true)
    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    // 关键：slots/* 不进 surface——deriveMessages 只看到那一条 user/message。
    @Expect(fresh.deriveMessages().size, Int64(1))
    let replayed = SlotRegistry(fresh)
    @Expect(replayed.isRegistered("sidebar-right"), true)
    @Expect(replayed.isActivated("sidebar-right"), true)
    removeIfExists(root, recursive: true)
}
