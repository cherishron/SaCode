package core
import std.fs.*
import std.env.getVariable
import std.unittest.*
import stdx.encoding.json.*

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
        let program = "const fs=require('node:fs'),p=require('node:path');const reply=(id,result)=>console.log(JSON.stringify({jsonrpc:'2.0',id,result}));require('node:readline').createInterface({input:process.stdin}).on('line',s=>{const q=JSON.parse(s);fs.appendFileSync(p.join(process.cwd(),'probe-methods'),q.method+'\\n');if(q.method==='initialize')reply(q.id,{protocolVersion:1,agentCapabilities:{}});else if(q.method==='session/new')reply(q.id,{sessionId:'probe-session'});else if(q.method==='session/prompt')throw Error('probe-must-not-send-task');});"
        let provider = AcpProtocolProvider("fixture-peer", "node", ["-e", program], authentication: { => true })
        let report = provider.probe(f.root)
        @Expect(report.verdict, "measured")
        @Expect(report.protocolVersion, 1)
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
