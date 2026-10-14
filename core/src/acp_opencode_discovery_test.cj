package core
import std.fs.*
import std.env.getVariable
import std.unittest.*

@Test
func acpOpenCodeDiscoveryResolvesKnownNpmShimWithoutExecutingIt() {
    let root = canonicalize(Directory.createTemp(Path(getVariable("TMP").getOrThrow())))
    try {
        let packageRoot = root.join("node_modules").join("@opencode").join("cli")
        Directory.create(packageRoot.join("bin"), recursive: true)
        File.writeTo(packageRoot.join("package.json"), "{\"name\":\"@opencode/cli\",\"bin\":{\"opencode\":\"./bin/opencode.exe\"}}".toArray())
        let native = packageRoot.join("bin").join("opencode.exe")
        File.writeTo(native, "fixture-not-an-executable".toArray())
        let marker = root.join("should-not-exist").toString()
        File.writeTo(root.join("opencode.cmd"), "@echo off\r\necho must-not-run > \"${marker}\"\r\n\"%dp0%\\node_modules\\@opencode\\cli\\bin\\opencode.exe\" %*\r\n".toArray())
        @Expect(openCodeFromWindowsSearchPath(root.toString()), canonicalize(native).toString())
        @Expect(exists(root.join("should-not-exist")), false)
    } finally { removeIfExists(root.toString(), recursive: true) }
}

@Test
func acpOpenCodeDiscoveryRejectsRelativeSearchAndForeignPackageMetadata() {
    let root = canonicalize(Directory.createTemp(Path(getVariable("TMP").getOrThrow())))
    try {
        let packageRoot = root.join("node_modules").join("@opencode").join("cli")
        Directory.create(packageRoot.join("bin"), recursive: true)
        File.writeTo(packageRoot.join("package.json"), "{\"name\":\"foreign-package\",\"bin\":{\"opencode\":\"./bin/opencode.exe\"}}".toArray())
        File.writeTo(packageRoot.join("bin").join("opencode.exe"), "fixture".toArray())
        File.writeTo(root.join("opencode.cmd"), "\\node_modules\\@opencode\\cli\\bin\\opencode.exe".toArray())
        @ExpectThrows[Exception](openCodeFromWindowsSearchPath(root.toString()))
        @ExpectThrows[Exception](openCodeFromWindowsSearchPath(".;relative-folder"))
        File.writeTo(root.join("opencode.exe"), "native-fixture".toArray())
        @Expect(openCodeFromWindowsSearchPath(".;" + root.toString()), canonicalize(root.join("opencode.exe")).toString())
    } finally { removeIfExists(root.toString(), recursive: true) }
}

@Test
func acpOpenCodeDiscoveryFailureIsStructuredAndNeverDemandsAuthentication() {
    let report = probeConfiguredOpenCode("fixture-workspace", TurnToken(), resolver: {
        => throw Exception("provider-unavailable:opencode-executable-not-configured")
    })
    @Expect(report.evidence, "opencode-executable-not-found:no-task")
    @Expect(report.observation.workspace, "fixture-workspace")
    @Expect(report.observation.diagnosticId.startsWith("acp-"), true)
    @Expect(report.observation.diagnosticId.size, Int64(36))
    @Expect(report.protocolVersion, Int64(0))
    @Expect(openCodeReadinessJson(report).contains("\"protocolReady\":false"), true)
    let unknown = probeConfiguredOpenCode("fixture-workspace", TurnToken(), resolver: {
        => throw Exception("permission fault must-not-retain bearer=private")
    })
    @Expect(unknown.evidence, "opencode-discovery-unconfirmed:no-task")
    @Expect(openCodeReadinessJson(unknown).contains("must-not-retain"), false)
    @Expect(openCodeReadinessJson(unknown).contains("auth-required"), false)
}

@Test
func acpOpenCodeCancelledDiscoveryDoesNotResolveOrReplaceCancellationWithFailure() {
    let token = TurnToken(); token.cancel()
    let called = TurnToken()
    let report = probeConfiguredOpenCode("fixture-workspace", token, resolver: { => called.cancel(); "unused" })
    @Expect(called.cancelled(), false)
    @Expect(report.evidence, "probe-cancelled-before-start:no-task")
    let later = TurnToken()
    let cancelled = probeConfiguredOpenCode("fixture-workspace", later, resolver: {
        => later.cancel(); throw Exception("must-not-retain")
    })
    @Expect(cancelled.evidence, "probe-cancelled-before-start:no-task")
}
