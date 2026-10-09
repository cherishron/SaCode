package core
import std.fs.*
import std.env.*
import std.sync.*
import std.unittest.*
import stdx.encoding.json.*

// 每个夹具只在本轮独占 TMP 下落盘，不清理其他会话的路径。
class TeamBoardFixture {
    let path: String
    let log: SessionLog
    let lease: WriteLease
    let board: TeamBoard
    init() {
        let file = File.createTemp(Path(getVariable("TMP").getOrThrow()))
        path = file.info.path.toString(); file.close()
        log = SessionLog(path); lease = WriteLease(path)
        if (!lease.acquire()) { throw Exception("team-test-lease") }
        board = TeamBoard(log, lease)
        board.join("leader-session", "leader", "leader", "leader-session")
        board.join("leader-session", "a", "worker", "a-session")
        board.join("leader-session", "b", "reviewer", "b-session")
    }
    func close(): Unit { board.close(); lease.release(); removeIfExists(path) }
}
func teamBoardObject(text: String): JsonObject { return JsonValue.fromStr(text).asObject() }
func teamBoardText(obj: JsonObject, key: String): String { return obj.get(key).getOrThrow().asString().getValue() }

@Test
func teamBoardReplayPreservesJsonAndImmutableSnapshot() {
    let f = TeamBoardFixture()
    try {
        let special = "标题::\"中文\"\n下一行\\尾"
        f.board.join("leader-session", "成员::\"甲\"", "职责::中文", "会话::\"甲\"")
        f.board.createTask("leader-session", "任务::\"甲\"", special, Array<String>())
        let before = f.board.snapshot()
        let message = f.board.send("a-session", "成员::\"甲\"", special)
        @Expect(f.log.pendingCount(), Int64(0))
        @Expect(before.contains(message), false)
        f.board.close()
        let restored = SessionLog(f.path); @Expect(restored.load(), true)
        let board = TeamBoard(restored, f.lease)
        try {
            @Expect(teamBoardText(teamBoardObject(board.task("任务::\"甲\"")), "title"), special)
            let pending = JsonValue.fromStr(board.pending("会话::\"甲\"")).asArray()
            @Assert(pending.size(), Int64(1))
            @Expect(teamBoardText(pending.get(0).getOrThrow().asObject(), "text"), special)
            @Expect(teamBoardText(pending.get(0).getOrThrow().asObject(), "sender"), "a")
            @Expect(teamBoardText(pending.get(0).getOrThrow().asObject(), "senderSessionId"), "a-session")
            @Expect(restored.deriveMessages().size, Int64(0))
        } finally { board.close() }
    } finally { f.close() }
}

@Test
func teamBoardLeaderAuthorizationUniqueMembersAndExit() {
    let f = TeamBoardFixture()
    try {
        @ExpectThrows[Exception](f.board.join("a-session", "x", "worker", "x-session"))
        @ExpectThrows[Exception](f.board.join("leader-session", "a", "worker", "new-session"))
        @ExpectThrows[Exception](f.board.join("leader-session", "x", "worker", "a-session"))
        @ExpectThrows[Exception](f.board.join("leader-session", "x", "leader", "x-session"))
        @ExpectThrows[Exception](f.board.createTask("a-session", "bad", "不能越权", Array<String>()))
        @ExpectThrows[Exception](f.board.createTask("unknown", "bad", "未知身份", Array<String>()))
        f.board.createTask("leader-session", "t", "任务", Array<String>())
        @ExpectThrows[Exception](f.board.assign("a-session", "t", "b"))
        @ExpectThrows[Exception](f.board.assign("leader-session", "t", "missing"))
        @ExpectThrows[Exception](f.board.leave("a-session", "b"))
        f.board.leave("a-session", "a")
        @ExpectThrows[Exception](f.board.claim("a-session", "t"))
        @ExpectThrows[Exception](f.board.join("leader-session", "a", "worker", "new-session"))
        @ExpectThrows[Exception](f.board.send("a-session", "b", "退出不能发送"))
    } finally { f.close() }
}

@Test
func teamBoardDependencyAssignmentOwnershipAndTerminalState() {
    let f = TeamBoardFixture()
    try {
        f.board.createTask("leader-session", "base", "前置", Array<String>())
        f.board.createTask("leader-session", "dependent", "后置", ["base"])
        @ExpectThrows[Exception](f.board.createTask("leader-session", "unknown-dep", "未知依赖", ["missing"]))
        @ExpectThrows[Exception](f.board.createTask("leader-session", "self", "自依赖", ["self"]))
        @ExpectThrows[Exception](f.board.createTask("leader-session", "base", "重复", Array<String>()))
        @ExpectThrows[Exception](f.board.claim("a-session", "dependent"))
        @ExpectThrows[Exception](f.board.complete("a-session", "base", "未认领"))
        f.board.assign("leader-session", "base", "a")
        @ExpectThrows[Exception](f.board.claim("b-session", "base"))
        @Expect(f.board.claim("a-session", "base"), true)
        @Expect(f.board.claim("a-session", "base"), false)
        @ExpectThrows[Exception](f.board.complete("b-session", "base", "冒领"))
        @ExpectThrows[Exception](f.board.complete("a-session", "base", "   "))
        f.board.complete("a-session", "base", "已验证::\"中文\"")
        @Expect(f.board.claim("b-session", "base"), false)
        @ExpectThrows[Exception](f.board.assign("leader-session", "base", "b"))
        @ExpectThrows[Exception](f.board.complete("a-session", "base", "篡改结果"))
        @Expect(f.board.claim("b-session", "dependent"), true)
        @Expect(teamBoardText(teamBoardObject(f.board.task("base")), "phase"), "completed")
        @Expect(teamBoardText(teamBoardObject(f.board.task("base")), "result"), "已验证::\"中文\"")
    } finally { f.close() }
}

