package core
import std.sync.*

// Goal 快照切片：保留修订 CAS 与四态；尚未完整复刻上游 UUID、轮数上限及结构化原因。
// 本地 id 是 `goal-<n>`、
// revision 是 CAS 值、phase 四态之一；本切片单 goal 场景 id 固定 `goal-1`，
// revision 由「日志里已出现的 goal/change 条数」派生（不重复编码到事件数据里）。
public class GoalSnapshot {
    public let id: String
    public let revision: Int64
    public let phase: String // "none" | "active" | "paused" | "blocked" | "complete"
    public let objective: String
    public let blockedReason: String
    public init(id: String, revision: Int64, phase: String, objective: String, blockedReason: String) {
        this.id = id
        this.revision = revision
        this.phase = phase
        this.objective = objective
        this.blockedReason = blockedReason
    }
}

// Goal 服务：每次变更都是 `goal/change` log-only 会话事件（不进 isSurfaceEvent 白名单）；
// 载荷为完整快照或 clear 墓碑。CAS：每次变更必须携带期望的旧 revision，
// 不匹配即抛且不落事件（日志不谎称改过）。
// 检查与追加共用会话锁，避免协议线程和执行线程同时用同一修订写入。
//
// 事件编码：`<phase>|<objective>|<blockedReason>`。objective / blockedReason 含 `|`
// 在写入处被拒（`bad-goal-content`），不是只当作约定；放开该限制需换长度前缀编码。
public class GoalService {
    let log: SessionLog

    public init(log: SessionLog) {
        this.log = log
    }

    // 核心边界也校验，不能只依赖桌面控制适配器。
    private static func objectiveText(value: String): String {
        let text = value.trimAscii()
        if (text.size == 0) { throw Exception("bad-goal-objective") }
        return text
    }

    private static func requirePhase(current: GoalSnapshot, allowed: Array<String>): Unit {
        if (!allowed.contains(current.phase)) { throw Exception("invalid-goal-transition") }
    }

    private static func encode(phase: String, objective: String, blockedReason: String): String {
        // `|` 是本事件的字段分隔符：内容里带上它，读回来的就不是写进去的那件事
        // （objective 会被截断、blockedReason 错位成别的字段）。写边界当场拒。
        if ((objective.indexOf("|") ?? -1) >= 0 || (blockedReason.indexOf("|") ?? -1) >= 0) {
            throw Exception("bad-goal-content")
        }
        return "${phase}|${objective}|${blockedReason}"
    }

    private static func decode(data: String, revision: Int64): GoalSnapshot {
        let fields = data.split("|")
        if (fields.size < 3) {
            return GoalSnapshot("goal-1", revision, "none", "", "")
        }
        return GoalSnapshot("goal-1", revision, fields[0], fields[1], fields[2])
    }

    // 回放最后一条 goal/change；从未落过事件返回空快照（phase="none"、revision=0）。
    public func snapshot(): GoalSnapshot {
        var lastData = ""
        var count = Int64(0)
        for (event in log.snapshotEvents()) {
            if (event.eventType == "goal/change") {
                lastData = event.data
                count += Int64(1)
            }
        }
        if (count == 0) {
            return GoalSnapshot("goal-1", Int64(0), "none", "", "")
        }
        return GoalService.decode(lastData, count)
    }

    private func cas(expected: Int64): GoalSnapshot {
        let current = snapshot()
        if (current.phase == "none") {
            throw Exception("no-active-goal")
        }
        if (current.revision != expected) {
            throw Exception("stale-goal-revision")
        }
        return current
    }

    // 建立：仅当当前没有 active/paused/blocked 目标时可创建；complete 与 none 都放行。
    public func create(objective: String): GoalSnapshot {
        return synchronized(log.mtx) {
            let current = snapshot()
            if (current.phase == "active" || current.phase == "paused" || current.phase == "blocked") {
                throw Exception("goal-already-exists")
            }
            let text = GoalService.objectiveText(objective)
            log.append("goal/change", GoalService.encode("active", text, ""))
            GoalSnapshot("goal-1", current.revision + 1, "active", text, "")
        }
    }

    public func edit(expected: Int64, objective: String): GoalSnapshot {
        return synchronized(log.mtx) {
            let current = cas(expected)
            let text = GoalService.objectiveText(objective)
            log.append("goal/change", GoalService.encode(current.phase, text, current.blockedReason))
            GoalSnapshot(current.id, current.revision + 1, current.phase, text, current.blockedReason)
        }
    }

    public func pause(expected: Int64): GoalSnapshot {
        return synchronized(log.mtx) {
            let current = cas(expected)
            GoalService.requirePhase(current, ["active"])
            log.append("goal/change", GoalService.encode("paused", current.objective, ""))
            GoalSnapshot(current.id, current.revision + 1, "paused", current.objective, "")
        }
    }

    public func resume(expected: Int64): GoalSnapshot {
        return synchronized(log.mtx) {
            let current = cas(expected)
            GoalService.requirePhase(current, ["active", "paused", "blocked"])
            log.append("goal/change", GoalService.encode("active", current.objective, ""))
            GoalSnapshot(current.id, current.revision + 1, "active", current.objective, "")
        }
    }

    public func complete(expected: Int64): GoalSnapshot {
        return synchronized(log.mtx) {
            let current = cas(expected)
            GoalService.requirePhase(current, ["active", "paused", "blocked"])
            log.append("goal/change", GoalService.encode("complete", current.objective, ""))
            GoalSnapshot(current.id, current.revision + 1, "complete", current.objective, "")
        }
    }

    public func block(expected: Int64, reason: String): GoalSnapshot {
        return synchronized(log.mtx) {
            let current = cas(expected)
            GoalService.requirePhase(current, ["active"])
            let text = reason.trimAscii()
            if (text.size == 0) { throw Exception("bad-goal-block-reason") }
            log.append("goal/change", GoalService.encode("blocked", current.objective, text))
            GoalSnapshot(current.id, current.revision + 1, "blocked", current.objective, text)
        }
    }

    public func clear(expected: Int64): Unit {
        synchronized(log.mtx) {
            let current = cas(expected)
            log.append("goal/change", GoalService.encode("none", "", ""))
        }
    }
}
