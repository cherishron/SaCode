package core
import std.fs.*
import std.unittest.*
import stdx.encoding.json.*

func acpMetadataFixture(): String {
    return ##"{"version":1,"source":"opencode-v2-plugin","implementation":"sacode-diagnostics-0.1.0","diagnosticId":"fixture-id","nonce":"fixture-nonce","directory":"fixture","sessionId":"s1","providerVersion":"2.0.28","providerPid":17,"osUser":"fixture-user","capturedAt":110,"models":{"status":"observed","complete":true,"items":[{"providerId":"p","modelId":"free-name-is-not-proof","enabled":true,"apiKey":"must-not-retain"}]},"defaultModel":{"ref":{"providerId":"p","modelId":"free-name-is-not-proof"},"availability":"not-listed"},"agents":{"status":"observed","complete":true,"items":[{"id":"worker","mode":"subagent","model":{"providerId":"p","modelId":"missing"},"availability":"listed","system":"must-not-retain"}]},"plugins":{"status":"observed","complete":true,"items":[{"id":"omo","status":"unknown","options":{"secret":"must-not-retain"}}]},"headers":{"authorization":"must-not-retain"}}"##
}
func acpSanitizeFixture(raw: String): String {
    return sanitizeOpenCodeMetadata(raw, "fixture-id", "fixture-nonce", "fixture", "s1", 100, 200)
}

@Test
func acpMetadataWhitelistDropsSecretsAndRecomputesAgentWarningsWithoutInferringFree() {
    let output = acpSanitizeFixture(acpMetadataFixture())
    let value = JsonValue.fromStr(output).asObject()
    @Expect(output.contains("must-not-retain"), false)
    @Expect(output.contains("fixture-nonce"), false)
    @Expect(value.get("defaultModel").getOrThrow().asObject().get("availability").getOrThrow().asString().getValue(), "listed")
    @Expect(value.get("agents").getOrThrow().asObject().get("items").getOrThrow().asArray().get(0).getOrThrow().asObject().get("availability").getOrThrow().asString().getValue(), "not-listed")
    @Expect(value.get("price").getOrThrow().asString().getValue(), "unknown")
    @Expect(value.get("modelTask").getOrThrow().asString().getValue(), "not-tested")
}

@Test
func acpMetadataRejectsNonceSessionVersionAndTimeMismatch() {
    let raw = acpMetadataFixture()
    @ExpectThrows[Exception](sanitizeOpenCodeMetadata(raw, "fixture-id", "other", "fixture", "s1", 100, 200))
    @ExpectThrows[Exception](sanitizeOpenCodeMetadata(raw, "fixture-id", "fixture-nonce", "fixture", "other", 100, 200))
    @ExpectThrows[Exception](sanitizeOpenCodeMetadata(raw, "fixture-id", "fixture-nonce", "other", "s1", 100, 200))
    let version = JsonValue.fromStr(raw).asObject(); version.put("providerVersion", JsonString("2.0.29"))
    @ExpectThrows[Exception](acpSanitizeFixture(version.toString()))
    @ExpectThrows[Exception](sanitizeOpenCodeMetadata(raw, "fixture-id", "fixture-nonce", "fixture", "s1", 111, 200))
}

@Test
func acpMetadataPartialRegistryNeverDeclaresMissingModel() {
    let raw = JsonValue.fromStr(acpMetadataFixture()).asObject()
    raw.get("models").getOrThrow().asObject().put("complete", JsonBool(false))
    let value = JsonValue.fromStr(acpSanitizeFixture(raw.toString())).asObject()
    @Expect(value.get("agents").getOrThrow().asObject().get("items").getOrThrow().asArray().get(0).getOrThrow().asObject().get("availability").getOrThrow().asString().getValue(), "unknown")
}

@Test
func acpMetadataObservationCopiesAndNormalDelegationClearOldCaptureRequest() {
    let value = AcpProbeObservation().withInstanceMetadata(acpSanitizeFixture(acpMetadataFixture()))
    @Expect(value.withExecutable("fixture.exe").withProcessIntegrity("low").instanceMetadata, value.instanceMetadata)
    let next = acpProbeObservedSession(value, ##"{"jsonrpc":"2.0","id":1,"result":{"sessionId":"s1"}}"##)
    @Expect(next.instanceMetadata, value.instanceMetadata)
    let environment = openCodeMetadataEnvironment([("Z", "keep"), ("SACODE_ACP_METADATA_REQUEST", "old")], "")
    @Expect(environment.size, Int64(2))
    let (_, request) = environment[1]; @Expect(request, "")
}

@Test
func acpMetadataReadIsBoundedAndCancellationAndCleanupStayInOwnedTemporaryDirectory() {
    let capture = OpenCodeProbeMetadata("fixture")
    let root = capture.root
    if (root.size == 0) { throw Exception("test-temporary-directory-unavailable") }
    try {
        let path = Path(root).join("snapshot.json").toString()
        File.writeTo(path, Array<Byte>(262145, repeat: 32))
        @ExpectThrows[Exception](capture.readBounded(path))
        let token = TurnToken(); token.cancel()
        @Expect(capture.observe(AcpProbeObservation(), "s1", token).instanceMetadata, "")
    } finally { capture.close() }
    @Expect(exists(root), false)
}
