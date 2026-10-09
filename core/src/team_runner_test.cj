package core
import std.collection.*
import std.fs.*
import std.sync.*
import std.time.*
import std.unittest.*

// 受控真实 Provider：闸门不打开就不会结束，取消检查点可按用例关闭。
class TeamRunnerGate <: Provider & Resource {
    let token: TurnToken
    let cooperative: Bool
    let chunks: Array<Chunk>
    let opened = AtomicBool(false)
    let entered = AtomicBool(false)
    let closed = AtomicBool(false)
    var index: Int64 = 0
    init(token: TurnToken, chunks: Array<Chunk>, cooperative!: Bool = true) {
        this.token = token; this.chunks = chunks; this.cooperative = cooperative
    }
    public func next(): ?Chunk {
        entered.store(true)
        while (!opened.load() && !(cooperative && token.cancelled())) { sleep(Duration.millisecond) }
        if (token.cancelled() && cooperative) { return None }
        if (index >= chunks.size) { return None }
        let chunk = chunks[index]; index += 1; return Some(chunk)
    }
    public func close(): Unit { closed.store(true) }
    public func isClosed(): Bool { return closed.load() }
}

class TeamRunnerFixture {
    let dir: String
    let log: SessionLog
    let lease: WriteLease
    init() {
        dir = Directory.createTemp(Path("D:/Project/sa/saai/sa-code/target")).toString()
        log = SessionLog("${dir}/member.log"); lease = WriteLease(log.path)
        if (!lease.acquire()) { throw Exception("fixture-lease") }
        log.append("user/message", "start"); if (!log.durableCheckpointBatched(lease)) { throw Exception("fixture-durable") }
    }
    func cleanup(): Unit { lease.release(); removeIfExists(dir, recursive: true) }
}

func teamRunnerNoNext(_: String): Provider { throw Exception("unexpected-next-request") }
func teamRunnerAwait(runner: TeamMemberRunner, id: String): TeamMemberPoll {
    let begin = MonoTime.now()
    while (runner.running(id)) {
        if ((MonoTime.now() - begin).toMilliseconds() > 10000) { throw Exception("fixture-run-timeout") }
        sleep(Duration.millisecond)
    }
    return runner.poll(id)
}

@Test
func teamRunnerConcurrentMembersCancelOnlyOneAndPersistSettlement() {
    let a = TeamRunnerFixture(); let b = TeamRunnerFixture(); let runner = TeamMemberRunner()
    let ta = TurnToken(); let tb = TurnToken()
    let pa = TeamRunnerGate(ta, [Chunk("finish", "", "stop")])
    let pb = TeamRunnerGate(tb, [Chunk("text", "member-b-done", ""), Chunk("finish", "", "stop")])
    try {
        runner.start("a", a.log, a.lease, pa, teamRunnerNoNext, "fixture", ModelToolRuntime(a.log, false), token: ta)
        runner.start("b", b.log, b.lease, pb, teamRunnerNoNext, "fixture", ModelToolRuntime(b.log, false), token: tb)
        @Expect(runner.running("a"), true); @Expect(runner.running("b"), true)
        runner.cancel("a")
        let ar = teamRunnerAwait(runner, "a")
        @Expect(ar.result.getOrThrow().cancelled, true)
        @Expect(runner.running("b"), true); @Expect(tb.cancelled(), false)
        pb.opened.store(true)
        let br = teamRunnerAwait(runner, "b")
        @Expect(br.result.getOrThrow().text, "member-b-done")
        @Expect(br.frames.contains("text:member-b-done"), true)
        @Expect(pa.isClosed(), true); @Expect(pb.isClosed(), true)
        let replay = SessionLog(b.log.path); @Expect(replay.load(), true)
        @Expect(replay.deriveMessages().contains("assistant/message: member-b-done"), true)
        @Expect(replay.snapshotEvents().toArray().size, b.log.snapshotEvents().toArray().size)
        @Expect(runner.poll("b").result.getOrThrow().text, "member-b-done")
        @Expect(runner.close(), true); @Expect(a.lease.held(), false); @Expect(b.lease.held(), false)
    } finally { pa.opened.store(true); pb.opened.store(true); runner.close(); a.cleanup(); b.cleanup() }
}

