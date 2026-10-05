package core
import stdx.encoding.json.*
import std.sync.*

// 有限用户控制面：完成不在此列，界面不能把自报结论当成完成证据。
public func isGoalControlMethod(method: String): Bool {
    return method == "goal/create" || method == "goal/edit" || method == "goal/pause" ||
        method == "goal/resume" || method == "goal/clear"
}

public func goalProjectionJson(log: SessionLog): String {
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
        obj.toString()
    }
}

public func controlGoalJson(log: SessionLog, method: String, expectedRevision: Int64, objective: String): String {
    return synchronized(log.mtx) {
        if (!isGoalControlMethod(method)) { throw Exception("unknown-goal-action") }
        if ((method == "goal/create" || method == "goal/edit") &&
            (objective.trimAscii().size == 0 || objective.size > 8000)) { throw Exception("bad-goal-objective") }
        let svc = GoalService(log)
        if (method == "goal/create") { svc.create(objective) }
        else if (method == "goal/edit") { svc.edit(expectedRevision, objective) }
        else if (method == "goal/pause") { svc.pause(expectedRevision) }
        else if (method == "goal/resume") { svc.resume(expectedRevision) }
        else { svc.clear(expectedRevision) }
        goalProjectionJson(log)
    }
}
