package core

import std.fs.*
import std.unittest.*

// 只验证「持久触发准入」核心切片的离线语义：幂等、overlap-skip、准入失败零派发、
// 恢复 unknown 屏障、misfire 水位与 Cron 边界。不涉及模型/命令/网络，不制造成功历史。

func automationTriggerTestError(action: () -> Unit): String {
    var message = ""
    try { action() } catch (e: Exception) { message = e.message }
    return message
}

@Test
func automationTriggerKeyIsStableAndOccurrenceScoped() {
    let a = AutomationTriggerIntent("task-1", "user", 1, "schedule", "100", 6000)
    let b = AutomationTriggerIntent("task-1", "user", 2, "schedule", "100", 6000)
    let c = AutomationTriggerIntent("task-1", "user", 1, "schedule", "101", 6060)
    let manual = AutomationTriggerIntent("task-1", "user", 1, "manual", "req-1", 6000)
    // 内容修订（definitionRevision 变化）不改变同一逻辑触发的键。
    @Expect(a.triggerKey, b.triggerKey)
    @Expect(a.triggerKey == c.triggerKey, false)
    @Expect(a.triggerKey == manual.triggerKey, false)
    @Expect(automationTriggerTestError({=> AutomationTriggerIntent("bad id", "user", 1, "schedule", "1", 0); () }),
        "automation-trigger-bad-intent")
    @Expect(automationTriggerTestError({=> AutomationTriggerIntent("task-1", "user", 1, "weird", "1", 0); () }),
        "automation-trigger-bad-intent")
}

@Test
func automationTriggerAdmissionIsIdempotentPerKey() {
    let root = coreTestDirCreated("core-auto-trigger-dup")
    try {
        let log = AutomationTriggerLog("${root}/run.log")
        @Expect(log.open(), true)
        let first = log.admit(AutomationTriggerIntent("task-1", "user", 1, "schedule", "100", 6000))
        @Expect(first.admitted, true); @Expect(first.state, "admitted"); @Expect(first.reason, "")
        // 同键重入返回同一记录，不产生第二个派发。
        let second = log.admit(AutomationTriggerIntent("task-1", "user", 1, "schedule", "100", 6000))
        @Expect(second.admitted, false); @Expect(second.state, "admitted"); @Expect(second.reason, "duplicate-trigger")
        @Expect(log.close(), true)
    } finally { removeIfExists(root, recursive: true) }
}

@Test
func automationTriggerOverlapIsSkippedNotQueued() {
    let root = coreTestDirCreated("core-auto-trigger-overlap")
    try {
        let log = AutomationTriggerLog("${root}/run.log")
        @Expect(log.open(), true)
        @Expect(log.admit(AutomationTriggerIntent("task-1", "user", 1, "schedule", "100", 6000)).state, "admitted")
        let overlap = log.admit(AutomationTriggerIntent("task-1", "user", 1, "schedule", "101", 6060))
        @Expect(overlap.state, "skipped"); @Expect(overlap.admitted, false); @Expect(overlap.reason, "overlap-skip")
        @Expect(log.hasOpenTrigger("task-1"), true)
        // 另一 task 不受影响。
        @Expect(log.admit(AutomationTriggerIntent("task-2", "user", 1, "schedule", "101", 6060)).state, "admitted")
        @Expect(log.close(), true)
    } finally { removeIfExists(root, recursive: true) }
}

@Test
func automationTriggerDispatchThenSettleClearsOpenRun() {
    let root = coreTestDirCreated("core-auto-trigger-settle")
    try {
        let log = AutomationTriggerLog("${root}/run.log")
        @Expect(log.open(), true)
        let intent = AutomationTriggerIntent("task-1", "user", 1, "schedule", "100", 6000)
        @Expect(log.admit(intent).state, "admitted")
        // 未派发不能直接结算。
        @Expect(automationTriggerTestError({=> log.settle(intent.triggerKey, "succeeded", ""); () }),
            "automation-trigger-bad-transition")
        log.markDispatched(intent.triggerKey, "run-1")
        @Expect(log.statusOf(intent.triggerKey), "dispatched")
        log.settle(intent.triggerKey, "succeeded", "exit-0")
        @Expect(log.statusOf(intent.triggerKey), "succeeded")
        @Expect(log.hasOpenTrigger("task-1"), false)
        // 结算后同 task 可再开新 occurrence 的准入。
        @Expect(log.admit(AutomationTriggerIntent("task-1", "user", 1, "schedule", "101", 6060)).state, "admitted")
        @Expect(log.close(), true)
    } finally { removeIfExists(root, recursive: true) }
}

