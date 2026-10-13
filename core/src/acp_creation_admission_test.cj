package core
import std.fs.*
import std.unittest.*

class AcpAdmissionCounter { var factories: Int64 = 0 }

@Test
func acpCreationMissingOrFailedCheckpointDoesNotConstructProcess() {
    let settings = AcpSettingsService()
    settings.setEnabled("user", true, 0)
    let gate = AcpGate(settings)
    gate.updateEnv(AcpEnvInput("opencode", "installed-usable", true))
    gate.updateProbe(AcpProbeInput("opencode", "measured"))
    let counter = AcpAdmissionCounter()
    let missing = AcpDelegationService("s", gate, { _ => counter.factories += 1; AcpProcess("nonexistent-admission-test", [], workingDirectory: Path(".")) })
    let failed = missing.create("t", "r", "opencode", "task", ".")
    @Expect(failed.phase, "failed")
    @Expect(failed.result, "persistence-failed:delegation-create")
    @Expect(counter.factories, 0)
    @Expect(missing.create("t", "r", "opencode", "task", ".").id, failed.id)
    let throws = AcpDelegationService("s", gate, { _ => counter.factories += 1; AcpProcess("nonexistent-admission-test", [], workingDirectory: Path(".")) }, checkpoint: { => throw Exception("disk-failure") })
    @Expect(throws.create("t", "r", "opencode", "task", ".").result, "persistence-failed:delegation-create")
    @Expect(counter.factories, 0)
    let permitted = AcpDelegationService("s", gate, { _ => counter.factories += 1; AcpProcess("nonexistent-admission-test", [], workingDirectory: Path(".")) }, checkpoint: { => true })
    @Expect(permitted.create("t", "allowed", "opencode", "task", ".").result.contains("provider-unavailable"), true)
    @Expect(counter.factories, 1)
}
