package core

import std.unittest.*
import core.launch_context.currentProcessIntegrity

@Test
func acpProbeObservationKeepsOnlyBoundProtocolMetadataAndNeverInfersFreePrice() {
    let base = AcpProbeObservation(diagnosticId: "fixture-id", workspace: "fixture-root")
    let initialized = acpProbeObservedInitialization(base,
        "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"protocolVersion\":1,\"agentInfo\":{\"name\":\"OpenCode\",\"version\":\"2.fixture\"},\"authMethods\":[{\"secret\":\"must-not-retain\"}],\"_meta\":{\"credential\":\"must-not-retain\"}}}")
    let observed = acpProbeObservedSession(initialized,
        "{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"sessionId\":\"s1\",\"configOptions\":[{\"id\":\"model\",\"name\":\"Model\",\"category\":\"model\",\"type\":\"select\",\"currentValue\":\"name-contains-free\",\"options\":[]}],\"modes\":{\"currentModeId\":\"build\",\"availableModes\":[]}}}")
    @Expect(observed.agentName, "OpenCode"); @Expect(observed.agentVersion, "2.fixture")
    @Expect(observed.sessionModel, "name-contains-free"); @Expect(observed.sessionMode, "build")
    @Expect(observed.diagnosticId, "fixture-id"); @Expect(observed.workspace, "fixture-root")
    @Expect(observed.toJson().contains("must-not-retain"), false)
    @Expect(observed.toJson().contains("\"price\":\"unknown\""), true)
    @Expect(observed.toJson().contains("\"primaryAgent\":\"unknown\""), true)
}

@Test
func acpProbeObservationMissingMalformedOrAmbiguousOptionalFieldsRemainUnknown() {
    let base = AcpProbeObservation()
    let malformed = acpProbeObservedInitialization(base,"{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"agentInfo\":{\"name\":3,\"version\":null}}}")
    @Expect(malformed.agentName, ""); @Expect(malformed.agentVersion, "")
    let duplicated = acpProbeObservedSession(base,"{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"configOptions\":[{\"category\":\"model\",\"type\":\"select\",\"currentValue\":\"a\"},{\"category\":\"model\",\"type\":\"select\",\"currentValue\":\"b\"}]}}")
    @Expect(duplicated.sessionModel, "")
    @Expect(duplicated.toJson().contains("\"sessionModel\":null"), true)
}

@Test
func acpProbeObservationClassifiesReportedLogDenialWithoutEchoingDiagnosticSecrets() {
    @Expect(acpProbeFailureEvidence("initialize", "EPERM open C:\\private\\log\\opencode.log secret=must-not-echo"),
        "protocol-initialize-log-file-permission-denied-unconfirmed:no-task")
    @Expect(acpProbeFailureEvidence("session-new", "network timeout bearer=must-not-echo"), "protocol-session-new-unconfirmed:no-task")
}

@Test
func acpProbeObservationPreservesMeasuredIntegrityAcrossProtocolFields() {
    let observed = AcpProbeObservation(diagnosticId: "fixture").withProcessIntegrity("low").withExecutable("fixture.exe")
    let next = acpProbeObservedSession(observed, "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"sessionId\":\"fixture\"}}")
    @Expect(next.processIntegrity, "low")
    @Expect(next.toJson().contains("\"processIntegrity\":\"low\""), true)
}

@Test
func acpProbeObservationPrefersConfigModeAndNeverFallsBackFromAmbiguousSelectors() {
    let base = AcpProbeObservation()
    let modern = acpProbeObservedSession(base, ##"{"jsonrpc":"2.0","id":1,"result":{"configOptions":[{"category":"mode","type":"select","currentValue":"plan"}],"modes":{"currentModeId":"legacy-build"}}}"##)
    @Expect(modern.sessionMode, "plan")
    let ambiguous = acpProbeObservedSession(base, ##"{"jsonrpc":"2.0","id":2,"result":{"configOptions":[{"category":"mode","type":"select","currentValue":"plan"},{"category":"mode","type":"select","currentValue":"build"}],"modes":{"currentModeId":"legacy-build"}}}"##)
    @Expect(ambiguous.sessionMode, "")
    let unsupported = acpProbeObservedSession(base, ##"{"jsonrpc":"2.0","id":3,"result":{"configOptions":[{"category":"mode","type":"boolean","currentValue":true}],"modes":{"currentModeId":"legacy-build"}}}"##)
    @Expect(unsupported.sessionMode, "")
    @Expect(modern.toJson().contains("\"primaryAgent\":\"unknown\""), true)
}

@When[os == "Windows"]
@Test
func acpProbeObservationReadsActualWindowsIntegrityWithoutChangingIt() {
    let first = currentProcessIntegrity()
    @Expect(first == "untrusted" || first == "low" || first == "medium" || first == "high" || first == "system", true)
    @Expect(currentProcessIntegrity(), first)
}
