package core
import std.fs.*
import std.unittest.*

class AcpCreationCancelProbe {
    var service: ?AcpDelegationService = None
    var factoryCalls: Int64 = 0
    func cancelCurrent() {
        let current = service.getOrThrow().describe("delegation-1")
        service.getOrThrow().cancel(current.id, current.revision)
    }
}

func acpCreationCancelGate(): AcpGate {
    let settings = AcpSettingsService()
    settings.setEnabled("user", true, 0)
    let gate = AcpGate(settings)
    gate.updateEnv(AcpEnvInput("opencode", "installed-usable", true))
    gate.updateProbe(AcpProbeInput("opencode", "measured"))
    return gate
}

@Test
func acpCancelDuringAdmissionDoesNotConstructProcess() {
    let probe = AcpCreationCancelProbe()
    let service = AcpDelegationService("session", acpCreationCancelGate(), { _ =>
        probe.factoryCalls += 1
        AcpProcess("nonexistent-cancel-test", [], workingDirectory: Path("."))
    }, checkpoint: { => probe.cancelCurrent(); true })
    probe.service = Some(service)
    let result = service.create("task", "request", "opencode", "task", ".")
    @Expect(probe.factoryCalls, 0)
    @Expect(result.phase, "outcome-unknown")
    @Expect(result.result, "cancel-no-confirmation")
}

@Test
func acpCancelDuringFactoryDoesNotStartConstructedProcess() {
    let probe = AcpCreationCancelProbe()
    let service = AcpDelegationService("session", acpCreationCancelGate(), { _ =>
        probe.factoryCalls += 1
        probe.cancelCurrent()
        AcpProcess("nonexistent-cancel-test", [], workingDirectory: Path("."))
    }, checkpoint: { => true })
    probe.service = Some(service)
    let result = service.create("task", "request", "opencode", "task", ".")
    @Expect(probe.factoryCalls, 1)
    @Expect(result.phase, "outcome-unknown")
    @Expect(result.result, "cancel-no-confirmation")
}
