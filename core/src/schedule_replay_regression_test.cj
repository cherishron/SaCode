package core
import std.fs.*
import std.unittest.*

@Test
func scheduleDefinitionFieldsAndPauseSurviveDurableReplay() {
    let root = coreTestDirCreated("schedule-replay-fields")
    let log = SessionLog("${root}/session.log")
    let lease = WriteLease(log.path)
    @Expect(lease.acquire(), true)
    try {
        let store = ScheduleStore(log)
        store.registerTask("nightly", "0 0 * * *", "backup", true, 3600, root, "${root}/task.log", "model-fixture")
        store.pauseTask("nightly")
        @Expect(log.durableCheckpoint(lease), true)
        let replay = SessionLog(log.path)
        replay.load()
        let restored = ScheduleStore(replay)
        @Assert(restored.listTasks().size, 1)
        let task = restored.listTasks()[0]
        @Expect(task.id, "nightly")
        @Expect(task.cron, "0 0 * * *")
        @Expect(task.prompt, "backup")
        @Expect(task.oneShot, true)
        @Expect(task.maxAgeSec, 3600)
        @Expect(task.workspaceDir, root)
        @Expect(task.sessionLogPath, "${root}/task.log")
        @Expect(task.modelConfig, "model-fixture")
        @Expect(task.active, false)
    } finally { lease.release(); removeIfExists(root, recursive: true) }
}

@Test
func scheduleUpdatedDefinitionAndDeleteSurviveDurableReplay() {
    let root = coreTestDirCreated("schedule-replay-update-delete")
    let log = SessionLog("${root}/session.log")
    let lease = WriteLease(log.path)
    @Expect(lease.acquire(), true)
    try {
        let store = ScheduleStore(log)
        store.registerTask("nightly", "0 0 * * *", "first", false, 0, "", "", "")
        store.registerTask("nightly", "15 9 * * *", "updated", true, 900, root, "${root}/task.log", "second-model")
        @Expect(log.durableCheckpoint(lease), true)
        let replay = SessionLog(log.path)
        replay.load()
        let restored = ScheduleStore(replay)
        @Assert(restored.listTasks().size, 1)
        @Expect(restored.listTasks()[0].id, "nightly")
        @Expect(restored.listTasks()[0].prompt, "updated")
        @Expect(restored.listTasks()[0].cron, "15 9 * * *")
        @Expect(restored.listTasks()[0].revision, 1)
        restored.deleteTask("nightly")
        @Expect(replay.durableCheckpoint(lease), true)
        let after = SessionLog(log.path)
        after.load()
        @Expect(ScheduleStore(after).listTasks().size, 0)
    } finally { lease.release(); removeIfExists(root, recursive: true) }
}
