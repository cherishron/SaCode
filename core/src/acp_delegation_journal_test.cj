package core
import std.fs.*
import std.unittest.*

class AcpJournalFactoryCounter { var calls: Int64 = 0 }

@Test
func acpJournalPublicationFailureDoesNotStartExternalProcess() {
    let root = "${coreTestRoot()}/acp-journal-publish-failure"
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let lease = WriteLease(path)
    @Expect(lease.acquire(), true)
    log.append("user/message", "original")
    @Expect(log.durableCheckpoint(lease), true)
    let settings = AcpSettingsService()
    settings.setEnabled("user", true, 0)
    let gate = AcpGate(settings)
    gate.updateEnv(AcpEnvInput("opencode", "installed-usable", true))
    gate.updateProbe(AcpProbeInput("opencode", "measured"))
    let journal = AcpDelegationJournal(log, lease, "session")
    let counter = AcpJournalFactoryCounter()
    let service = AcpDelegationService("session", gate, { _ => counter.calls += 1; AcpProcess("nonexistent-journal-test", [], workingDirectory: Path(root)) }, journal: Some(journal))
    File.writeTo(path, "0\tuser/message\tother\n".toArray())
    let result = service.create("task", "request", "opencode", "task", root)
    @Expect(result.result, "persistence-failed:delegation-create")
    @Expect(counter.calls, 0)
    @Expect(log.isDurableFrozen(), true)
    @ExpectThrows[Exception](journal.recover())
    @Expect(lease.release(), true)
    removeIfExists(root, recursive: true)
}

@Test
func acpJournalIgnoresPendingFactsButRejectsMalformedDurableFacts() {
    let root = "${coreTestRoot()}/acp-journal-malformed"
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let lease = WriteLease(path)
    let journal = AcpDelegationJournal(log, lease, "session")
    log.append("acp/admission", "{}")
    @Expect(journal.recover().size, 0)
    @Expect(lease.acquire(), true)
    @Expect(log.durableCheckpoint(lease), true)
    @ExpectThrows[Exception](journal.recover())
    @Expect(lease.release(), true)
    removeIfExists(root, recursive: true)
}

@Test
func acpJournalRejectsDuplicateDurableRequestIdentity() {
    let root = "${coreTestRoot()}/acp-journal-duplicate"
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let lease = WriteLease(path)
    @Expect(lease.acquire(), true)
    let journal = AcpDelegationJournal(log, lease, "session")
    let snapshot = AcpDelegationSnapshot("delegation-1", "session", "task", "request", "opencode", "", "initializing", 1, "", "")
    @Expect(journal.admit(snapshot, root, sha256Hex("task".toArray())), true)
    log.append("acp/admission", log.snapshotEvents()[0].data)
    @Expect(journal.recover().size, 1)
    @Expect(log.durableCheckpoint(lease), true)
    @ExpectThrows[Exception](journal.recover())
    @Expect(lease.release(), true)
    removeIfExists(root, recursive: true)
}

@Test
func acpJournalAdmissionIsDurableAndRecoveryDoesNotReplayProcess() {
    let root = "${coreTestRoot()}/acp-journal"
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let lease = WriteLease(path)
    let journal = AcpDelegationJournal(log, lease, "session")
    let settings = AcpSettingsService()
    settings.setEnabled("user", true, 0)
    let gate = AcpGate(settings)
    gate.updateEnv(AcpEnvInput("opencode", "installed-usable", true))
    gate.updateProbe(AcpProbeInput("opencode", "measured"))
    let counter = AcpJournalFactoryCounter()
    let factory: (String) -> AcpProcess = { _ => counter.calls += 1; AcpProcess("nonexistent-journal-test", [], workingDirectory: Path(root)) }
    let service = AcpDelegationService("session", gate, factory, journal: Some(journal))
    @Expect(service.create("task", "no-lease", "opencode", "original-task", root).phase, "failed")
    @Expect(counter.calls, 0)
    @Expect(log.eventCount(), 0)
    @Expect(lease.acquire(), true)
    let admitted = service.create("task", "persisted", "opencode", "original-task", root)
    @Expect(counter.calls, 1)
    @Expect(log.pendingCount(), 0)
    @Expect(journal.recover().size, 1)
    @Expect(lease.release(), true)
    let replay = SessionLog(path)
    @Expect(replay.load(), true)
    let recoveredJournal = AcpDelegationJournal(replay, WriteLease(path), "session")
    let restored = AcpDelegationService("session", gate, factory, journal: Some(recoveredJournal))
    @Expect(restored.describe(admitted.id).phase, "outcome-unknown")
    let unknown = restored.describe(admitted.id)
    @ExpectThrows[Exception](restored.cancel(unknown.id, unknown.revision))
    @ExpectThrows[Exception](restored.close(unknown.id, unknown.revision))
    @Expect(restored.describe(unknown.id).phase, "outcome-unknown")
    @Expect(restored.describe(unknown.id).revision, unknown.revision)
    @Expect(restored.create("task", "persisted", "opencode", "original-task", root).id, admitted.id)
    @Expect(counter.calls, 1)
    @ExpectThrows[Exception](restored.create("task", "persisted", "opencode", "changed-task", root))
    @ExpectThrows[Exception](AcpDelegationService("other-session", gate, factory, journal: Some(recoveredJournal)))
    removeIfExists(root, recursive: true)
}
