package core
import std.fs.*
import std.unittest.*

// 恢复授权（上游 goal 的 activation）。四条口径各钉一条：
// 默认 disarmed；arm/disarm 互为逆；create/resume 交还授权、pause/clear 收回、edit 不动；
// 授权永不落盘——重启后的实例仍是 disarmed，尽管回放出 active phase。

// 默认不授权：新建实例就是「没人点过恢复」，驱动据此不开轮。
@Test
func activationStartsDisarmedAndLabelIsExact() {
    let activation = GoalActivation()
    @Expect(activation.isArmed(), false)
    @Expect(activation.label(), "disarmed")
    activation.arm()
    @Expect(activation.isArmed(), true)
    @Expect(activation.label(), "armed")
    activation.disarm()
    @Expect(activation.isArmed(), false)
    @Expect(activation.label(), "disarmed")
}

// 授权不是可持久化状态：日志里一个字节都不写，重启后的实例回到 disarmed。
// 这是「重启后 active 目标不会自己续跑」的全部机制——落盘就等于默认自动续跑。
@Test
func activationIsNeverPersistedIntoSessionLog() {
    let path = "core-goal-activation.log"
    removeIfExists(path, recursive: false)
    let log = SessionLog(path)
    let activation = GoalActivation()
    activation.arm()
    @Expect(log.eventCount(), Int64(0))
    activation.disarm()
    @Expect(log.eventCount(), Int64(0))
    @Expect(log.flush(), true)
    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    @Expect(fresh.eventCount(), Int64(0))
    // 「重启」= 新进程里的新实例；回放没有任何东西能让它变成 armed。
    @Expect(GoalActivation().isArmed(), false)
    removeIfExists(path, recursive: false)
}

// 动词与授权的对应：create/resume 交还，pause/clear 收回，edit 不动。
@Test
func controlArmsOnlyCreateAndResume() {
    let path = "core-goal-activation-control.log"
    removeIfExists(path, recursive: false)
    let log = SessionLog(path)
    let activation = GoalActivation()
    // create 之后即 armed：那是人显式下的目标。
    let created = controlGoalJson(log, "goal/create", Int64(0), "持续推进", activation: activation)
    @Expect(created.contains("\"activation\":\"armed\""), true)
    // edit 改的是正文，不该顺手把续跑收回来。
    _ = controlGoalJson(log, "goal/edit", Int64(1), "改写后的目标", activation: activation)
    @Expect(activation.isArmed(), true)
    // pause 收回授权。
    let paused = controlGoalJson(log, "goal/pause", Int64(2), "", activation: activation)
    @Expect(paused.contains("\"activation\":\"disarmed\""), true)
    @Expect(activation.isArmed(), false)
    // resume 交还——包括「active 但 disarmed」这种从恢复里回来的目标。
    let resumed = controlGoalJson(log, "goal/resume", Int64(3), "", activation: activation)
    @Expect(resumed.contains("\"activation\":\"armed\""), true)
    @Expect(activation.isArmed(), true)
    // clear 收回。
    let cleared = controlGoalJson(log, "goal/clear", Int64(4), "", activation: activation)
    @Expect(cleared.contains("\"activation\":\"disarmed\""), true)
    @Expect(activation.isArmed(), false)
    removeIfExists(path, recursive: false)
}

// 读面也要带 activation：不带它，前端只能显示「已启用」，把「不会自己跑」说反。
@Test
func goalProjectionCarriesActivation() {
    let path = "core-goal-activation-projection.log"
    removeIfExists(path, recursive: false)
    let log = SessionLog(path)
    GoalService(log).create("投影要带授权")
    let disarmed = GoalActivation()
    @Expect(goalProjectionJson(log, activation: disarmed).contains("\"activation\":\"disarmed\""), true)
    let armed = GoalActivation()
    armed.arm()
    @Expect(goalProjectionJson(log, activation: armed).contains("\"activation\":\"armed\""), true)
    removeIfExists(path, recursive: false)
}