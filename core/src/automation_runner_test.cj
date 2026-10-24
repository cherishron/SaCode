package core

import std.collection.*
import std.fs.*
import std.unittest.*

// F13-E 编排契约的离线语义：无执行器 fail-closed 不写准入；有执行器时按
// 持久准入→派发→登记 runRef 的顺序走，派发失败留 unknown 屏障。

class AutomationRunTestDispatcher <: AutomationRunDispatcher {
    let result: ?String
    let calls = ArrayList<String>()
    init(result: ?String) { this.result = result }
    public func dispatch(triggerKey: String, taskId: String, definitionDigest: String): ?String {
        calls.add(taskId); return result
    }
}

@Test
func automationRunCoordinatorFailsClosedWithoutDispatcher() {
    let root = coreTestDirCreated("core-auto-run-nodisp")
    try {
        let log = AutomationTriggerLog("${root}/run.log")
        @Expect(log.open(), true)
        let coord = AutomationRunCoordinator(log)
        @Expect(coord.available(), false)
        let intent = AutomationTriggerIntent("task-1", "user", 1, "manual", "req-1", 6000)
        @Expect(coord.trigger(intent, "digest"), "automation-executor-unavailable")
        // 无执行器时绝不写准入事实，避免累积无主 unknown。
        @Expect(log.statusOf(intent.triggerKey), "")
        @Expect(log.hasOpenTrigger("task-1"), false)
        @Expect(log.close(), true)
    } finally { removeIfExists(root, recursive: true) }
}

@Test
func automationRunCoordinatorDispatchesAfterDurableAdmission() {
    let root = coreTestDirCreated("core-auto-run-dispatch")
    try {
        let log = AutomationTriggerLog("${root}/run.log")
        @Expect(log.open(), true)
        let dispatcher = AutomationRunTestDispatcher("run-1")
        let coord = AutomationRunCoordinator(log, dispatcher: dispatcher)
        let intent = AutomationTriggerIntent("task-1", "user", 1, "manual", "req-1", 6000)
        @Expect(coord.trigger(intent, "digest"), "dispatched")
        @Expect(log.statusOf(intent.triggerKey), "dispatched")
        @Expect(dispatcher.calls.size, Int64(1))
        // 同键再次触发是幂等命中，不二次派发。
        @Expect(coord.trigger(intent, "digest"), "dispatched")
        @Expect(dispatcher.calls.size, Int64(1))
        @Expect(log.close(), true)
    } finally { removeIfExists(root, recursive: true) }
}

@Test
func automationRunCoordinatorUnstartedRunLeavesUnknownBarrier() {
    let root = coreTestDirCreated("core-auto-run-unknown")
    try {
        let log = AutomationTriggerLog("${root}/run.log")
        @Expect(log.open(), true)
        let coord = AutomationRunCoordinator(log, dispatcher: AutomationRunTestDispatcher(None))
        let intent = AutomationTriggerIntent("task-1", "user", 1, "manual", "req-1", 6000)
        @Expect(coord.trigger(intent, "digest"), "unknown")
        @Expect(log.statusOf(intent.triggerKey), "unknown")
        @Expect(log.hasOpenTrigger("task-1"), true)
        @Expect(log.close(), true)
    } finally { removeIfExists(root, recursive: true) }
}