@Test
func teamBoardTwoSpawnClaimsHaveExactlyOneWinner() {
    let f = TeamBoardFixture()
    try {
        f.board.createTask("leader-session", "race", "竞争", Array<String>())
        let ready = AtomicInt64(0); let start = AtomicBool(false)
        let a = spawn { => ready.fetchAdd(1); while (!start.load()) {} ; f.board.claim("a-session", "race") }
        let b = spawn { => ready.fetchAdd(1); while (!start.load()) {} ; f.board.claim("b-session", "race") }
        while (ready.load() != 2) {}; start.store(true)
        let wonA = a.get(); let wonB = b.get()
        @Expect(wonA != wonB, true)
        let owner = teamBoardText(teamBoardObject(f.board.task("race")), "owner")
        @Expect(owner, if (wonA) { "a" } else { "b" })
    } finally { f.close() }
}

@Test
func teamBoardDirectedMessagesConfirmIdempotentlyWithoutModelClaim() {
    let f = TeamBoardFixture()
    try {
        @ExpectThrows[Exception](f.board.send("unknown", "b", "非法身份"))
        @ExpectThrows[Exception](f.board.send("a-session", "missing", "未知目标"))
        let id = f.board.send("a-session", "b", "定向::\"中文\"")
        let second = f.board.send("a-session", "b", "第二条")
        @Expect(id != second, true)
        @Expect(JsonValue.fromStr(f.board.pending("a-session")).asArray().size(), Int64(0))
        @Expect(JsonValue.fromStr(f.board.pending("b-session")).asArray().size(), Int64(2))
        @ExpectThrows[Exception](f.board.acknowledge("a-session", id))
        @ExpectThrows[Exception](f.board.acknowledge("unknown", id))
        @ExpectThrows[Exception](f.board.acknowledge("b-session", "missing"))
        f.board.acknowledge("b-session", id)
        let count = f.log.eventCount()
        f.board.acknowledge("b-session", id)
        @Expect(f.log.eventCount(), count)
        @Expect(JsonValue.fromStr(f.board.pending("b-session")).asArray().size(), Int64(1))
        @Expect(JsonValue.fromStr(f.board.delivered("b-session")).asArray().size(), Int64(1))
        @Expect(f.log.deriveMessages().size, Int64(0))
        let expected = f.board.snapshot(); f.board.close()
        let restored = TeamBoard(SessionLog(f.path), f.lease)
        try { @Expect(restored.snapshot(), expected) } finally { restored.close() }
    } finally { f.close() }
}

@Test
func teamBoardRejectsMultipleInstancesEvenWithSharedLease() {
    let f = TeamBoardFixture()
    try {
        @ExpectThrows[Exception](TeamBoard(f.log, f.lease))
        @ExpectThrows[Exception](TeamBoard(SessionLog(f.path), f.lease))
        let rival = WriteLease(f.path)
        @Expect(rival.acquire(), false)
        @ExpectThrows[Exception](TeamBoard(SessionLog(f.path), rival))
        f.board.close()
        @ExpectThrows[Exception](f.board.snapshot())
        let replacement = TeamBoard(SessionLog(f.path), f.lease)
        try { @Expect(JsonValue.fromStr(replacement.snapshot()).asObject().get("members").getOrThrow().asArray().size(), Int64(3)) }
        finally { replacement.close() }
    } finally { f.close() }
}

@Test
func teamBoardDurabilityFailureNeverReturnsSuccessAndFreezesReads() {
    let f = TeamBoardFixture()
    try {
        let durable = String.fromUtf8(File.readFrom(f.path))
        var oversized = ""; for (_ in 0..5000) { oversized += "x" }
        @ExpectThrows[Exception](f.board.send("a-session", "b", oversized))
        @Expect(f.log.isDurableFrozen(), true)
        @ExpectThrows[Exception](f.board.snapshot())
        @ExpectThrows[Exception](f.board.pending("b-session"))
        @ExpectThrows[Exception](f.board.createTask("leader-session", "t", "拒写", Array<String>()))
        @ExpectThrows[Exception](f.log.snapshotEvents())
        @Expect(f.lease.protects(f.path), true)
        @Expect(String.fromUtf8(File.readFrom(f.path)), durable)
        f.board.close()
        let restored = TeamBoard(SessionLog(f.path), f.lease)
        try { @Expect(JsonValue.fromStr(restored.pending("b-session")).asArray().size(), Int64(0)) }
        finally { restored.close() }
    } finally { f.close() }
}

@Test
func teamBoardLostLeaseRejectsWritesAndReads() {
    let f = TeamBoardFixture()
    try {
        @Expect(f.lease.release(), true)
        @ExpectThrows[Exception](f.board.createTask("leader-session", "lost", "不可提交", Array<String>()))
        @Expect(f.log.isDurableFrozen(), true)
        @ExpectThrows[Exception](f.board.snapshot())
    } finally { f.close() }
}
