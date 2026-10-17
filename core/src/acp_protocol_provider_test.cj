package core
import std.fs.*
import std.process.*
import std.env.getVariable
import std.unittest.*
import stdx.encoding.json.*

@Test
func acpProtocolProviderKeepsStandardErrorCodeWithoutEchoingErrorBody() {
    let f = AcpTaskFixture("end_turn")
    try {
        let program = "require('node:readline').createInterface({input:process.stdin}).on('line',s=>{const q=JSON.parse(s);const frame=q.method==='initialize'?{jsonrpc:'2.0',id:q.id,result:{protocolVersion:1,agentCapabilities:{}}}:{jsonrpc:'2.0',id:q.id,error:{code:-32603,message:'secret-config-body'}};console.log(JSON.stringify(frame));});"
        let provider = AcpProtocolProvider("fixture-peer", "node", ["-e", program], authentication: {=> true})
        let report = provider.probe(f.root)
        @Expect(report.evidence, "protocol-session-new-rpc-error:-32603:no-task")
        @Expect(report.authenticated, false)
        @Expect(report.verdict, "blocked")
    } finally { f.close() }
}

@Test
func acpProtocolProviderRequiresVerifiedAuthenticationBeforeSpawn() {
    let f = AcpTaskFixture("end_turn")
    try {
        let provider = AcpProtocolProvider("fixture-peer", "nonexistent-must-not-spawn", [])
        let report = provider.probe(f.root)
        @Expect(report.verdict, "pending-verification")
        @Expect(report.authenticated, false)
        @Expect(report.evidence, "authentication-not-verified")
    } finally { f.close() }
}

@Test
func acpProtocolProviderObservesRealHandshakeWithoutSendingTask() {
    let f = AcpTaskFixture("end_turn")
    try {
        let program = "const fs=require('node:fs'),p=require('node:path');const reply=(id,result)=>console.log(JSON.stringify({jsonrpc:'2.0',id,result}));require('node:readline').createInterface({input:process.stdin}).on('line',s=>{const q=JSON.parse(s);fs.appendFileSync(p.join(process.cwd(),'probe-methods'),q.method+'\\n');if(q.method==='initialize')reply(q.id,{protocolVersion:1,agentCapabilities:{},agentInfo:{name:'OpenCode fixture',version:'2.fixture'}});else if(q.method==='session/new')reply(q.id,{sessionId:'probe-session',configOptions:[{id:'model',name:'Model',category:'model',type:'select',currentValue:'fixture-model',options:[]}]});else if(q.method==='session/prompt')throw Error('probe-must-not-send-task');});"
        let provider = AcpProtocolProvider("fixture-peer", "node", ["-e", program], authentication: { => true })
        let report = provider.probe(f.root)
        @Expect(report.verdict, "measured")
        @Expect(report.protocolVersion, 1)
        @Expect(report.observation.agentVersion, "2.fixture")
        @Expect(report.observation.sessionModel, "fixture-model")
        @Expect(String.fromUtf8(File.readFrom(Path(f.root).join("probe-methods"))), "initialize\nsession/new\n")
    } finally { f.close() }
}

@Test
func acpProtocolProviderMalformedHandshakeNeverReportsReady() {
    let f = AcpTaskFixture("end_turn")
    try {
        let program = "require('node:readline').createInterface({input:process.stdin}).on('line',s=>{const q=JSON.parse(s);console.log(JSON.stringify({jsonrpc:'2.0',id:q.id,result:{protocolVersion:99,agentCapabilities:{}}}));});"
        let provider = AcpProtocolProvider("fixture-peer", "node", ["-e", program], authentication: { => true })
        let report = provider.probe(f.root)
        @Expect(report.verdict, "blocked")
        @Expect(report.authenticated, false)
    } finally { f.close() }
}

@Test
func acpProtocolProviderCopiesPrivateEnvironmentAndPreservesInheritedValues() {
    let f = AcpTaskFixture("end_turn")
    try {
        let program = "const fs=require('node:fs'),p=require('node:path');require('node:readline').createInterface({input:process.stdin}).on('line',s=>{const q=JSON.parse(s);if(q.method==='initialize'){fs.writeFileSync(p.join(process.cwd(),'environment-proof'),JSON.stringify({private:process.env.SACODE_ACP_PRIVATE_DIR,tmp:process.env.TMP}));console.log(JSON.stringify({jsonrpc:'2.0',id:q.id,result:{protocolVersion:1,agentCapabilities:{}}}));}else if(q.method==='session/new')console.log(JSON.stringify({jsonrpc:'2.0',id:q.id,result:{sessionId:'probe-session'}}));});"
        let overrides: Array<(String, String)> = [("SACODE_ACP_PRIVATE_DIR", f.root)]
        let arguments = ["-e", program]
        let provider = AcpProtocolProvider("fixture-peer", "node", arguments, authentication: { => true }, environment: overrides)
        overrides[0] = ("SACODE_ACP_PRIVATE_DIR", "changed-after-construction")
        arguments[1] = "throw Error('changed-after-construction')"
        @Expect(provider.probe(f.root).verdict, "measured")
        let proof = JsonValue.fromStr(String.fromUtf8(File.readFrom(Path(f.root).join("environment-proof")))).asObject()
        @Expect(proof.get("private").getOrThrow().asString().getValue(), f.root)
        @Expect(proof.get("tmp").getOrThrow().asString().getValue(), getVariable("TMP").getOrThrow())
    } finally { f.close() }
}

