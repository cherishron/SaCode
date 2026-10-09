package core

import std.unittest.*
import std.collection.*
import std.env.*
import std.time.*
import std.fs.*
import std.io.*
import std.process.*
import std.net.*
import stdx.encoding.json.*

func hxInput(): HookInput {
    return HookInput(sessionId: "会话", transcriptPath: "a\\b", cwd: getWorkingDirectory().toString(),
        hookEventName: "PreToolUse", timestamp: 123, agentId: Some("agent"), agentType: Some("test"),
        eventSpecific: HookEventData.Tool("read", "{\"path\":\"x\"}"))
}

func hxNode(script: String, timeout!: Int64 = 5000): HookResult {
    return HookExecutor.executeCommand("node -e \"${script}\"", None, HashMap<String, String>(), hxInput(), timeout)
}

@Test
func testHookRealCommandAllDecisionsAndFields() {
    for (decision in ["deny", "ask", "allow", "block"]) {
        let script = "let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',()=>{const i=JSON.parse(s);process.stdout.write(JSON.stringify({decision:'${decision}',reason:i.sessionId,additionalContext:i.eventSpecific.toolId,updatedInput:i.eventSpecific.toolInput,continueFlag:false,suppressOutput:true,systemMessage:i.agentId}));});"
        let r = hxNode(script)
        @Expect(r.decision, match (decision) { case "deny" => HookDecision.Deny; case "ask" => HookDecision.Ask; case "block" => HookDecision.Block; case _ => HookDecision.Allow })
        @Expect(r.reason, Some("会话"))
        @Expect(r.additionalContext, Some("read"))
        @Expect(r.updatedInput, Some("{\"path\":\"x\"}"))
        @Expect(r.continueFlag, false)
        @Expect(r.suppressOutput, true)
        @Expect(r.systemMessage, Some("agent"))
    }
}

@Test
func testHookRealCommandExitCodes() {
    let denied = hxNode("process.stderr.write('真实拒绝');process.exitCode=2;")
    @Expect(denied.decision, HookDecision.Deny)
    @Expect(denied.reason, Some("真实拒绝"))
    @Expect(hxNode("process.stderr.write('ignored');process.exitCode=3;").decision, HookDecision.Allow)
    @Expect(hxNode("process.stdout.write('not json');").decision, HookDecision.Allow)
}

@Test
func testHookCommandTimeoutAndLargePipes() {
    let started = MonoTime.now()
    let r = hxNode("setTimeout(()=>{},30000);", timeout: 150)
    @Expect(r.decision, HookDecision.Allow)
    @Assert(MonoTime.now() - started < Duration.second * 5)
    let large = hxNode("process.stdout.write(' '.repeat(300000)+JSON.stringify({decision:'ask'}));process.stderr.write('x'.repeat(300000));")
    @Expect(large.decision, HookDecision.Ask)
}

func hxMarkerPresent(p: Path): Bool {
    try { return File.readFrom(p).size > 0 } catch (_: Exception) { return false }
}

// 超时不能留下孤儿进程：子进程 3 秒后才落标记，hook 只给 200ms，标记出现即证明没回收。
@Test
func testHookCommandTimeoutReapsChild() {
    let file = File.createTemp(getTempDirectory())
    let marker = file.info.path
    file.close()
    try { remove(marker) } catch (_: Exception) {}
    let env = HashMap<String, String>()
    env["HOOKMARKER"] = marker.toString()
    let script = "setTimeout(()=>{require('fs').writeFileSync(process.env.HOOKMARKER,'x')},3000);"
    HookExecutor.executeCommand("node -e \"${script}\"", None, env, hxInput(), 200)
    var tries: Int64 = 0
    while (!hxMarkerPresent(marker) && tries < 80) {
        sleep(Duration.millisecond * 50)
        tries += 1
    }
    @Expect(hxMarkerPresent(marker), false)
    try { remove(marker) } catch (_: Exception) {}
}

@Test
func testHookDefaultHttpWhitelistClosed() {
    @Expect(HookExecutor.executeHttp("http://127.0.0.1:1/hook", HashMap<String, String>(), [], hxInput(), 100).decision, HookDecision.Deny)
}

