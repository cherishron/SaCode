package core
import std.collection.ArrayList
import std.unittest.*

// AcpDelegationService 单测（任务 2.3）。
// 验收：正向 可用协作者完成初始化→会话创建→任务发送；
// 失败/越权 协作者未配置/不可用不启进程不伪造会话，session/new 被拒保留原因；
// 恢复/并发 重启后归属与状态回放一致。
// 注意：create 会 spawn 真实进程，本测试只验证门控拒绝与幂等逻辑，
// 不验证完整进程生命周期（待集成测试）。

@Test
func acpDelegationListEmptyInitially() {
    let settings = AcpSettingsService()
    let gate = AcpGate(settings)
    let svc = AcpDelegationService("sess-1", gate, { peerId => AcpProcess("echo", [], workingDirectory: Path(".")) })
    let result = svc.list()
    @Expect(result.size, Int64(0))
}

@Test
func acpDelegationDescribeNotFoundThrows() {
    let settings = AcpSettingsService()
    let gate = AcpGate(settings)
    let svc = AcpDelegationService("sess-1", gate, { peerId => AcpProcess("echo", [], workingDirectory: Path(".")) })
    var threw = false
    try {
        let _ = svc.describe("nonexistent")
    } catch (e: Exception) {
        threw = e.message.contains("not-found")
    }
    @Expect(threw, true)
}

@Test
func acpDelegationCancelNotFoundThrows() {
    let settings = AcpSettingsService()
    let gate = AcpGate(settings)
    let svc = AcpDelegationService("sess-1", gate, { peerId => AcpProcess("echo", [], workingDirectory: Path(".")) })
    var threw = false
    try {
        let _ = svc.cancel("nonexistent", Int64(0))
    } catch (e: Exception) {
        threw = e.message.contains("not-found")
    }
    @Expect(threw, true)
}

@Test
func acpDelegationCloseNotFoundThrows() {
    let settings = AcpSettingsService()
    let gate = AcpGate(settings)
    let svc = AcpDelegationService("sess-1", gate, { peerId => AcpProcess("echo", [], workingDirectory: Path(".")) })
    var threw = false
    try {
        let _ = svc.close("nonexistent", Int64(0))
    } catch (e: Exception) {
        threw = e.message.contains("not-found")
    }
    @Expect(threw, true)
}

@Test
func acpDelegationCreateGateNotPassedThrows() {
    // 开关默认关闭 → 门控 L1 不通过 → create 应抛异常
    let settings = AcpSettingsService()
    let gate = AcpGate(settings)
    let svc = AcpDelegationService("sess-1", gate, { peerId => AcpProcess("echo", [], workingDirectory: Path(".")) })
    var threw = false
    var msg = ""
    try {
        let _ = svc.create("task-1", "req-1", "opencode", "hello", ".")
    } catch (e: Exception) {
        threw = true
        msg = e.message
    }
    @Expect(threw, true)
    @Expect(msg.contains("provider-unavailable"), true)
}

@Test
func acpDelegationCreateSpawnFailsReportsProviderUnavailable() {
    // 门控通过但 spawn 失败（用不存在的命令）
    let settings = AcpSettingsService()
    let _ = settings.setEnabled("user", true, Int64(0))
    let gate = AcpGate(settings)
    gate.updateEnv(AcpEnvInput("opencode", "installed-usable", true))
    gate.updateProbe(AcpProbeInput("opencode", "measured"))
    // procFactory 返回一个用不存在命令的 AcpProcess
    let svc = AcpDelegationService("sess-1", gate, { peerId =>
        AcpProcess("nonexistent-command-xyz", [], workingDirectory: Path("."))
    })
    let snap = svc.create("task-1", "req-1", "opencode", "hello", ".")
    // spawn 失败 → phase=failed，result 包含 provider-unavailable
    @Expect(snap.phase, "failed")
    @Expect(snap.result.contains("provider-unavailable"), true)
}

