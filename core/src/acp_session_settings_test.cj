package core
import std.fs.*
import std.env.getVariable
import std.unittest.*
import stdx.encoding.json.*

@Test
func acpSessionSettingsDefaultsOffAndReplaysOnlyPersistedConfiguration() {
    let root = canonicalize(Directory.createTemp(Path(getVariable("TMP").getOrThrow()))).toString()
    let path = Path(root).join("session.log").toString()
    let log = SessionLog(path); let lease = WriteLease(path)
    try {
        @Expect(lease.acquire(), true)
        let settings = AcpSessionSettings(log, lease)
        @Expect(settings.effective.describe("project").enabled, false)
        settings.setEnabled(true, 0)
        let restored = SessionLog(path); @Expect(restored.load(), true)
        let copy = AcpSessionSettings(restored, lease)
        @Expect(copy.effective.describe("project").enabled, true)
        @Expect(copy.effective.describe("project").revision, Int64(1))
        @Expect(restored.snapshotEvents().size, Int64(1))
        @Expect(restored.snapshotEvents()[0].eventType, "acp/settings")
        @ExpectThrows[Exception](settings.setEnabled(false, 0))
        @Expect(log.snapshotEvents().size, Int64(1))
        settings.setEnabled(false, 1)
        @Expect(settings.effective.describe("project").enabled, false)
    } finally { lease.release(); removeIfExists(root, recursive: true) }
}

@Test
func acpSessionSettingsRejectsMissingLeaseAndBrokenReplayRevision() {
    let root = canonicalize(Directory.createTemp(Path(getVariable("TMP").getOrThrow()))).toString()
    let log = SessionLog(Path(root).join("session.log").toString()); let lease = WriteLease(log.path)
    try {
        @ExpectThrows[Exception](AcpSessionSettings(log, lease).setEnabled(true, 0))
        @Expect(log.snapshotEvents().size, Int64(0))
        log.append("acp/settings", "{\"enabled\":true,\"revision\":8}")
        @ExpectThrows[Exception](AcpSessionSettings(log, lease))
    } finally { lease.release(); removeIfExists(root, recursive: true) }
}

@Test
func acpOpenCodeReadinessReportsProtocolWithoutClaimingCredentialsOrModel() {
    let report = AcpProviderReadiness("installed-usable", true, "measured", 1, "fixture:no-task")
    let value = JsonValue.fromStr(openCodeReadinessJson(report)).asObject()
    @Expect(value.get("protocolReady").getOrThrow().asBool().getValue(), true)
    @Expect(value.get("modelTaskTested").getOrThrow().asBool().getValue(), false)
    @Expect(openCodeReadinessJson(report).contains("localCredentialPrecondition"), false)
}
