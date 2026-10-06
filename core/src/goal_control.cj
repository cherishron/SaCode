package core
import stdx.encoding.json.*
import std.sync.*

// 有限用户控制面：完成不在此列，界面不能把自报结论当成完成证据。
public func isGoalControlMethod(method: String): Bool {
    return method == "goal/create" || method == "goal/edit" || method == "goal/pause" ||
        method == "goal/resume" || method == "goal/clear"
}

public func goalProjectionJson(log: SessionLog, activation!: GoalActivation = GoalActivation()): String {
    return synchronized(log.mtx) {
        let state = GoalService(log).snapshot()
        let scheduler = GoalScheduler(log, { => Int64(0) })
        let obj = JsonObject()
        obj.put("id", JsonString(state.id))
        obj.put("revision", JsonInt(state.revision))
        obj.put("phase", JsonString(state.phase))
        obj.put("objective", JsonString(state.objective))
        obj.put("blockedReason", JsonString(state.blockedReason))
        obj.put("roundsDone", JsonInt(scheduler.roundsDone()))
        obj.put("elapsedSeconds", JsonInt(scheduler.elapsedSeconds()))
        obj.put("noProgressStreak", JsonInt(scheduler.noProgressStreak()))
        // 续跑授权是活观测、不落盘：同一个 active 目标在重启前后 activation 不同，
        // 差别全在这一个字段里。少了它，前端只能显示「已启用」，把「不会自己跑」
        // 这件事说成反过来的样子。
        obj.put("activation", JsonString(activation.label()))
        obj.toString()
    }
}

public func controlGoalJson(log: SessionLog, method: String, expectedRevision: Int64, objective: String,
    activation!: GoalActivation = GoalActivation()): String {
    return synchronized(log.mtx) {
        if (!isGoalControlMethod(method)) { throw Exception("unknown-goal-action") }
        if ((method == "goal/create" || method == "goal/edit") &&
            (objective.trimAscii().size == 0 || objective.size > 8000)) { throw Exception("bad-goal-objective") }
        let svc = GoalService(log)
        // 授权随动词走，且只随这四个动词走：pause/clear 收回，create/resume 交还，
        // edit 不动（改了正文不等于要停掉续跑）。complete/blocked 由执行侧收口，
        // 那两条路径上 GoalService 自己把 phase 改掉，驱动在下一边界读到非 active 即停。
        if (method == "goal/create") { svc.create(objective); activation.arm() }
        else if (method == "goal/edit") { svc.edit(expectedRevision, objective) }
        else if (method == "goal/pause") { svc.pause(expectedRevision); activation.disarm() }
        else if (method == "goal/resume") { svc.resume(expectedRevision); activation.arm() }
        else { svc.clear(expectedRevision); activation.disarm() }
        goalProjectionJson(log, activation: activation)
    }
}