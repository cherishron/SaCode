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

@Test
func schedulePendingFireSurvivesReplayAndBlocksDuplicateDueTask() {
    let root = coreTestDirCreated("schedule-pending-fire-replay")
    let log = SessionLog("${root}/session.log")
    let lease = WriteLease(log.path)
    @Expect(lease.acquire(), true)
    try {
        let store = ScheduleStore(log)
        store.registerTask("nightly", "0 0 * * *", "backup", false, 0, "", "", "")
        let fire = store.recordFire("nightly", 123)
        @Expect(log.durableCheckpoint(lease), true)
        let replay = SessionLog(log.path)
        replay.load()
        let restored = ScheduleStore(replay)
        @Expect(restored.hasPendingFire("nightly"), true)
        @Expect(restored.dueTasks(0, 0, 15, 6, 2).size, 0)
        @Assert(restored.fireHistory("nightly").size, 1)
        @Expect(restored.fireHistory("nightly")[0].fireId, fire)
        @Expect(restored.fireHistory("nightly")[0].firedAt, 123)
    } finally { lease.release(); removeIfExists(root, recursive: true) }
}

@Test
func scheduleFireResultReplayPreservesDetailAndUnknownBlocksRetry() {
    let root = coreTestDirCreated("schedule-fire-result-replay")
    let log = SessionLog("${root}/session.log")
    let lease = WriteLease(log.path)
    @Expect(lease.acquire(), true)
    try {
        let store = ScheduleStore(log)
        store.registerTask("nightly", "0 0 * * *", "backup", false, 0, "", "", "")
        let fire = store.recordFire("nightly", 123)
        store.updateFireResult(fire, "outcome-unknown", "owner::not-confirmed")
        @Expect(store.hasPendingFire("nightly"), true)
        @Expect(log.durableCheckpoint(lease), true)
        let replay = SessionLog(log.path)
        replay.load()
        let restored = ScheduleStore(replay)
        @Expect(restored.hasPendingFire("nightly"), true)
        @Assert(restored.fireHistory("nightly").size, 1)
        @Expect(restored.fireHistory("nightly")[0].detail, "owner::not-confirmed")
        restored.updateFireResult(fire, "done", "verified::completed")
        @Expect(replay.durableCheckpoint(lease), true)
        let settled = SessionLog(log.path)
        settled.load()
        let after = ScheduleStore(settled)
        @Expect(after.hasPendingFire("nightly"), false)
        @Assert(after.fireHistory("nightly").size, 1)
        @Expect(after.fireHistory("nightly")[0].status, "done")
        @Expect(after.fireHistory("nightly")[0].detail, "verified::completed")
    } finally { lease.release(); removeIfExists(root, recursive: true) }
}

@Test
func scheduleMalformedOrDuplicateFireFactsRejectRecovery() {
    for (body in ["fire::broken", "result::missing::done::unbound", "fire::f1::nightly::-1"]) {
        let root = coreTestDirCreated("schedule-malformed-fire")
        let log = SessionLog("${root}/session.log")
        let lease = WriteLease(log.path)
        @Expect(lease.acquire(), true)
        try {
            log.append("schedule/fire", body)
            @Expect(log.durableCheckpoint(lease), true)
            let replay = SessionLog(log.path)
            replay.load()
            @ExpectThrows[Exception](ScheduleStore(replay))
        } finally { lease.release(); removeIfExists(root, recursive: true) }
    }
    let root = coreTestDirCreated("schedule-duplicate-fire")
    let log = SessionLog("${root}/session.log")
    let lease = WriteLease(log.path)
    @Expect(lease.acquire(), true)
    try {
        log.append("schedule/fire", "fire::f1::nightly::123")
        log.append("schedule/fire", "fire::f1::nightly::123")
        @Expect(log.durableCheckpoint(lease), true)
        let replay = SessionLog(log.path)
        replay.load()
        @ExpectThrows[Exception](ScheduleStore(replay))
    } finally { lease.release(); removeIfExists(root, recursive: true) }
}
