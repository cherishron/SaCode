package core
import std.fs.*
import std.unittest.*

@Test
func codeBuddyProviderUsesOnlyAcpAndRetainsProviderConfiguration() {
    let f = AcpTaskFixture("end_turn")
    try {
        let provider = CodeBuddyAcpProvider("trusted-codebuddy")
        let process = provider.open(f.root)
        @Expect(provider.peerId(), "codebuddy")
        @Expect(process.command, "trusted-codebuddy")
        @Expect(process.arguments.size, 1)
        @Expect(process.arguments[0], "--acp")
        @Expect(process.environment.size, 0)
        let token = TurnToken(); token.cancel()
        let report = provider.probeWithToken(f.root, token)
        @Expect(report.evidence.contains("probe-cancelled-before-start:no-task"), true)
        @Expect(report.evidence.contains("configuration-owner=codebuddy"), true)
    } finally { f.close() }
}

@Test
func codeBuddyDiscoveryCancelledBeforeResolveAndNoSecretsInFailure() {
    let token = TurnToken(); token.cancel()
    let cancelled = probeConfiguredCodeBuddy("unused", token, resolver: {=> throw Exception("must-not-resolve")})
    @Expect(cancelled.evidence, "probe-cancelled-before-start:no-task")
    let failed = probeConfiguredCodeBuddy("unused", TurnToken(), resolver: {=> throw Exception("secret-config-body")})
    @Expect(failed.evidence, "codebuddy-discovery-unconfirmed:no-task")
    @Expect(failed.authenticated, false)
}

@Test
func codeBuddyDiscoveryDoesNotSearchCurrentOrRunShellShims() {
    let f = AcpTaskFixture("end_turn")
    try {
        File.writeTo(Path(f.root).join("codebuddy.cmd"), "do-not-execute".toArray())
        @ExpectThrows[Exception](codeBuddyFromWindowsSearchPath(".;" + f.root))
        File.writeTo(Path(f.root).join("codebuddy.exe"), "native-fixture-not-executed".toArray())
        @Expect(codeBuddyFromWindowsSearchPath(".;" + f.root), canonicalize(Path(f.root).join("codebuddy.exe")).toString())
    } finally { f.close() }
}
