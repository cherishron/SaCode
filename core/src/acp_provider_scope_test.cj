package core
import std.fs.*
import std.env.getVariable
import std.unittest.*
import stdx.encoding.json.*

@Test
func acpProviderScopesKeepSwitchesAndDiagnosticsIndependent() {
    let root = canonicalize(Directory.createTemp(Path(getVariable("TMP").getOrThrow()))).toString()
    let log = SessionLog(Path(root).join("session.log").toString()); let lease = WriteLease(log.path)
    try {
        @Expect(lease.acquire(), true)
        let old = AcpSessionSettings(log, lease)
        let buddy = AcpSessionSettings(log, lease, peerId: "codebuddy")
        old.setEnabled(true, 0)
        @Expect(buddy.effective.describe("project").enabled, false)
        buddy.setEnabled(true, 0)
        @Expect(log.snapshotEvents()[0].eventType, "acp/settings")
        @Expect(log.snapshotEvents()[1].eventType, "acp/settings/codebuddy")
        let openJournal = AcpDiagnosticJournal(log, lease, "current", root)
        let buddyJournal = AcpDiagnosticJournal(log, lease, "current", root, peerId: "codebuddy")
        let openId = "acp-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        let buddyId = "acp-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        let report = AcpProviderReadiness("installed-usable", true, "measured", 1, "fixture:no-task",
            observation: AcpProbeObservation(diagnosticId: openId, workspace: root))
        let other = AcpProviderReadiness("installed-usable", true, "measured", 1, "fixture:no-task",
            observation: AcpProbeObservation(diagnosticId: buddyId, workspace: root))
        openJournal.record(report, openJournal.scopeRevision())
        buddyJournal.record(other, buddyJournal.scopeRevision())
        @ExpectThrows[Exception](buddyJournal.keep(openId, 1))
        buddyJournal.keep(buddyId, 1)
        @Expect(JsonValue.fromStr(openJournal.describe()).asObject().get("record").getOrThrow().asObject().get("decision").getOrThrow().asString().getValue(), "pending")
        old.setEnabled(false, 1)
        @Expect(JsonValue.fromStr(buddyJournal.describe()).asObject().get("scopeCurrent").getOrThrow().asBool().getValue(), true)
        let restored = SessionLog(log.path); @Expect(restored.load(), true)
        @Expect(AcpSessionSettings(restored, lease).effective.describe("project").enabled, false)
        @Expect(AcpSessionSettings(restored, lease, peerId: "codebuddy").effective.describe("project").enabled, true)
        @ExpectThrows[Exception](AcpSessionSettings(log, lease, peerId: "arbitrary-command"))
    } finally { lease.release(); removeIfExists(root, recursive: true) }
}
