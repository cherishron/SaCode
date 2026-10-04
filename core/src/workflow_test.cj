package core
import std.collection.*
import std.fs.*
import std.unittest.*

// 工作流上游契约（M7）：`ctx.workflow` 提供多步任务的编排；每一步有 pending/
// running/done/failed 状态。本切片以 log-only `workflow/step` 事件承载
// `start::<id>::<label>` / `done::<id>` / `fail::<id>::<reason>`；`status(id)`
// 依事件序回放得到终态。

@Test
func workflowStepStartThenDone() {
    let root = "core-wf-happy"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let wf = WorkflowLedger(log)
    wf.start("s1", "解析")
    @Expect(wf.status("s1"), "running")
    wf.done("s1")
    @Expect(wf.status("s1"), "done")
    removeIfExists(root, recursive: true)
}

@Test
func workflowStepFailThenTerminal() {
    let root = "core-wf-fail"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let wf = WorkflowLedger(log)
    wf.start("s1", "解析")
    wf.fail("s1", "boom")
    @Expect(wf.status("s1"), "failed")
    // 终态不可逆：done 应拒绝。
    var threw = false
    try {
        wf.done("s1")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    removeIfExists(root, recursive: true)
}

@Test
func workflowUnknownIdRejected() {
    let root = "core-wf-unknown"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let wf = WorkflowLedger(log)
    var threwStatus = false
    try {
        wf.status("ghost")
    } catch (e: Exception) {
        threwStatus = true
    }
    @Expect(threwStatus, true)
    var threwDone = false
    try {
        wf.done("ghost")
    } catch (e: Exception) {
        threwDone = true
    }
    @Expect(threwDone, true)
    removeIfExists(root, recursive: true)
}

@Test
func workflowEventsAreLogOnlyAcrossReplay() {
    let root = "core-wf-replay"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let wf = WorkflowLedger(log)
    log.append("user/message", "开工")
    wf.start("s1", "解析")
    wf.done("s1")
    @Expect(log.flush(), true)
    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    @Expect(fresh.deriveMessages().size, Int64(1))
    @Expect(WorkflowLedger(fresh).status("s1"), "done")
    removeIfExists(root, recursive: true)
}
