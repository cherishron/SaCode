package core
import std.collection.*
import std.fs.*
import std.unittest.*

// 定时任务上游契约（M3）：`ctx.schedule.register(id, cronSpec)` 落 `schedule/task`
// 事件；`pause(id)` 软删（active=false）；`fire(deliveryId, taskId)` 按任务 id
// 匹配且只命中 active 者。本切片以 log-only `schedule/task` + `schedule/fire`
// 事件近似；沿用 webhook 的 `active: Bool` 软删避开 ArrayList.removeAt 陷阱。

@Test
func scheduleRegisterAndFireMatchesActive() {
    let root = "core-sched-fire"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let sc = ScheduleStore(log)
    sc.register("nightly", "0 0 * * *")
    sc.register("weekly", "0 0 * * 1")
    @Expect(sc.fire("d1", "nightly"), Int64(1))
    removeIfExists(root, recursive: true)
}

@Test
func schedulePauseExcludesFromFire() {
    let root = "core-sched-pause"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let sc = ScheduleStore(log)
    sc.register("nightly", "0 0 * * *")
    sc.pause("nightly")
    @Expect(sc.fire("d1", "nightly"), Int64(0))
    removeIfExists(root, recursive: true)
}

@Test
func scheduleFireUnknownTaskZeroMatches() {
    let root = "core-sched-unknown"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let sc = ScheduleStore(log)
    sc.register("nightly", "0 0 * * *")
    @Expect(sc.fire("d1", "ghost"), Int64(0))
    removeIfExists(root, recursive: true)
}

@Test
func scheduleEventsAreLogOnlyAcrossReplay() {
    let root = "core-sched-replay"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let sc = ScheduleStore(log)
    log.append("user/message", "开工")
    sc.register("nightly", "0 0 * * *")
    @Expect(log.flush(), true)
    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    @Expect(fresh.deriveMessages().size, Int64(1))
    @Expect(ScheduleStore(fresh).countActive(), Int64(1))
    removeIfExists(root, recursive: true)
}
