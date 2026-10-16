package core
import std.collection.*
import std.fs.*
import std.unittest.*
import stdx.encoding.json.*

@Test
func scheduleTaskRegisterPersistsDefinition() {
    let root = coreTestDirCreated("core-sched-task-reg")
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
    let root = coreTestDirCreated("core-sched-task-pause")
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
    let root = coreTestDirCreated("core-sched-task-del")
    let log = SessionLog("${root}/session.log")
    let sc = ScheduleStore(log)
    sc.registerTask("nightly", "0 0 * * *", "backup", false, 0, "", "", "")
    sc.deleteTask("nightly")
    @Expect(sc.listTasks().size, Int64(0))
    removeIfExists(root, recursive: true)
}

@Test
func scheduleFireRecordsExecution() {
    let root = coreTestDirCreated("core-sched-fire-rec")
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
    let root = coreTestDirCreated("core-sched-due")
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
    let root = coreTestDirCreated("core-sched-fire-hook")
    let log = SessionLog("${root}/session.log")
    let sc = ScheduleStore(log)
    sc.registerTask("nightly", "0 0 * * *", "backup", false, 0, "", "", "")
    let result = sc.fire("d1", "nightly")
    @Expect(result.decision, HookDecision.Allow)
    removeIfExists(root, recursive: true)
}

@Test
func scheduleStructuredDefinitionPersistsAndReplaysMetadata() {
    let root = coreTestDirCreated("core-sched-structured")
    let path = "${root}/session.log"
    try {
        let log = SessionLog(path)
        let store = ScheduleStore(log)
        let metadata = JsonObject()
        metadata.put("title", JsonString("夜间::构建"))
        metadata.put("modelId", JsonString("free/local"))
        metadata.put("timezone", JsonString("Asia/Shanghai"))
        let definition = JsonObject()
        definition.put("version", JsonInt(1))
        definition.put("id", JsonString("nightly-build"))
        definition.put("cron", JsonString("0 2 * * *"))
        definition.put("prompt", JsonString("保留::分隔符\n以及第二行"))
        definition.put("workspace", JsonString(root))
        definition.put("sessionLogPath", JsonString("${root}/run::nightly.log"))
        definition.put("metadata", metadata)

        store.registerStructuredTask(definition.toString())
        @Expect(store.listTasks().size, Int64(1))
        @Expect(store.listTasks()[0].prompt, "保留::分隔符\n以及第二行")
        @Expect(store.listTasks()[0].workspaceDir, root)
        @Expect(store.listTasks()[0].sessionLogPath, "${root}/run::nightly.log")
        @Expect(JsonValue.fromStr(store.listTasks()[0].modelConfig).asObject().get("modelId").getOrThrow().asString().getValue(), "free/local")
        @Expect(log.flush(), true)

        let restored = SessionLog(path)
        @Expect(restored.load(), true)
        let replayed = ScheduleStore(restored)
        @Expect(replayed.listTasks().size, Int64(1))
        @Expect(replayed.listTasks()[0].id, "nightly-build")
        @Expect(replayed.listTasks()[0].prompt, "保留::分隔符\n以及第二行")
        @Expect(replayed.listTasks()[0].workspaceDir, root)
        @Expect(replayed.listTasks()[0].sessionLogPath, "${root}/run::nightly.log")
        @Expect(JsonValue.fromStr(replayed.listTasks()[0].modelConfig).asObject().get("timezone").getOrThrow().asString().getValue(), "Asia/Shanghai")

        let invalid = JsonObject()
        invalid.put("version", JsonInt(2))
        @ExpectThrows[Exception](replayed.registerStructuredTask(invalid.toString()))
        @Expect(restored.eventCount(), Int64(1))
    } finally {
        removeIfExists(root, recursive: true)
    }
}
