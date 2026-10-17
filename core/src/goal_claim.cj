package core
import stdx.encoding.json.*
import std.convert.*

// 声明是日志事实，不直接完成目标；必须另有同修订、同轮次的机械证据。
let GOAL_CLAIM_EVENT = "goal/claim"
public class GoalClaim {
    let log: SessionLog
    public init(log: SessionLog) { this.log = log }

    // 开轮到结算之间才接声明。编辑、暂停、删除会使旧轮的声明失效。
    private func openRevision(): Int64 {
        var revision = Int64(0)
        for (event in log.snapshotEvents()) {
            if (event.eventType == ROUND_START_EVENT) {
                try { revision = Int64.parse(event.data) } catch (_: Exception) { revision = 0 }
            } else if (event.eventType == "goal/round" || event.eventType == "goal/change") {
                revision = 0
            }
        }
        return revision
    }
    public func record(goalId: String, revision: Int64): Bool {
        return recordStatus(goalId, revision, "completed")
    }
    public func recordStatus(goalId: String, revision: Int64, status: String): Bool {
        var written = false
        synchronized(log.mtx) {
            let current = GoalService(log).snapshot()
            if (current.id == goalId && current.phase == "active" && current.revision == revision &&
                revision > 0 && openRevision() == revision && (status == "completed" || status == "in_progress")) {
                let round = GoalScheduler(log, { => Int64(0) }).roundsAdmitted()
                let obj = JsonObject()
                obj.put("goal_id", JsonString(goalId))
                obj.put("revision", JsonInt(revision))
                obj.put("round", JsonInt(round))
                obj.put("status", JsonString(status))
                log.append(GOAL_CLAIM_EVENT, obj.toString())
                written = true
            }
        }
        return written
    }
    // 同轮最后一次声明为准；in_progress 撤回 completed，不挪用上一轮。
    public func claimedFor(revision: Int64, round: Int64): Bool {
        var claimed = false
        for (event in log.snapshotEvents()) {
            if (event.eventType != GOAL_CLAIM_EVENT) { continue }
            try {
                let obj = JsonValue.fromStr(event.data).asObject()
                if (obj.get("goal_id").getOrThrow().asString().getValue() == "goal-1" &&
                    obj.get("revision").getOrThrow().asInt().getValue() == revision &&
                    obj.get("round").getOrThrow().asInt().getValue() == round) {
                    claimed = obj.get("status").getOrThrow().asString().getValue() == "completed"
                }
            } catch (_: Exception) { /* 损坏记录不作为完成声明。 */ }
        }
        return claimed
    }
}

public func goalUpdateToolSpec(): ToolSpec {
    return ToolSpec("update_goal", "声明当前目标完成或仍在进行；完成须有同轮工具证据，声明不会单独完成目标。",
        "{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"goal_id\",\"status\"],\"properties\":{\"goal_id\":{\"type\":\"string\",\"minLength\":1},\"status\":{\"type\":\"string\",\"enum\":[\"completed\",\"in_progress\"]}}}", false)
}
