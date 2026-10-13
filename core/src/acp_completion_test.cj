package core
import std.fs.*
import std.unittest.*

@Test
func acpClosingFailedAdmissionCannotClaimCompletion() {
    let settings = AcpSettingsService()
    settings.setEnabled("user", true, 0)
    let gate = AcpGate(settings)
    gate.updateEnv(AcpEnvInput("opencode", "installed-usable", true))
    gate.updateProbe(AcpProbeInput("opencode", "measured"))
    let service = AcpDelegationService("session", gate, { _ => AcpProcess("nonexistent-close-test", [], workingDirectory: Path(".")) })
    let failed = service.create("task", "request", "opencode", "task", ".")
    @Expect(failed.phase, "failed")
    let closed = service.close(failed.id, failed.revision)
    @Expect(closed.phase, "failed")
    @Expect(closed.result, failed.result)
    @Expect(closed.revision, failed.revision)
    let cancelled = service.cancel(failed.id, failed.revision)
    @Expect(cancelled.phase, "failed")
    @Expect(cancelled.revision, failed.revision)
}