@Test
func teamRunnerToolContinuationIncludesInboxDelivery() {
    let f = TeamRunnerFixture(); let runner = TeamMemberRunner(); let token = TurnToken()
    let first = TeamRunnerGate(token, [
        Chunk("tool-call-delta", "{\"todos\":[{\"content\":\"real-tool\",\"status\":\"pending\"}]}", "", toolIndex: Some(0), toolId: Some("tool-1"), toolName: Some("todo_write")),
        Chunk("finish", "", "tool_calls")])
    let final = TeamRunnerGate(token, [Chunk("text", "received", ""), Chunk("finish", "", "stop")])
    final.opened.store(true)
    let requests = ArrayList<String>()
    let next: (String) -> Provider = { body => requests.add(body); final }
    try {
        runner.start("tool", f.log, f.lease, first, next, "fixture", ModelToolRuntime(f.log, false), token: token)
        let inbox = AgentInbox(f.log); inbox.queue("q", "team-follow-up-42", "rpc"); inbox.steerFromQueue("q")
        first.opened.store(true)
        let poll = teamRunnerAwait(runner, "tool")
        @Expect(poll.result.getOrThrow().settledToolCalls, Int64(1))
        @Expect(requests.size, Int64(1))
        @Expect(requests.toArray().toString().contains("team-follow-up-42"), true)
        @Expect(requests.toArray().toString().contains("tool_call_id"), true)
        @Expect(TodoStore(f.log).projectionJson().contains("real-tool"), true)
        let replay = SessionLog(f.log.path); @Expect(replay.load(), true)
        @Expect(replay.deriveMessages().contains("user/message: team-follow-up-42"), true)
        @Expect(AgentInbox(replay).sizeOf("next-step"), Int64(0))
    } finally { first.opened.store(true); runner.close(); f.cleanup() }
}

@Test
func teamRunnerRejectsDuplicateStartAndSessionAcrossRunners() {
    let f = TeamRunnerFixture(); let runner = TeamMemberRunner(); let other = TeamMemberRunner(); let token = TurnToken()
    let p = TeamRunnerGate(token, [Chunk("finish", "", "stop")])
    try {
        runner.start("a", f.log, f.lease, p, teamRunnerNoNext, "fixture", ModelToolRuntime(f.log, false), token: token)
        var duplicate = false; var session = false; var across = false
        try { runner.start("a", f.log, f.lease, p, teamRunnerNoNext, "fixture", ModelToolRuntime(f.log, false)) } catch (_: Exception) { duplicate = true }
        try { runner.start("b", SessionLog(f.log.path), f.lease, p, teamRunnerNoNext, "fixture", ModelToolRuntime(f.log, false)) } catch (_: Exception) { session = true }
        try { other.start("c", f.log, f.lease, p, teamRunnerNoNext, "fixture", ModelToolRuntime(f.log, false)) } catch (_: Exception) { across = true }
        @Expect(duplicate, true); @Expect(session, true); @Expect(across, true)
        @Expect(other.close(), true); @Expect(f.lease.protects(f.log.path), true)
    } finally { p.opened.store(true); runner.close(); other.close(); f.cleanup() }
}

@Test
func teamRunnerCloseTimeoutRetainsLeaseUntilActualJoin() {
    let f = TeamRunnerFixture(); let runner = TeamMemberRunner(); let token = TurnToken()
    let p = TeamRunnerGate(token, [Chunk("finish", "", "stop")], cooperative: false)
    try {
        runner.start("a", f.log, f.lease, p, teamRunnerNoNext, "fixture", ModelToolRuntime(f.log, false), token: token)
        let begin = MonoTime.now()
        while (!p.entered.load()) {
            if ((MonoTime.now() - begin).toMilliseconds() > 10000) { throw Exception("fixture-enter-timeout") }
            sleep(Duration.millisecond)
        }
        @Expect(runner.close(timeoutMs: 5), false)
        @Expect(runner.running("a"), true); @Expect(f.lease.protects(f.log.path), true)
        p.opened.store(true)
        @Expect(runner.close(timeoutMs: 10000), true); @Expect(f.lease.held(), false)
    } finally { p.opened.store(true); runner.close(); f.cleanup() }
}

@Test
func teamRunnerRecoveryDoesNotStartModelAndRejectsUnownedLease() {
    let f = TeamRunnerFixture(); let runner = TeamMemberRunner()
    try {
        let replay = SessionLog(f.log.path); @Expect(replay.load(), true)
        @Expect(runner.running("recovered"), false)
        var rejected = false
        try { runner.start("bad", replay, WriteLease(f.log.path), TeamRunnerGate(TurnToken(), []), teamRunnerNoNext, "fixture", ModelToolRuntime(replay, false)) } catch (_: Exception) { rejected = true }
        @Expect(rejected, true); @Expect(runner.close(), true)
        @Expect(f.lease.protects(f.log.path), true)
    } finally { runner.close(); f.cleanup() }
}

@Test
func teamRunnerSettlementFailsClosedAfterLeaseLoss() {
    let f = TeamRunnerFixture(); let runner = TeamMemberRunner(); let token = TurnToken()
    let p = TeamRunnerGate(token, [Chunk("text", "not-durable", ""), Chunk("finish", "", "stop")])
    try {
        runner.start("a", f.log, f.lease, p, teamRunnerNoNext, "fixture", ModelToolRuntime(f.log, false), token: token)
        f.lease.release(); p.opened.store(true)
        let begin = MonoTime.now()
        while (runner.running("a")) {
            if ((MonoTime.now() - begin).toMilliseconds() > 10000) { throw Exception("fixture-run-timeout") }
            sleep(Duration.millisecond)
        }
        var rejected = false
        try { runner.poll("a") } catch (_: Exception) { rejected = true }
        @Expect(rejected, true); @Expect(f.log.isDurableFrozen(), true)
    } finally { p.opened.store(true); runner.close(); f.cleanup() }
}