@Test
func automationTriggerRecoveryMarksUnsettledUnknownAndBlocksReplay() {
    let root = coreTestDirCreated("core-auto-trigger-recover")
    try {
        let path = "${root}/run.log"
        let first = AutomationTriggerLog(path)
        @Expect(first.open(), true)
        let intent = AutomationTriggerIntent("task-1", "user", 1, "schedule", "100", 6000)
        @Expect(first.admit(intent).state, "admitted")
        first.markDispatched(intent.triggerKey, "run-1")
        @Expect(first.close(), true)
        // 崩溃重开：dispatched 未结算 → unknown 屏障，禁止自动重发。
        let reopened = AutomationTriggerLog(path)
        @Expect(reopened.open(), true)
        @Expect(reopened.statusOf(intent.triggerKey), "unknown")
        let again = reopened.admit(intent)
        @Expect(again.admitted, false); @Expect(again.state, "unknown")
        @Expect(reopened.hasOpenTrigger("task-1"), true)
        @Expect(reopened.close(), true)
    } finally { removeIfExists(root, recursive: true) }
}

@Test
func automationTriggerSingleOwnerLeaseAndNotOwnedGuard() {
    let root = coreTestDirCreated("core-auto-trigger-lease")
    try {
        let path = "${root}/run.log"
        let first = AutomationTriggerLog(path)
        let second = AutomationTriggerLog(path)
        // 未 open 不得准入。
        @Expect(automationTriggerTestError({=> first.admit(AutomationTriggerIntent("task-1", "user", 1, "schedule", "1", 0)); () }),
            "automation-trigger-not-owned")
        @Expect(first.open(), true)
        @Expect(second.open(), false)
        @Expect(first.close(), true)
        @Expect(second.open(), true)
        @Expect(second.close(), true)
    } finally { removeIfExists(root, recursive: true) }
}

@Test
func automationTriggerWatermarkCountsMissedSkippedMinutes() {
    let root = coreTestDirCreated("core-auto-trigger-watermark")
    try {
        let log = AutomationTriggerLog("${root}/run.log")
        @Expect(log.open(), true)
        // 首次推进只是建立水位，不算错过。
        @Expect(log.advanceWatermark("task-1", 100), Int64(0))
        @Expect(log.watermarkOf("task-1"), Int64(100))
        // 之后每跳过一分钟记一次错过（misfire=skip，不补跑）。
        @Expect(log.advanceWatermark("task-1", 105), Int64(4))
        @Expect(log.missedOf("task-1"), Int64(4))
        // 墙钟回退不推进、不重发。
        @Expect(log.advanceWatermark("task-1", 104), Int64(4))
        @Expect(log.watermarkOf("task-1"), Int64(105))
        @Expect(log.close(), true)
    } finally { removeIfExists(root, recursive: true) }
}

@Test
func automationTriggerCronMatchesByUtcMinute() {
    // 1970-01-01 00:00 UTC = minute 0。
    @Expect(automationTriggerCronMatches("0 0 * * *", "UTC", 0), true)
    @Expect(automationTriggerCronMatches("* * * * *", "UTC", 6000), true)
    // 6000 分钟 = 4 天 4 小时，不是 00:00，定点 cron 不命中。
    @Expect(automationTriggerCronMatches("0 0 * * *", "UTC", 6000), false)
    // 非法 cron 复用严格校验，缺字段必须显式报错，不静默变成“从不触发”。
    @Expect(automationTriggerTestError({=> automationTriggerCronMatches("0 0 * *", "UTC", 0); () }), "automation-bad-cron")
}