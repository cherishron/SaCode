package core
import std.collection.*

// 工作流 ledger：log-only `workflow/step` 事件承载 `start::<id>::<label>` /
// `done::<id>` / `fail::<id>::<reason>`；`status(id)` 从事件流回放得到终态。
// 状态机：pending → running → {done | failed}；done/failed 都是终态不可逆。

class WfStep {
    let id: String
    var statusValue: String
    init(id: String, statusValue: String) {
        this.id = id
        this.statusValue = statusValue
    }
}

public class WorkflowLedger {
    let log: SessionLog
    let steps = ArrayList<WfStep>()
    let hookRegistry: HookRegistry

    public init(log: SessionLog, hookRegistry!: HookRegistry = HookRegistry()) {
        this.log = log
        this.hookRegistry = hookRegistry
        for (event in log.snapshotEvents()) {
            if (event.eventType != "workflow/step") {
                continue
            }
            let body = event.data
            if (body.startsWith("start::")) {
                let rest = body[7..body.size]
                let idx = rest.indexOf("::") ?? Int64(-1)
                let id = if (idx < 0) { rest } else { rest[0..idx] }
                steps.add(WfStep(id, "running"))
            } else if (body.startsWith("done::")) {
                let id = body[6..body.size]
                let i = indexOf(id)
                if (i >= 0 && steps[i].statusValue == "running") {
                    steps[i].statusValue = "done"
                }
            } else if (body.startsWith("fail::")) {
                let rest = body[6..body.size]
                let idx = rest.indexOf("::") ?? Int64(-1)
                let id = if (idx < 0) { rest } else { rest[0..idx] }
                let i = indexOf(id)
                if (i >= 0 && steps[i].statusValue == "running") {
                    steps[i].statusValue = "failed"
                }
            }
        }
    }

    public func start(id: String, label: String): HookResult {
        if (id.size == 0) {
            throw Exception("workflow-empty-id")
        }
        if (indexOf(id) >= 0) {
            throw Exception("workflow-duplicate-id")
        }
        let input = HookInput(
            sessionId: "",
            transcriptPath: "",
            cwd: "",
            hookEventName: "WorkflowStepStart",
            timestamp: 0,
            eventSpecific: HookEventData.WorkflowStep(id, label, Option.none<String>())
        )
        let result = hookRegistry.dispatch(HookEvent.WorkflowStepStart, input, id)
        if (result.decision != HookDecision.Allow) {
            return result
        }
        log.append("workflow/step", "start::${id}::${label}")
        steps.add(WfStep(id, "running"))
        return result
    }

    public func done(id: String): HookResult {
        let i = indexOf(id)
        if (i < 0) {
            throw Exception("workflow-unknown-id")
        }
        if (steps[i].statusValue != "running") {
            throw Exception("workflow-terminal")
        }
        let input = HookInput(
            sessionId: "",
            transcriptPath: "",
            cwd: "",
            hookEventName: "WorkflowStepDone",
            timestamp: 0,
            eventSpecific: HookEventData.WorkflowStep(id, "", Option.none<String>())
        )
        let result = hookRegistry.dispatch(HookEvent.WorkflowStepDone, input, id)
        if (result.decision != HookDecision.Allow) {
            return result
        }
        log.append("workflow/step", "done::${id}")
        steps[i].statusValue = "done"
        return result
    }

    public func fail(id: String, reason: String): HookResult {
        let i = indexOf(id)
        if (i < 0) {
            throw Exception("workflow-unknown-id")
        }
        if (steps[i].statusValue != "running") {
            throw Exception("workflow-terminal")
        }
        let input = HookInput(
            sessionId: "",
            transcriptPath: "",
            cwd: "",
            hookEventName: "WorkflowStepFail",
            timestamp: 0,
            eventSpecific: HookEventData.WorkflowStep(id, "", Option.some(reason))
        )
        let result = hookRegistry.dispatch(HookEvent.WorkflowStepFail, input, id)
        if (result.decision != HookDecision.Allow) {
            return result
        }
        log.append("workflow/step", "fail::${id}::${reason}")
        steps[i].statusValue = "failed"
        return result
    }

    public func status(id: String): String {
        let i = indexOf(id)
        if (i < 0) {
            throw Exception("workflow-unknown-id")
        }
        return steps[i].statusValue
    }

    private func indexOf(id: String): Int64 {
        var i: Int64 = 0
        while (i < Int64(steps.size)) {
            if (steps[i].id == id) {
                return i
            }
            i = i + 1
        }
        return Int64(-1)
    }
}