@Test
func acpDelegationIdempotencySameRequestIdReturnsSame() {
    // 手动测试幂等：先创建一个委派，再用同 requestId+同 task 再创建
    // 但 create 会 spawn，所以这里只验证幂等索引的"同 requestId 不同摘要"路径
    let settings = AcpSettingsService()
    let _ = settings.setEnabled("user", true, Int64(0))
    let gate = AcpGate(settings)
    gate.updateEnv(AcpEnvInput("opencode", "installed-usable", true))
    gate.updateProbe(AcpProbeInput("opencode", "measured"))
    let svc = AcpDelegationService("sess-1", gate, { peerId =>
        AcpProcess("nonexistent-command-xyz", [], workingDirectory: Path("."))
    })
    // 第一次创建（会失败但条目已入表）
    let snap1 = svc.create("task-1", "req-1", "opencode", "hello", ".")
    // 用同 requestId 再创建 → 因为 phase=failed，不会命中幂等
    // 但 requestIdIndex 已有 req-1 → 同摘要应该回原委派
    // 由于第一次 phase=failed，entry 仍在 delegations 中
    // 同 requestId + 同 digest → 应回原委派
    let snap2 = svc.create("task-1", "req-1", "opencode", "hello", ".")
    @Expect(snap2.id, snap1.id)
}

@Test
func acpDelegationIdempotencyDifferentDigestThrowsConflict() {
    let settings = AcpSettingsService()
    let _ = settings.setEnabled("user", true, Int64(0))
    let gate = AcpGate(settings)
    gate.updateEnv(AcpEnvInput("opencode", "installed-usable", true))
    gate.updateProbe(AcpProbeInput("opencode", "measured"))
    let svc = AcpDelegationService("sess-1", gate, { peerId =>
        AcpProcess("nonexistent-command-xyz", [], workingDirectory: Path("."))
    })
    let _ = svc.create("task-1", "req-1", "opencode", "hello", ".")
    // 同 requestId 不同 task → revision-conflict
    var threw = false
    try {
        let _ = svc.create("task-1", "req-1", "opencode", "different task", ".")
    } catch (e: Exception) {
        threw = e.message.contains("revision-conflict")
    }
    @Expect(threw, true)
}

@Test
func acpDelegationCancelRevisionConflict() {
    let settings = AcpSettingsService()
    let _ = settings.setEnabled("user", true, Int64(0))
    let gate = AcpGate(settings)
    gate.updateEnv(AcpEnvInput("opencode", "installed-usable", true))
    gate.updateProbe(AcpProbeInput("opencode", "measured"))
    let svc = AcpDelegationService("sess-1", gate, { peerId =>
        AcpProcess("nonexistent-command-xyz", [], workingDirectory: Path("."))
    })
    let snap = svc.create("task-1", "req-1", "opencode", "hello", ".")
    // 用错误的 revision 调 cancel → revision-conflict
    var threw = false
    try {
        let _ = svc.cancel(snap.id, Int64(999))
    } catch (e: Exception) {
        threw = e.message.contains("revision-conflict")
    }
    @Expect(threw, true)
}

@Test
func acpDelegationSnapshotFieldsMatchEntry() {
    let settings = AcpSettingsService()
    let _ = settings.setEnabled("user", true, Int64(0))
    let gate = AcpGate(settings)
    gate.updateEnv(AcpEnvInput("opencode", "installed-usable", true))
    gate.updateProbe(AcpProbeInput("opencode", "measured"))
    let svc = AcpDelegationService("sess-1", gate, { peerId =>
        AcpProcess("nonexistent-command-xyz", [], workingDirectory: Path("."))
    })
    let snap = svc.create("task-1", "req-1", "opencode", "hello", ".")
    @Expect(snap.taskId, "task-1")
    @Expect(snap.requestId, "req-1")
    @Expect(snap.peerId, "opencode")
    @Expect(snap.sessionId, "sess-1")
    @Expect(snap.id.startsWith("delegation-"), true)
    // spawn 失败 → phase=failed
    @Expect(snap.phase, "failed")
    @Expect(snap.revision > Int64(0), true)
}