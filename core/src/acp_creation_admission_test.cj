package core
import std.fs.*
import std.unittest.*

class AcpAdmissionCounter { var factories: Int64 = 0 }

class AcpAdmissionReentry {
    var service: ?AcpDelegationService = None
    var depth: Int64 = 0
    var blocked = false
}

@Test
func acpInitializingReservationsCountAgainstConcurrentLimit() {
    let settings = AcpSettingsService()
    settings.setEnabled("user", true, 0)
    let gate = AcpGate(settings)
    gate.updateEnv(AcpEnvInput("opencode", "installed-usable", true))
    gate.updateProbe(AcpProbeInput("opencode", "measured"))
    let holder = AcpAdmissionReentry()
    let counter = AcpAdmissionCounter()
    let service = AcpDelegationService("s", gate, { _ => counter.factories += 1; AcpProcess("nonexistent-admission-test", [], workingDirectory: Path(".")) }, checkpoint: { =>
        holder.depth += 1
        if (holder.depth <= 4) {
            try { holder.service.getOrThrow().create("task", "nested-${holder.depth}", "opencode", "task", ".") }
            catch (e: Exception) { holder.blocked = e.message.contains("busy:concurrent-limit") }
        }
        false
    })
    holder.service = Some(service)
    service.create("task", "initial", "opencode", "task", ".")
    @Expect(holder.blocked, true)
    @Expect(service.list().size, 4)
    @Expect(counter.factories, 0)
}

@Test
func acpRequestIdCannotBeReusedForDifferentTaskPeerOrWorkspace() {
    let settings = AcpSettingsService()
    settings.setEnabled("user", true, 0)
    let gate = AcpGate(settings)
    for (peer in ["opencode", "codex"]) {
        gate.updateEnv(AcpEnvInput(peer, "installed-usable", true))
        gate.updateProbe(AcpProbeInput(peer, "measured"))
    }
    let service = AcpDelegationService("session", gate, { _ => AcpProcess("nonexistent-admission-test", [], workingDirectory: Path(".")) })
    let first = service.create("task", "request", "opencode", "same content", ".")
    @Expect(service.create("task", "request", "opencode", "same content", ".").id, first.id)
    @ExpectThrows[Exception](service.create("other-task", "request", "opencode", "same content", "."))
    @ExpectThrows[Exception](service.create("task", "request", "codex", "same content", "."))
    @ExpectThrows[Exception](service.create("task", "request", "opencode", "same content", "other-workspace"))
    @Expect(service.list().size, 1)
}

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
