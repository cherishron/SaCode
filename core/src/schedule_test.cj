package core
import std.collection.*
import std.fs.*
import std.unittest.*

@Test
func scheduleTaskRegisterPersistsDefinition() {
    let root = "core-sched-task-reg"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let sc = ScheduleStore(log)
    sc.registerTask("nightly", "0 0 * * *", "run nightly backup", false, 86400 * 7, "", "", "")
    let tasks = sc.listTasks()
    @Expect(tasks.size, Int64(1))
    @Expect(tasks[0].id, "nightly")
    @Expect(tasks[0].cron, "0 0 * * *")
    @Expect(tasks[0].prompt, "run nightly backup")
    @Expect(tasks[0].active, true)
    removeIfExists(root, recursive: true)
}

@Test
func scheduleTaskPauseAndResume() {
    let root = "core-sched-task-pause"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let sc = ScheduleStore(log)
    sc.registerTask("nightly", "0 0 * * *", "backup", false, 0, "", "", "")
    sc.pauseTask("nightly")
    let tasks1 = sc.listTasks()
    @Expect(tasks1[0].active, false)
    sc.resumeTask("nightly")
    let tasks2 = sc.listTasks()
    @Expect(tasks2[0].active, true)
    removeIfExists(root, recursive: true)
}

@Test
func scheduleTaskDeleteRemovesFromList() {
    let root = "core-sched-task-del"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let sc = ScheduleStore(log)
    sc.registerTask("nightly", "0 0 * * *", "backup", false, 0, "", "", "")
    sc.deleteTask("nightly")
    @Expect(sc.listTasks().size, Int64(0))
    removeIfExists(root, recursive: true)
}

@Test
func scheduleFireRecordsExecution() {
    let root = "core-sched-fire-rec"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let sc = ScheduleStore(log)
    sc.registerTask("nightly", "0 0 * * *", "backup", false, 0, "", "", "")
    let fireId = sc.recordFire("nightly", 1234567890)
    @Expect(sc.hasPendingFire("nightly"), true)
    sc.updateFireResult(fireId, "done", "completed at 1234567890")
    @Expect(sc.hasPendingFire("nightly"), false)
    let hist = sc.fireHistory("nightly")
    @Expect(hist.size, Int64(1))
    @Expect(hist[0].status, "done")
    removeIfExists(root, recursive: true)
}

@Test
func scheduleDueTasksReturnsOnlyActiveWithoutPending() {
    let root = "core-sched-due"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let sc = ScheduleStore(log)
    sc.registerTask("nightly", "0 0 * * *", "backup", false, 0, "", "", "")
    let due = sc.dueTasks(0, 0, 15, 6, 2)
    @Expect(due.size, Int64(1))
    @Expect(due[0], "nightly")
    sc.recordFire("nightly", 1)
    let due2 = sc.dueTasks(0, 0, 15, 6, 2)
    @Expect(due2.size, Int64(0))
    removeIfExists(root, recursive: true)
}

@Test
func testScheduleFireReturnsHookResult() {
    let root = "core-sched-fire-hook"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let sc = ScheduleStore(log)
    sc.registerTask("nightly", "0 0 * * *", "backup", false, 0, "", "", "")
    let result = sc.fire("d1", "nightly")
    assert(result != null)
    assert(result.decision == HookDecision.Allow)
    removeIfExists(root, recursive: true)
}