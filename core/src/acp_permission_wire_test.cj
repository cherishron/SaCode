package core
import std.fs.*
import std.unittest.*

class AcpPermissionWireCounter { var grants: Int64 = 0; var writes: Int64 = 0 }

func acpWireFixtureFrame(generation: Int64): AcpInboundFrame {
    return acpDecodeInbound("{\"jsonrpc\":\"2.0\",\"id\":\"permission\",\"method\":\"session/request_permission\",\"params\":{\"sessionId\":\"fixture\",\"toolCall\":{\"toolCallId\":\"tool1\"},\"options\":[{\"optionId\":\"always\",\"name\":\"永久\",\"kind\":\"allow_always\"},{\"optionId\":\"once\",\"name\":\"一次\",\"kind\":\"allow_once\"},{\"optionId\":\"reject\",\"name\":\"拒绝\",\"kind\":\"reject_once\"}]}}", generation: generation)
}

@Test
func acpWirePermissionDoesNotSelectFirstOrPermanentOption() {
    let permission = acpReadWirePermission(acpWireFixtureFrame(1))
    @Expect(acpWirePermissionOutcome(permission, "allowed-once", "once").contains("\"optionId\":\"once\""), true)
    @ExpectThrows[Exception](acpWirePermissionOutcome(permission, "allowed-once", "always"))
    @ExpectThrows[Exception](acpWirePermissionOutcome(permission, "allowed-once", "missing"))
    @ExpectThrows[Exception](acpWirePermissionOutcome(permission, "denied", "once"))
    @Expect(acpWirePermissionOutcome(permission, "cancelled", "").contains("cancelled"), true)
    let duplicated = acpDecodeInbound(acpWireFixtureFrame(1).raw.replace("\"reject\"", "\"once\""), generation: 1)
    @ExpectThrows[Exception](acpReadWirePermission(duplicated))
}

@Test
func acpWireReplyBindsGenerationRawProposalAndConsumesBeforeWrite() {
    let replies = AcpPermissionReplies()
    let frame = acpWireFixtureFrame(1)
    replies.reset(1)
    @Expect(replies.register(frame), true)
    @Expect(replies.register(frame), false)
    let counter = AcpPermissionWireCounter()
    let altered = acpDecodeInbound(frame.raw.replace("tool1", "other-tool"), generation: 1)
    @Expect(replies.deliverExact(altered, { => counter.grants += 1; true }, { => counter.writes += 1; true }), false)
    @Expect(counter.grants, 0)
    @Expect(replies.deliverExact(frame, { => false }, { => counter.writes += 1; true }), false)
    @Expect(counter.writes, 0)
    @Expect(replies.deliverExact(frame, { => counter.grants += 1; true }, { => counter.writes += 1; false }), false)
    @Expect(replies.deliverExact(frame, { => counter.grants += 1; true }, { => counter.writes += 1; true }), false)
    @Expect(counter.grants, 1)
    @Expect(counter.writes, 1)
    replies.reset(2)
    let next = acpWireFixtureFrame(2)
    @Expect(replies.register(next), true)
    @Expect(replies.deliverExact(frame, { => true }, { => true }), false)
    @Expect(replies.deliverExact(next, { => true }, { => true }), true)
}

@Test
func acpWirePermissionRepliesTravelThroughRealPipeOnce() {
    let fixture = "const rl=require('node:readline').createInterface({input:process.stdin});let count=0,ok=true;rl.on('line',s=>{const f=JSON.parse(s),send=o=>console.log(JSON.stringify(o));if(f.method==='initialize')send({jsonrpc:'2.0',id:f.id,result:{protocolVersion:1,agentCapabilities:{}}});else if(f.method==='session/new')send({jsonrpc:'2.0',id:f.id,result:{sessionId:'fixture'}});else if(f.method==='session/prompt'){for(const id of ['permission1','permission2'])send({jsonrpc:'2.0',id,method:'session/request_permission',params:{sessionId:'fixture',toolCall:{toolCallId:'tool1'},options:[{optionId:'always',name:'Permanent',kind:'allow_always'},{optionId:'once',name:'Once',kind:'allow_once'},{optionId:'reject',name:'Reject',kind:'reject_once'}]}});}else if(f.method==='probe/ready')send({jsonrpc:'2.0',id:f.id,result:{ready:true}});else if(f.id==='permission1'||f.id==='permission2'){ok=ok&&f.result?.outcome?.outcome==='selected'&&f.result.outcome.optionId===(f.id==='permission1'?'once':'reject');if(++count===2)send({jsonrpc:'2.0',id:3,result:{verified:ok}});}});"
    let process = AcpProcess("node", ["-e", fixture], workingDirectory: Path("."))
    @Expect(process.start(), true)
    try {
        acpValidateInitialization(process.acpInitialize(1, "SaCode", "test").getOrThrow())
        @Expect(acpReadCreatedSession(process.sessionNew(".").getOrThrow()), "fixture")
        @Expect(process.sendRequest(3, "session/prompt", "{}"), true)
        process.request(4, "probe/ready", "{}").getOrThrow()
        let first = process.nextInbound().getOrThrow()
        let second = process.nextInbound().getOrThrow()
        @Expect(process.replyPermission(first, "allowed-once", "once"), false)
        @Expect(process.replyPermission(first, "allowed-once", "always", authorize: { => true }), false)
        let altered = acpDecodeInbound(first.raw.replace("tool1", "different"), generation: first.generation)
        @Expect(process.replyPermission(altered, "allowed-once", "once", authorize: { => true }), false)
        @Expect(process.replyPermission(first, "allowed-once", "once", authorize: { => true }), true)
        @Expect(process.replyPermission(first, "allowed-once", "once", authorize: { => true }), false)
        @Expect(process.replyPermission(second, "denied", "reject", authorize: { => true }), true)
        @Expect(process.awaitReply(3, 5000).getOrThrow().contains("\"verified\":true"), true)
    } finally { process.kill() }
}

@Test
func acpOldTransportReaderCannotQueueStalePermission() {
    let process = AcpProcess("nonexistent-stale-reader", [], workingDirectory: Path("."))
    @Expect(process.routeInbound(acpWireFixtureFrame(42).raw, expectedGeneration: Some(42)), false)
    @Expect(process.nextInbound().isNone(), true)
    @Expect(process.routeInbound(acpWireFixtureFrame(0).raw, expectedGeneration: Some(0)), true)
    @Expect(process.nextInbound().getOrThrow().generation, 0)
}