@Test
func testHookHttpRealPostRedirectTimeoutAndEnvironment() {
    let file = File.createTemp(getTempDirectory())
    let path = file.info.path
    file.close()
    let script = "const h=require('http');let redirects=0;h.createServer((q,r)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{if(q.url==='/redirect'){r.writeHead(302,{location:'/target'});r.end();return;}if(q.url==='/target')redirects++;if(q.url==='/slow'){setTimeout(()=>r.end('{}'),3000);return;}if(q.url==='/error'){r.writeHead(500);r.end('{\\\"decision\\\":\\\"deny\\\"}');return;}const i=JSON.parse(b);r.end(JSON.stringify({decision:q.method==='POST'&&i.eventSpecific.toolId==='read'?'ask':'deny',reason:q.headers['x-audit']||i.sessionId,additionalContext:String(redirects),updatedInput:i.eventSpecific.toolInput}));});}).listen(0,'127.0.0.1',function(){console.log(this.address().port);});"
    File.writeTo(path, script.toArray())
    let server = launch("node", [path.toString()], stdOut: ProcessRedirect.Pipe, stdErr: ProcessRedirect.Discard)
    try {
        let line = StringReader(server.stdOutPipe).readln().getOrThrow()
        let origin = "http://127.0.0.1:${line}"
        let urls = [origin + "/10.hook", origin + "/redirect", origin + "/error", origin + "/slow"]
        let policy = HookSecurityPolicy(allowedHookUrls: urls, allowedHookEnvVars: ["SACODE_HOOK_TEST_TOKEN"])
        let headers = HashMap<String, String>()
        setVariable("SACODE_HOOK_TEST_TOKEN", "audit")
        headers["x-audit"] = "\u{0024}{SACODE_HOOK_TEST_TOKEN}"
        let denied = HookExecutor.executeHttp(urls[0], headers, [], hxInput(), 1000, policy: policy)
        @Expect(denied.decision, HookDecision.Deny)
        let r = HookExecutor.executeHttp(urls[0], headers, ["SACODE_HOOK_TEST_TOKEN"], hxInput(), 1000, policy: policy)
        @Expect(r.decision, HookDecision.Ask)
        @Expect(r.reason, Some("audit"))
        @Expect(r.updatedInput, Some("{\"path\":\"x\"}"))
        @Expect(HookExecutor.executeHttp(urls[1], HashMap<String, String>(), [], hxInput(), 1000, policy: policy).decision, HookDecision.Allow)
        @Expect(HookExecutor.executeHttp(urls[2], HashMap<String, String>(), [], hxInput(), 1000, policy: policy).decision, HookDecision.Allow)
        let after = HookExecutor.executeHttp(urls[0], HashMap<String, String>(), [], hxInput(), 1000, policy: policy)
        @Expect(after.additionalContext, Some("0"))
        let started = MonoTime.now()
        @Expect(HookExecutor.executeHttp(urls[3], HashMap<String, String>(), [], hxInput(), 100, policy: policy).decision, HookDecision.Allow)
        @Assert(MonoTime.now() - started < Duration.second * 2)
    } finally {
        server.terminate(force: true)
        server.wait(timeout: Duration.second * 2)
        remove(path)
        removeVariable("SACODE_HOOK_TEST_TOKEN")
    }
}

@Test
func testHookHttpAddressPolicyAndUserinfo() {
    let policy = HookSecurityPolicy()
    for (address in ["10.0.0.1", "172.31.1.1", "192.168.1.1", "169.254.169.254", "fc00::1", "fe80::1", "::ffff:127.0.0.1"]) {
        @Expect(hookAddressAllowed(IPAddress.parse(address), policy), false)
    }
    for (address in ["127.0.0.1", "::1", "8.8.8.8"]) {
        @Expect(hookAddressAllowed(IPAddress.parse(address), policy), true)
    }
    let privatePolicy = HookSecurityPolicy(allowPrivateNetworkHooks: true)
    @Expect(hookAddressAllowed(IPAddress.parse("10.0.0.1"), privatePolicy), true)
    @Expect(hookAddressAllowed(IPAddress.parse("169.254.169.254"), privatePolicy), false)
    let url = "http://user@127.0.0.1:1/hook"
    @Expect(HookExecutor.executeHttp(url, HashMap<String, String>(), [], hxInput(), 100,
        policy: HookSecurityPolicy(allowedHookUrls: [url])).decision, HookDecision.Deny)
}

@Test
func testHookEventSpecificSerializationAllVariants() {
    let variants = [HookEventData.Tool("t", "i"), HookEventData.Prompt(None, "p"), HookEventData.Session("s"),
        HookEventData.End("r"), HookEventData.Delete, HookEventData.Message("r", "c"), HookEventData.Stop(1, 2, 3),
        HookEventData.StopFailure("e"), HookEventData.Subagent("a", "t"), HookEventData.Compact("t"),
        HookEventData.Notification("n"), HookEventData.Permission("t"), HookEventData.Todo("i", "c"),
        HookEventData.Webhook("i", "k"), HookEventData.Schedule("i", "c"), HookEventData.WorkflowStep("i", "l", Some("r"))]
    let expected = ["toolInput", "submittedPrompt", "source", "reason", "", "contentPreview", "inputTokens",
        "error", "agentType", "trigger", "type", "toolId", "content", "kind", "cron", "reason"]
    for (index in 0..variants.size) {
        let input = HookInput(sessionId: "s", transcriptPath: "p", cwd: "", hookEventName: "e", timestamp: 1, eventSpecific: variants[index])
        let json = JsonValue.fromStr(hookInputJson(input)).asObject()
        let data = json["eventSpecific"].asObject()
        if (expected[index].size > 0) { @Assert(data.get(expected[index]).isSome()) }
        @Expect(json["timestamp"].asInt().getValue(), 1)
    }
}