// node 的固定 acp 参数作为工作目录下的脚本入口；任何 auth 调用都会失败。
@Test
func acpOpenCodeUsesOnlyProtocolAndProviderDefaultsWithoutCredentialGate() {
    let f = AcpTaskFixture("end_turn")
    try {
        let resolver = launch("node", ["-e", "require('node:fs').writeFileSync('node-path',process.execPath)"],
            workingDirectory: Some(Path(f.root)), stdIn: ProcessRedirect.Discard,
            stdOut: ProcessRedirect.Discard, stdErr: ProcessRedirect.Discard)
        @Expect(resolver.wait(timeout: 3000 * Duration.millisecond), Int64(0))
        let node = String.fromUtf8(File.readFrom(Path(f.root).join("node-path")))
        let program = "const fs=require('node:fs');require('node:readline').createInterface({input:process.stdin}).on('line',s=>{const q=JSON.parse(s);fs.appendFileSync('methods',q.method+'\\n');let result;if(q.method==='initialize')result={protocolVersion:1,agentCapabilities:{}};else if(q.method==='session/new'){if(Object.keys(q.params).sort().join(',')!=='cwd,mcpServers')throw Error('default-config-overridden');result={sessionId:'no-auth-session'};}else throw Error('unexpected-method');console.log(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));});"
        File.writeTo(Path(f.root).join("acp"), program.toArray())
        let report = OpenCodeAcpProvider(node).probe(f.root)
        @Expect(report.verdict, "measured")
        @Expect(report.evidence.contains("model-selection=provider-default"), true)
        @Expect(String.fromUtf8(File.readFrom(Path(f.root).join("methods"))), "initialize\nsession/new\n")
        @Expect(openCodeReadinessJson(report).contains("localCredentialPrecondition"), false)
    } finally { f.close() }
}

@Test
func acpProtocolProviderReportsAuthenticationOnlyFromActualRpcError() {
    let f = AcpTaskFixture("end_turn")
    try {
        let program = "require('node:readline').createInterface({input:process.stdin}).on('line',s=>{const q=JSON.parse(s);if(q.method==='initialize')console.log(JSON.stringify({jsonrpc:'2.0',id:q.id,result:{protocolVersion:1,agentCapabilities:{}}}));else console.log(JSON.stringify({jsonrpc:'2.0',id:q.id,error:{code:-32000,message:'Authentication required'}}));});"
        let report = AcpProtocolProvider("fixture-peer", "node", ["-e", program], authentication: {=> true}).probe(f.root)
        @Expect(report.environment, "installed-auth-missing")
        @Expect(report.evidence, "acp-auth-required:no-task")
    } finally { f.close() }
}

@Test
func acpProtocolProbeCancelledBeforeStartDoesNotSpawnOrCheckAuthentication() {
    let token = TurnToken(); token.cancel()
    let provider = AcpProtocolProvider("fixture-peer", "missing-must-not-spawn", [],
        authentication: {=> throw Exception("must-not-check")})
    let report = provider.probeWithToken("missing-workspace", token)
    @Expect(report.evidence, "probe-cancelled-before-start:no-task")
    @Expect(report.verdict, "pending-verification")
}

@Test
func acpProtocolProbeCancellationInterruptsSilentHandshakeAndSettlesOwnedProcess() {
    let f = AcpTaskFixture("end_turn")
    let token = TurnToken()
    try {
        let program = "const fs=require('node:fs');setTimeout(()=>process.exit(0),15000);require('node:readline').createInterface({input:process.stdin}).on('line',s=>{fs.writeFileSync('waiting-probe',JSON.parse(s).method);});"
        let provider = AcpProtocolProvider("fixture-peer", "node", ["-e", program], authentication: {=> true})
        let root = f.root
        let result = spawn {=> provider.probeWithToken(root, token)}
        var attempts: Int64 = 0
        while (!exists(Path(root).join("waiting-probe")) && attempts < 300) {
            sleep(20 * Duration.millisecond); attempts += 1
        }
        @Expect(exists(Path(root).join("waiting-probe")), true)
        token.cancel()
        let report = result.get(5000 * Duration.millisecond)
        @Expect(report.evidence, "probe-cancelled:no-task")
        @Expect(report.environment, "pending-verification")
        @Expect(String.fromUtf8(File.readFrom(Path(root).join("waiting-probe"))), "initialize")
    } finally { token.cancel(); f.close() }
}
