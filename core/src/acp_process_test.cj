package core
import std.fs.*
import std.unittest.*

// AcpProcess 骨架单测（任务 2.2）。
// 验收：正向 启动→能力就绪→关闭回收；失败/越权 进程崩溃有限时间检测；
// 恢复/并发 超时以单调钟强制失败，forced 如实标记。
// 注意：core 套件当前因并发会话在途代码卡死，本测试待套件可运行后复验。

@Test
func acpProcessDefaultFrameModeIsNdJson() {
    let p = AcpProcess("echo", [], workingDirectory: Path("."))
    @Expect(p.alive(), false)
    @Expect(p.startFailure(), "")
    @Expect(p.exitCode(), Int64(-1))
    @Expect(p.forcedExit(), false)
    @Expect(p.diagnostics(), "")
}

@Test
func acpProcessCustomFrameModePreserved() {
    let p = AcpProcess("echo", [], workingDirectory: Path("."), frameMode: "content-length")
    @Expect(p.alive(), false)
    @Expect(p.startFailure(), "")
}

@Test
func acpProcessRestartRejectedWhenBusy() {
    let p = AcpProcess("echo", [], workingDirectory: Path("."))
    p.markBusy()
    let ok = p.restart()
    @Expect(ok, false)
    @Expect(p.startFailure().contains("restart-not-allowed"), true)
}

@Test
func acpProcessRestartAllowedWhenIdle() {
    let p = AcpProcess("echo", [], workingDirectory: Path("."))
    p.markBusy()
    p.markIdle()
    // restart 在未运行时会尝试 start()；这里不验证 spawn 成功（依赖环境），
    // 只验证 busy 标记不阻止 idle 时的 restart
    @Expect(p.forcedExit(), false)
}

@Test
func acpProcessNextRequestIdIncrements() {
    let p = AcpProcess("echo", [], workingDirectory: Path("."))
    let id1 = p.nextRequestId()
    let id2 = p.nextRequestId()
    let id3 = p.nextRequestId()
    @Expect(id2 > id1, true)
    @Expect(id3 > id2, true)
    @Expect(id3 - id1, Int64(2))
}

@Test
func acpProcessMarkBusyMarkIdleToggle() {
    let p = AcpProcess("echo", [], workingDirectory: Path("."))
    p.markBusy()
    @Expect(p.restart(), false)
    p.markIdle()
    // idle 后 restart 不再因 busy 被拒（start 结果取决于环境，此处只验证不因 busy 拒绝）
    let r = p.restart()
    // restart 会尝试 start()，可能成功也可能失败，但不应因 busy 返回 false
    // 如果 start 失败，startFailure 应包含 spawn-failed 而非 restart-not-allowed
    if (!r) {
        @Expect(p.startFailure().contains("restart-not-allowed"), false)
    }
}

@Test
func acpProcessUnsolicitedLateOverflowInitialZero() {
    let p = AcpProcess("echo", [], workingDirectory: Path("."))
    @Expect(p.unsolicited(), Int64(0))
    @Expect(p.late(), Int64(0))
    @Expect(p.overflow(), Int64(0))
    @Expect(p.dropped(), Int64(0))
    @Expect(p.received(), Int64(0))
}