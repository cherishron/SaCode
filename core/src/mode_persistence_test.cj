package core
import std.fs.*
import std.unittest.*

@Test
func failedModePublicationFreezesReadbackAndToolExecution() {
    let root = "${coreTestRoot()}/mode-publication-failure"
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let lease = WriteLease(path)
    @Expect(lease.acquire(), true)
    let mode = ModeController(log)
    @Expect(mode.setDurable("plan", lease), "committed")
    // 磁盘前缀发生真实分叉；发布不能覆盖另一份事实。
    File.writeTo(path, "0\tmode/mode\tbuild\n".toArray())
    @ExpectThrows[Exception](mode.setDurable("yolo", lease))
    @Expect(log.isDurableFrozen(), true)
    @ExpectThrows[Exception](mode.current())
    let runtime = ModelToolRuntime(log, false)
    let call = ModelToolCall(0)
    call.name = "update_goal"; call.args = "{}"
    @Expect(runtime.execute(call).why, "session-persistence-unsettled")
    @Expect(lease.release(), true)
    removeIfExists(root, recursive: true)
}

@Test
func approvalModeRequiresWriterAndSurvivesReplay() {
    let root = "${coreTestRoot()}/mode-durable"
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let lease = WriteLease(path)
    let mode = ModeController(log)
    @ExpectThrows[Exception](mode.setDurable("plan", lease))
    @Expect(log.eventCount(), 0)
    @Expect(lease.acquire(), true)
    @Expect(mode.setDurable("plan", lease), "committed")
    @Expect(log.pendingCount(), 0)
    @Expect(mode.setDurable("plan", lease), "noop")
    @ExpectThrows[Exception](mode.setDurable("invalid", lease))
    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    @Expect(ModeController(fresh).current(), "plan")
    @Expect(lease.release(), true)
    removeIfExists(root, recursive: true)
}
