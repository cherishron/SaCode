package core

// Stub: GoalClaim — 满足 agent.cj 编译引用
public class GoalClaim {
    public init(log: SessionLog) {}
    public func recordStatus(goalId: String, revision: Int64, status: String): Bool { return true }
}

public func goalUpdateToolSpec(): ToolSpec {
    return ToolSpec("goal/update", "Update goal status", "{}", false)
}
