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
