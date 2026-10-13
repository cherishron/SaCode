package core
import std.fs.*
import std.unittest.*

@Test
func acpSessionResultUsesJsonAndRejectsNestedOrEmptyIdentity() {
    @Expect(acpReadCreatedSession("{\"jsonrpc\":\"2.0\",\"id\" : 2,\"result\":{\"sessionId\" : \"session\\\"quoted\"}}"), "session\"quoted")
    @ExpectThrows[Exception](acpReadCreatedSession("{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"nested\":{\"sessionId\":\"fake\"}}}"))
    @ExpectThrows[Exception](acpReadCreatedSession("{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"sessionId\":\"\"}}"))
}

@Test
func acpInitializationRejectsErrorsAndVersionMismatch() {
    acpValidateInitialization("{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"protocolVersion\":1}}")
    @ExpectThrows[Exception](acpValidateInitialization("{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"protocolVersion\":2}}"))
    @ExpectThrows[Exception](acpValidateInitialization("{\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":-32001,\"message\":\"denied\"}}"))
}

@Test
func acpRejectedHandshakeCannotEnterRunningWithRealProcess() {
    for (scenario in ["initialize-error", "version-mismatch", "session-error", "empty-session"]) {
        let fixture = "const scenario=process.argv[1];const rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',s=>{const f=JSON.parse(s);let r={jsonrpc:'2.0',id:f.id};if((f.method==='initialize'&&scenario==='initialize-error')||(f.method==='session/new'&&scenario==='session-error')){r.error={code:-32001,message:'fixture-rejection'};}else if(f.method==='initialize'){r.result={protocolVersion:scenario==='version-mismatch'?2:1};}else{r.result={sessionId:scenario==='empty-session'?'':'fixture'};}console.log(JSON.stringify(r));});"
        let service = AcpDelegationService("session", acpCreationCancelGate(), { _ => AcpProcess("node", ["-e", fixture, scenario], workingDirectory: Path(".")) }, checkpoint: { => true })
        let result = service.create("task", "request", "opencode", "task", ".")
        @Expect(result.phase, "failed")
        @Expect(result.protocolSessionId, "")
        @Expect(result.result.size > 0, true)
    }
}

@Test
func acpResponsePairsTopLevelIdDespiteWhitespaceAndNestedId() {
    let fixture = "const rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',()=>console.log('{\"jsonrpc\":\"2.0\",\"result\":{\"id\":999,\"verified\":true},\"id\" : 1}'));"
    let process = AcpProcess("node", ["-e", fixture], workingDirectory: Path("."))
    @Expect(process.start(), true)
    try {
        let result = process.request(1, "initialize", "{}", timeoutMs: 5000).getOrThrow()
        @Expect(result.contains("\"verified\":true"), true)
        @Expect(process.unsolicited(), 0)
    } finally { process.kill() }
}

@Test
func acpHandshakeSendsDeclaredCapabilitiesAndAbsoluteWorkspace() {
    let fixture = "const path=require('node:path');const rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',s=>{const f=JSON.parse(s),p=f.params;let ok=false,r;if(f.method==='initialize'){ok=p.protocolVersion===1&&p.clientInfo?.name==='SaCode'&&p.clientInfo?.version==='test'&&p.clientCapabilities&&Object.keys(p.clientCapabilities).length===0&&!Object.hasOwn(p,'client');r={protocolVersion:1,agentCapabilities:{},verified:ok};}else if(f.method==='session/new'){ok=path.isAbsolute(p.cwd)&&Array.isArray(p.mcpServers)&&p.mcpServers.length===0;r={sessionId:ok?'fixture':''};}console.log(JSON.stringify({jsonrpc:'2.0',id:f.id,...(ok?{result:r}:{error:{code:-32602,message:'invalid-client-contract'}})}));});"
    let process = AcpProcess("node", ["-e", fixture], workingDirectory: Path("."))
    @Expect(process.start(), true)
    try {
        let handshake = process.acpInitialize(1, "SaCode", "test").getOrThrow()
        acpValidateInitialization(handshake)
        @Expect(handshake.contains("\"verified\":true"), true)
        let session = process.sessionNew(".").getOrThrow()
        @Expect(acpReadCreatedSession(session), "fixture")
    } finally { process.kill() }
}

@Test
func acpCloseCapabilityRequiresExplicitObjectAndValidInitialization() {
    @Expect(acpSupportsSessionClose("{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"protocolVersion\":1,\"agentCapabilities\":{\"sessionCapabilities\":{\"close\":{}}}}}"), true)
    @Expect(acpSupportsSessionClose("{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"protocolVersion\":1,\"agentCapabilities\":{}}}"), false)
    @ExpectThrows[Exception](acpSupportsSessionClose("{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"protocolVersion\":1,\"agentCapabilities\":{\"sessionCapabilities\":{\"close\":true}}}}"))
}

@Test
func acpCloseIsGatedAndCarriesNegotiatedSessionWithRealPipe() {
    let root = "${coreTestRoot()}/acp-close-capability"
    Directory.create(root, recursive: true)
    try {
        for (scenario in ["supported", "unsupported"]) {
            let path = canonicalize(root).toString()+"/${scenario}.log"
            let fixture = "const fs=require('node:fs'),scenario=process.argv[1],log=process.argv[2];const rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',s=>{const f=JSON.parse(s);fs.appendFileSync(log,s+'\\n');if(f.method==='initialize'){console.log(JSON.stringify({jsonrpc:'2.0',id:f.id,result:{protocolVersion:1,agentCapabilities:scenario==='supported'?{sessionCapabilities:{close:{}}}:{}}}));}else if(f.method==='session/new'){console.log(JSON.stringify({jsonrpc:'2.0',id:f.id,result:{sessionId:'fixture'}}));if(scenario==='unsupported')setTimeout(()=>process.exit(0),300);}else if(f.method==='session/close'){console.log(JSON.stringify({jsonrpc:'2.0',id:f.id,result:{}}));process.exit(f.params.sessionId==='fixture'?0:2);}});"
            let process = AcpProcess("node", ["-e", fixture, scenario, path], workingDirectory: Path("."))
            @Expect(process.start(), true)
            try {
                acpValidateInitialization(process.acpInitialize(1, "SaCode", "test").getOrThrow())
                @Expect(acpReadCreatedSession(process.sessionNew(root).getOrThrow()), "fixture")
                @Expect(process.close(), 0)
                let recorded = String.fromUtf8(File.readFrom(path))
                @Expect(recorded.contains("session/close"), scenario == "supported")
            } finally { process.kill() }
        }
    } finally { removeIfExists(root, recursive: true) }
}
