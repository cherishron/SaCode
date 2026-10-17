package core
import std.unittest.*
import std.fs.*
import std.env.*

class PageFixtureProvider <: PageToolProvider {
    var calls: Int64 = 0
    var wrongSession = false
    var cancelOnDispatch = false
    var result = ##"{"ok":true}"##
    public func execute(request: PageToolRequest): PageToolReply {
        calls += 1
        if (cancelOnDispatch) { request.token.cancel() }
        return PageToolReply(if (wrongSession) { "other" } else { request.sessionId }, request.requestId, result)
    }
}
class PageFixture {
    let root: String
    let log: SessionLog
    let desk: ApprovalDesk
    let provider = PageFixtureProvider()
    let token = TurnToken()
    let registry = ToolRegistry()
    let runtime: ToolRuntime
    init() {
        root = Directory.createTemp(Path(getVariable("TMP").getOrThrow())).toString()
        log = SessionLog(Path(root).join("session.log").toString()); desk = ApprovalDesk(log)
        for (spec in pageToolSpecs()) { registry.register(spec) }
        runtime = ToolRuntime(log, registry, lspToken: token, page: Some(PageToolExecutor(provider, "s1")))
    }
    func ticket(name: String, args: String): Int64 {
        let id = desk.askForCall(name, args); desk.answer(id, "allowed-once"); return id
    }
    func close() { removeIfExists(root, recursive: true) }
}

class PageChunks <: Provider {
    let chunks: Array<Chunk>
    var cursor: Int64 = 0
    init(chunks: Array<Chunk>) { this.chunks = chunks }
    public func next(): ?Chunk {
        if (cursor >= chunks.size) { return None }
        let chunk = chunks[cursor]; cursor += 1; return Some(chunk)
    }
}

@Test
func pageToolsFeedTheModelWithoutAdvancingGoalEvidence() {
    let f = PageFixture()
    try {
        let runtime = ModelToolRuntime(f.log, false, page: Some(PageToolExecutor(f.provider, "s1")))
        let first = PageChunks([Chunk("tool-call-delta", "{}", "", toolIndex: Some(0), toolId: Some("page-read"), toolName: Some("page_read_state")), Chunk("finish", "", "tool_calls")])
        let final = PageChunks([Chunk("text", "read", ""), Chunk("finish", "", "stop")])
        let result = ModelAgentLoop().run(first, { _ => final }, "fixture-model", f.token, f.log, DeliveryQueue(32), false, toolRuntime: Some(runtime))
        @Expect(result.settledToolCalls, 1)
        @Expect(result.successfulToolCalls, 0)
        @Expect(f.provider.calls, 1)
        @Expect(GoalEvidence(f.log).count(), 0)
    } finally { f.close() }
}

@Test
func pageToolsRequireExactApprovalAndConsumeItOnce() {
    let f = PageFixture()
    try {
        let args = ##"{"selector":"#send"}"##
        @Expect(f.runtime.execute("page.clickElement", args, "allowed-once", true).allowed, false)
        let legacy = f.desk.ask("page.clickElement"); f.desk.answer(legacy, "allowed-once")
        @Expect(f.runtime.executeWithApproval("page.clickElement", args, legacy, true, f.desk).allowed, false)
        let exact = f.ticket("page.clickElement", args)
        @Expect(f.runtime.executeWithApproval("page.clickElement", ##"{"selector":"#delete"}"##, exact, true, f.desk).allowed, false)
        @Expect(f.provider.calls, 0)
        @Expect(f.runtime.executeWithApproval("page.clickElement", args, exact, true, f.desk).allowed, true)
        @Expect(f.runtime.lastDetail.verified, false)
        @Expect(f.runtime.executeWithApproval("page.clickElement", args, exact, true, f.desk).allowed, false)
        @Expect(f.provider.calls, 1)
    } finally { f.close() }
}

@Test
func pageToolsRejectPlanMutationsAndCancelledDispatch() {
    let f = PageFixture()
    try {
        let args = ##"{"selector":"#send"}"##
        ModeController(f.log).set("plan")
        @Expect(f.runtime.executeWithApproval("page.clickElement", args, f.ticket("page.clickElement", args), true, f.desk).allowed, false)
        @Expect(f.provider.calls, 0)
        @Expect(f.runtime.execute("page.readState", "{}", "", true).allowed, true)
        f.token.cancel()
        @Expect(f.runtime.execute("page.readState", "{}", "", true).allowed, false)
        @Expect(f.provider.calls, 1)
    } finally { f.close() }
}

@Test
func pageToolsDoNotAcceptLateForeignOrFailedReplies() {
    let f = PageFixture()
    try {
        f.provider.wrongSession = true
        @Expect(f.runtime.execute("page.readState", "{}", "", true).why, "outcome-unknown:page-reply-identity-mismatch")
        f.provider.wrongSession = false; f.provider.result = ##"{"error":"not-found"}"##
        @Expect(f.runtime.execute("page.readState", "{}", "", true).allowed, false)
        f.provider.result = ##"{"ok":true}"##; f.provider.cancelOnDispatch = true
        @Expect(f.runtime.execute("page.readState", "{}", "", true).why, "outcome-unknown:page-cancelled-after-dispatch")
    } finally { f.close() }
}

@Test
func pageToolsRejectMalformedArgumentsBeforeProviderDispatch() {
    let f = PageFixture()
    try {
        let executor = PageToolExecutor(f.provider, "s1")
        for ((name, args) in [("page.clickElement", "{}"), ("page.inputText", ##"{"selector":"#x","text":1}"##),
            ("page.scroll", ##"{"x":"1"}"##), ("page.readState", ##"{"code":"deleteEverything()"}"##)]) {
            @Expect(executor.execute(name, args, f.token).allowed, false)
        }
        @Expect(f.provider.calls, 0)
        @Expect(executor.execute("page.scroll", ##"{"x":0.5,"y":1}"##, f.token).allowed, true)
    } finally { f.close() }
}

@Test
func pageToolsAreDeclaredToModelsOnlyWhenAProviderIsBound() {
    let f = PageFixture()
    try {
        @Expect(ModelToolRuntime(f.log, false).registry.has("page_read_state"), false)
        let model = ModelToolRuntime(f.log, false, page: Some(PageToolExecutor(f.provider, "s1")))
        for (spec in pageModelToolSpecs()) { @Expect(model.registry.has(spec.name), true) }
        let call = ModelToolCall(0); call.id = "page-call"; call.name = "page_click_element"; call.args = ##"{"selector":"#send"}"##
        @Expect(model.execute(call).allowed, false)
        call.name = "page_read_state"; call.args = "{}"
        @Expect(model.execute(call).allowed, true)
        @Expect(f.provider.calls, 1)
    } finally { f.close() }
}
