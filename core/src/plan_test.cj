package core
import std.fs.*
import std.unittest.*

// Plan mode 上游契约（87 行）：`plan/mode { active: boolean }` 是 log-only 全值替换的
// 会话事件——持久、可回放、不进模型 transcript。`set(active)` 只在实际状态变化时落
// 事件（同值 noop 不留痕迹），`get()` 取回放后最后一条。

@Test
func planModeRoundTripReplayableAndNotInSurface() {
    let root = "core-plan-roundtrip"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let controller = PlanModeController(log)
    log.append("user/message", "先聊一句")
    @Expect(controller.active(), false)
    @Expect(controller.set(true), "committed")
    @Expect(controller.active(), true)
    @Expect(log.flush(), true)

    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    @Expect(PlanModeController(fresh).active(), true)
    // log-only：模型历史只看到那一条 user/message。
    @Expect(fresh.deriveMessages().size, Int64(1))
    removeIfExists(root, recursive: true)
}

@Test
func planModeSameValueIsNoopWithoutAppending() {
    let root = "core-plan-noop"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let controller = PlanModeController(log)
    @Expect(controller.set(true), "committed")
    @Expect(controller.set(true), "noop")
    @Expect(controller.set(false), "committed")
    @Expect(controller.set(false), "noop")
    // 只有实际状态变化才落事件——两次 noop 不产生事件。
    @Expect(log.snapshotEvents().size, Int64(2))
    removeIfExists(root, recursive: true)
}

@Test
func planModeDefaultsToInactiveWhenNoEvents() {
    let root = "core-plan-empty"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    @Expect(PlanModeController(log).active(), false)
    removeIfExists(root, recursive: true)
}
