package core
import std.fs.*
import std.env.getVariable
import std.unittest.*
import stdx.encoding.json.*

@Test
func acpDiagnosticKeepsDecisionDurablyWithoutRestoringConnection() {
    let root = canonicalize(Directory.createTemp(Path(getVariable("TMP").getOrThrow()))).toString()
    let log = SessionLog(Path(root).join("session.log").toString()); let lease = WriteLease(log.path)
    try {
        @Expect(lease.acquire(), true)
        let journal = AcpDiagnosticJournal(log, lease, "s1", root)
        let report = AcpProviderReadiness("installed-usable", true, "measured", 1, "fixture:no-task",
            observation: AcpProbeObservation(diagnosticId: "acp-00000000000000000000000000000001", workspace: root))
        journal.record(report, journal.scopeRevision())
        journal.keep(report.observation.diagnosticId, 1)
        journal.keep(report.observation.diagnosticId, 1)
        @Expect(log.snapshotEvents().size, Int64(2))
        let copy = SessionLog(log.path); @Expect(copy.load(), true)
        let value = JsonValue.fromStr(AcpDiagnosticJournal(copy, lease, "s1", root).describe()).asObject()
        @Expect(value.get("source").getOrThrow().asString().getValue(), "durable-history")
        @Expect(value.get("record").getOrThrow().asObject().get("decision").getOrThrow().asString().getValue(), "kept")
        @Expect(copy.snapshotEvents().size, Int64(2))
        @ExpectThrows[Exception](AcpDiagnosticJournal(copy, lease, "s2", root).describe())
    } finally { lease.release(); removeIfExists(root, recursive: true) }
}

@Test
func acpDiagnosticRejectsStaleScopeWrongIdentityAndMissingWriter() {
    let root = canonicalize(Directory.createTemp(Path(getVariable("TMP").getOrThrow()))).toString()
    let log = SessionLog(Path(root).join("session.log").toString()); let lease = WriteLease(log.path)
    let journal = AcpDiagnosticJournal(log, lease, "s1", root)
    let report = AcpProviderReadiness("probe-failed-unknown", false, "blocked", 0, "fixture:no-task",
        observation: AcpProbeObservation(diagnosticId: "acp-00000000000000000000000000000002", workspace: root))
    try {
        @ExpectThrows[Exception](journal.record(report, 0))
        @Expect(log.snapshotEvents().size, Int64(0))
        @Expect(lease.acquire(), true)
        journal.record(report, 0)
        let cancelled = TurnToken(); cancelled.cancel()
        @Expect(journal.recordIfCurrent(report, 0, cancelled), false)
        @ExpectThrows[Exception](journal.keep("other", 1))
        @ExpectThrows[Exception](journal.keep(report.observation.diagnosticId, 9))
        AcpSessionSettings(log, lease).setEnabled(true, 0)
        @Expect(journal.recordIfCurrent(report, 0, TurnToken()), false)
        @ExpectThrows[Exception](journal.keep(report.observation.diagnosticId, 1))
        let value = JsonValue.fromStr(journal.describe()).asObject()
        @Expect(value.get("scopeCurrent").getOrThrow().asBool().getValue(), false)
        @Expect(log.snapshotEvents().size, Int64(2))
    } finally { lease.release(); removeIfExists(root, recursive: true) }
}

@Test
func acpDiagnosticNewProbeInvalidatesOldDecisionAndRejectsCorruptReplay() {
    let root = canonicalize(Directory.createTemp(Path(getVariable("TMP").getOrThrow()))).toString()
    let log = SessionLog(Path(root).join("session.log").toString()); let lease = WriteLease(log.path)
    let journal = AcpDiagnosticJournal(log, lease, "s1", root)
    try {
        @Expect(lease.acquire(), true)
        let first = AcpProviderReadiness("probe-failed-unknown", false, "blocked", 0, "fixture:no-task",
            observation: AcpProbeObservation(diagnosticId: "acp-00000000000000000000000000000003", workspace: root))
        journal.record(first, 0)
        let next = AcpProviderReadiness("installed-usable", true, "measured", 1, "fixture:no-task",
            observation: AcpProbeObservation(diagnosticId: "acp-00000000000000000000000000000004", workspace: root))
        journal.record(next, 0)
        @ExpectThrows[Exception](journal.keep(first.observation.diagnosticId, 1))
        journal.keep(next.observation.diagnosticId, 2)
        @Expect(log.snapshotEvents().size, Int64(3))
        log.append("acp/diagnostic", "{\"version\":2}")
        @ExpectThrows[Exception](journal.describe())
    } finally { lease.release(); removeIfExists(root, recursive: true) }
}
