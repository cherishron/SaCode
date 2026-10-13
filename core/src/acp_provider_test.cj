package core
import std.fs.*
import std.unittest.*

class AcpFixtureProvider <: AcpProvider {
    var probes: Int64 = 0
    var opens: Int64 = 0
    var onProbe: () -> Unit = { => }
    public func peerId(): String { return "opencode" }
    public func probe(workspace: String): AcpProviderReadiness {
        probes += 1; onProbe()
        return AcpProviderReadiness("installed-usable", true, "measured", 1, "controlled-protocol-fixture")
    }
    public func open(workspace: String): AcpProcess {
        opens += 1
        return AcpProcess("node", ["-e", acpLiveProgram()], workingDirectory: Path(workspace))
    }
}

@Test
func acpProviderRegistryRejectsDisabledScopeBeforeProbe() {
    let f = AcpTaskFixture("end_turn")
    try {
        let registry = AcpProviders(); let provider = AcpFixtureProvider(); let settings = AcpSettingsService()
        @Expect(registry.register("fixture-plugin", provider), true)
        @Expect(registry.register("other-plugin", provider), false)
        @ExpectThrows[Exception](registry.service("opencode", f.root, settings, f.log, f.lease, "s1"))
        @Expect(provider.probes, 0); @Expect(provider.opens, 0)
        settings.setEnabled("user", true, 0); settings.setEnabled("project", false, 0)
        @ExpectThrows[Exception](registry.service("opencode", f.root, settings, f.log, f.lease, "s1", settingsScope: "project"))
        @Expect(provider.probes, 0)
        @ExpectThrows[Exception](registry.revoke("other-plugin", "opencode"))
    } finally { f.close() }
}

@Test
func acpProviderRevokedDuringProbeCannotOpenTransport() {
    let f = AcpTaskFixture("end_turn")
    try {
        let registry = AcpProviders(); let provider = AcpFixtureProvider(); let settings = AcpSettingsService()
        settings.setEnabled("user", true, 0); registry.register("fixture-plugin", provider)
        provider.onProbe = { => registry.revoke("fixture-plugin", "opencode"); }
        @ExpectThrows[Exception](registry.service("opencode", f.root, settings, f.log, f.lease, "s1"))
        @Expect(provider.opens, 0)
    } finally { f.close() }
}

@Test
func acpProviderRevocationBlocksInFlightPermissionGrant() {
    let f = AcpTaskFixture("end_turn")
    let registry = AcpProviders(); let provider = AcpFixtureProvider(); let settings = AcpSettingsService()
    settings.setEnabled("user", true, 0); registry.register("fixture-plugin", provider)
    let service = registry.service("opencode", f.root, settings, f.log, f.lease, "s1")
    let created = service.create("provider-task", "provider-request", "opencode", "fixture task", f.root)
    let process = service.permissionProcess(created.id).getOrThrow()
    try {
        let live = AcpLiveTask(service, ApprovalDesk(f.log), f.lease, created.id, created.revision, "fixture task", timeoutMs: 5000)
        let view = acpLivePending(live)
        let ticket = view.get("permissions").getOrThrow().asArray().get(0).getOrThrow().asObject()
        let id = ticket.get("approvalId").getOrThrow().asInt().getValue()
        registry.revoke("fixture-plugin", "opencode")
        @Expect(live.answer(id, "allowed-once", "once").state, "not-sent")
        @Expect(exists(Path(f.root).join("artifact.txt")), false)
        @Expect(registry.register("fixture-plugin", provider), true)
        // 同名重装获得新代际，旧进程不能因此重新获得权限。
        @Expect(process.sendRequest(process.nextRequestId(), "session/prompt", "{}"), false)
        @Expect(live.answer(id, "allowed-once", "once").state, "not-sent")
        service.close(created.id, service.describe(created.id).revision)
    } finally { process.kill(); f.close() }
}
