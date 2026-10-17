package core
import std.unittest.*
import std.fs.*

@Test
func acpInboundSeparatesRequestsNotificationsAndReplies() {
    let request = acpDecodeInbound("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session/request_permission\",\"params\":{}}")
    let reply = acpDecodeInbound("{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}")
    let update = acpDecodeInbound("{\"jsonrpc\":\"2.0\",\"method\":\"session/update\",\"params\":{}}")
    @Expect(request.kind, "request")
    @Expect(reply.kind, "response")
    @Expect(update.kind, "notification")
    let inbox = AcpInboundInbox(capacity: 1)
    @Expect(inbox.put(reply), false)
    @Expect(inbox.put(request), true)
    @Expect(inbox.put(update), false)
    @Expect(inbox.take().getOrThrow().method, "session/request_permission")
    @Expect(inbox.take().isNone(), true)
    @Expect(inbox.put(update), true)
}

@Test
func acpInboundRejectsAmbiguousAndInvalidFrames() {
    @ExpectThrows[Exception](acpDecodeInbound("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session/update\",\"params\":{},\"result\":{}}"))
    @ExpectThrows[Exception](acpDecodeInbound("{\"jsonrpc\":\"2.0\",\"id\":null,\"method\":\"session/request_permission\",\"params\":{}}"))
    @ExpectThrows[Exception](acpDecodeInbound("{\"jsonrpc\":\"2.0\",\"id\":1}"))
    @ExpectThrows[Exception](acpDecodeInbound("{\"jsonrpc\":\"1.0\",\"id\":1,\"result\":{}}"))
    let request = acpDecodeInbound("{\"jsonrpc\":\"2.0\",\"id\":\"remote-1\",\"method\":\"session/request_permission\",\"params\":{}}")
    @Expect(request.idJson, "\"remote-1\"")
}

@Test
func acpProcessInboundRequestDoesNotConsumeLocalReplyIdentity() {
    let process = AcpProcess("nonexistent-inbound-test", [], workingDirectory: Path("."))
    @Expect(process.routeInbound("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session/request_permission\",\"params\":{}}"), true)
    @Expect(process.unsolicited(), 0)
    @Expect(process.nextInbound().getOrThrow().idJson, "1")
    @Expect(process.routeInbound("{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}"), true)
    @Expect(process.unsolicited(), 1)
    @Expect(process.nextInbound().isNone(), true)
    @Expect(process.routeInbound("not-json"), false)
    @Expect(process.invalidInboundCount(), 1)
}

@Test
func acpInboundRoutesRealPipeAndRejectsUnknownRequest() {
    let fixture = "const rl=require('node:readline').createInterface({input:process.stdin});const send=o=>console.log(JSON.stringify(o));rl.on('line',s=>{const f=JSON.parse(s);if(f.method==='initialize'){send({jsonrpc:'2.0',id:f.id,method:'session/request_permission',params:{sessionId:'fixture'}});send({jsonrpc:'2.0',method:'session/update',params:{sessionId:'fixture',update:{sessionUpdate:'agent_message_chunk'}}});send({jsonrpc:'2.0',id:'unknown',method:'fs/write_text_file',params:{}});}else if(f.id==='unknown'&&f.error){send({jsonrpc:'2.0',id:1,result:{unknownRejected:f.error.code===-32601}});}});"
    let process = AcpProcess("node", ["-e", fixture], workingDirectory: Path("."))
    @Expect(process.start(), true)
    try {
        let reply = process.request(1, "initialize", "{}", timeoutMs: 5000).getOrThrow()
        @Expect(reply.contains("\"unknownRejected\":true"), true)
        let permission = process.nextInbound().getOrThrow()
        let update = process.nextInbound().getOrThrow()
        @Expect(permission.method, "session/request_permission")
        @Expect(permission.idJson, "1")
        @Expect(update.method, "session/update")
        @Expect(process.nextInbound().isNone(), true)
        @Expect(process.unsolicited(), 0)
    } finally { process.kill() }
}

@Test
func acpCancelIsNotificationAndDoesNotAwaitOwnReply() {
    let fixture = "const rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',s=>{const f=JSON.parse(s);if(f.method==='session/cancel'){console.log(JSON.stringify({jsonrpc:'2.0',id:1,result:{cancelWasNotification:!Object.hasOwn(f,'id'),session:f.params.sessionId}}));}});"
    let process = AcpProcess("node", ["-e", fixture], workingDirectory: Path("."))
    @Expect(process.sessionCancel("fixture"), false)
    @Expect(process.start(), true)
    try {
        @Expect(process.sendRequest(1, "session/prompt", "{}"), true)
        @Expect(process.sessionCancel(""), false)
        @Expect(process.sessionCancel("fixture"), true)
        let turnResult = process.awaitReply(1, 5000).getOrThrow()
        @Expect(turnResult.contains("\"cancelWasNotification\":true"), true)
        @Expect(turnResult.contains("\"session\":\"fixture\""), true)
        @Expect(process.nextInbound().isNone(), true)
        @Expect(process.unsolicited(), 0)
    } finally { process.kill() }
}
