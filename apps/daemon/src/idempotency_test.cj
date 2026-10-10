package daemon
import core.*

import std.env.*
import std.fs.*
import std.unittest.*
import std.collection.*

// 服务端幂等账（设计 §5「所有写操作使用 operationId；服务端按
// instanceId/principalId/workspaceId/sessionId/method/operationId 建幂等账，
// 同键同规范化内容返回原回执，同键不同内容拒绝」）的语义钉子。
//
// 这一层只回答「这条要不要真做、做过的回执是什么」，不执行任何业务副作用：
// 副作用由调用方在 kind == "execute" 时自己做，再把回执交回账本。

func ledgerKey(l: IdempotencyLedger, instanceId: String, principalId: String,
               workspaceId: String, sessionId: String, method: String,
               operationId: String, digest: String): LedgerOutcome {
    return l.consult(instanceId: instanceId, principalId: principalId,
        workspaceId: workspaceId, sessionId: sessionId, method: method,
        operationId: operationId, contentDigest: digest)
}

@Test
func firstRequestIsExecutedOnceThenReplayed() {
    // 「不自动再次执行」是这条账存在的全部理由：第二次必须拿到原回执，
    // 而不是让宿主再做一遍副作用。
    let l = IdempotencyLedger()
    let first = ledgerKey(l, "i-1", "p-1", "w-1", "s-1", "session/submit", "op-1", "d-a")
    @Expect(first.kind == "execute", true)
    l.recordDone(instanceId: "i-1", principalId: "p-1", workspaceId: "w-1", sessionId: "s-1",
        method: "session/submit", operationId: "op-1", contentDigest: "d-a", receipt: "{\"ok\":1}")
    let second = ledgerKey(l, "i-1", "p-1", "w-1", "s-1", "session/submit", "op-1", "d-a")
    @Expect(second.kind == "replay", true)
    @Expect(second.receipt, "{\"ok\":1}")
    @Expect(l.size(), Int64(1))
}

@Test
func sameKeyDifferentContentIsRejectedNotReplayed() {
    // 同 operationId 换内容必须拒：静默返回旧回执会把两次不同意图合成一次。
    let l = IdempotencyLedger()
    l.recordDone(instanceId: "i-1", principalId: "p-1", workspaceId: "w-1", sessionId: "s-1",
        method: "session/submit", operationId: "op-1", contentDigest: "d-a", receipt: "{\"ok\":1}")
    let clash = ledgerKey(l, "i-1", "p-1", "w-1", "s-1", "session/submit", "op-1", "d-b")
    @Expect(clash.kind == "conflict", true)
    @Expect(clash.receipt.size, Int64(0))
}

@Test
func everyKeyFieldParticipatesInIdentity() {
    // 六元组里任一分量不同就是不同请求。只把 operationId 当键的实现会跨会话串号。
    let l = IdempotencyLedger()
    l.recordDone(instanceId: "i-1", principalId: "p-1", workspaceId: "w-1", sessionId: "s-1",
        method: "session/submit", operationId: "op-1", contentDigest: "d-a", receipt: "R")
    let variants = [
        "i-2", "p-2", "w-2", "s-2", "session/flush"
    ]
    let base = ["i-1", "p-1", "w-1", "s-1", "session/submit"]
    var i: Int64 = 0
    while (i < 5) {
        let got = ledgerKey(l, variants[i], base[1], base[2], base[3], base[4], "op-1", "d-a")
        @Expect(got.kind == "execute", true)
        l.recordDone(instanceId: variants[i], principalId: base[1], workspaceId: base[2],
            sessionId: base[3], method: base[4], operationId: "op-1",
            contentDigest: "d-a", receipt: "V-${i}")
        i += 1
    }
    @Expect(l.size(), Int64(6))
}

@Test
func keyEncodingCannotBeForgedByFieldBoundaries() {
    // 长度前缀编码：("a|b","c") 与 ("a","b|c") 必须是两条不同的键。
    // 直接 join 分隔符的实现会在这里露出来——一条请求能伪装成另一条的回执。
    let l = IdempotencyLedger()
    l.recordDone(instanceId: "a|b", principalId: "p", workspaceId: "c", sessionId: "s",
        method: "session/submit", operationId: "op", contentDigest: "d-a", receipt: "FIRST")
    let spoof = ledgerKey(l, "a", "p", "b|c", "s", "session/submit", "op", "d-a")
    @Expect(spoof.kind == "execute", true)
}

@Test
func timeoutBecomesUnknownAndNeverReExecutes() {
    // 超时不是业务失败：记账为 unknown，同键同内容重试拿到的仍是「结果未知 + 查询标识」，
    // 客户端据此查状态，而不是服务端替它再下一次副作用。
    let l = IdempotencyLedger()
    let first = ledgerKey(l, "i-1", "p-1", "w-1", "s-1", "task/start", "op-9", "d-x")
    @Expect(first.kind == "execute", true)
    l.recordUnknown(instanceId: "i-1", principalId: "p-1", workspaceId: "w-1", sessionId: "s-1",
        method: "task/start", operationId: "op-9", contentDigest: "d-x", queryId: "q-9")
    let again = ledgerKey(l, "i-1", "p-1", "w-1", "s-1", "task/start", "op-9", "d-x")
    @Expect(again.kind == "replay", true)
    @Expect((again.receipt.indexOf("unknown") ?? Int64(-1)) >= Int64(0), true)
    @Expect((again.receipt.indexOf("q-9") ?? Int64(-1)) >= Int64(0), true)
}

@Test
func ledgerIsBoundedAndEvictsOldest() {
    // 账本必须有界：每设备每个写操作都留一条，长跑 daemon 就是内存泄漏。
    let l = IdempotencyLedger(cap: 3)
    var i: Int64 = 0
    while (i < 4) {
        l.recordDone(instanceId: "i-1", principalId: "p-1", workspaceId: "w-1", sessionId: "s-1",
            method: "session/submit", operationId: "op-${i}", contentDigest: "d-${i}", receipt: "R-${i}")
        i += 1
    }
    @Expect(l.size() <= Int64(3), true)
    // 被淘汰的那条会重新执行——这是有界账本的代价，必须在契约里写明白而不是假装幂等。
    let evicted = ledgerKey(l, "i-1", "p-1", "w-1", "s-1", "session/submit", "op-0", "d-0")
    @Expect(evicted.kind == "execute", true)
    let kept = ledgerKey(l, "i-1", "p-1", "w-1", "s-1", "session/submit", "op-3", "d-3")
    @Expect(kept.kind == "replay", true)
}

@Test
func missingOperationIdCannotEnterTheLedger() {
    // 空 operationId 不建账：否则所有缺字段的写请求会共享同一条回执。
    let l = IdempotencyLedger()
    @Expect(l.acceptsKey(operationId: "op-1"), true)
    @Expect(l.acceptsKey(operationId: ""), false)
}

// ---------------------------------------------------------------------------
// 落盘面（§5「副作用与幂等账不能仅靠内存锁」）：重启后的 daemon 必须还能
// 认出「这条 operationId 已经做过」。纯内存账本在重启后是空的，
// 客户端一次重试就是一次真副作用——那正是这条不变量要挡的事。
// ---------------------------------------------------------------------------

func ledgerFile(name: String): String {
    return "${getTempDirectory().toString()}/sa-ledger-${name}"
}

func dropLedgerFile(name: String): Unit {
    let p = Path(ledgerFile(name))
    if (exists(p)) { try { remove(p, recursive: false) } catch (_: Exception) {} }
}

@Test
func recordedReceiptSurvivesReopeningTheStore() {
    let path = ledgerFile("reopen-done")
    dropLedgerFile("reopen-done")
    let before = IdempotencyLedger(cap: Int64(8), storePath: path)
    let key = ledgerKey(before, "i-1", "p-1", "w-1", "s-1", "session/submit", "op-p-1", "d-1")
    @Expect(key.kind, "execute")
    before.recordDone(instanceId: "i-1", principalId: "p-1", workspaceId: "w-1", sessionId: "s-1",
        method: "session/submit", operationId: "op-p-1", contentDigest: "d-1", receipt: "{\"ok\":1}")
    // 换一个实例、只给同一个路径：这就是「进程重启后」的等价形态。
    let after = IdempotencyLedger(cap: Int64(8), storePath: path)
    let again = ledgerKey(after, "i-1", "p-1", "w-1", "s-1", "session/submit", "op-p-1", "d-1")
    @Expect(again.kind, "replay")
    @Expect(again.receipt, "{\"ok\":1}")
    dropLedgerFile("reopen-done")
}

@Test
func unknownReceiptSurvivesReopeningTheStore() {
    // 超时记的那条 unknown 更要活过重启：重启后重试仍只该得到「结果未知 + 查询标识」，
    // 而不是「趁进程换过，替客户端再下一次副作用」。
    let path = ledgerFile("reopen-unknown")
    dropLedgerFile("reopen-unknown")
    let before = IdempotencyLedger(cap: Int64(8), storePath: path)
    before.recordUnknown(instanceId: "i-1", principalId: "p-1", workspaceId: "w-1", sessionId: "s-1",
        method: "task/start", operationId: "op-u-1", contentDigest: "d-u", queryId: "op-u-1")
    let after = IdempotencyLedger(cap: Int64(8), storePath: path)
    let again = ledgerKey(after, "i-1", "p-1", "w-1", "s-1", "task/start", "op-u-1", "d-u")
    @Expect(again.kind, "replay")
    @Expect(ledgerIsUnknown(again.receipt), true)
    @Expect(ledgerUnknownQueryId(again.receipt), "op-u-1")
    dropLedgerFile("reopen-unknown")
}

@Test
func reopenedStoreDoesNotResurrectEvictedEntries() {
    // 淘汰必须真的从盘上消失：只裁内存的话，重启会把 5 条历史全捞回来，
    // 那个「有界」就只是内存里的假象。
    let path = ledgerFile("reopen-bounded")
    dropLedgerFile("reopen-bounded")
    let before = IdempotencyLedger(cap: Int64(3), storePath: path)
    var i: Int64 = 0
    while (i < Int64(5)) {
        ledgerKey(before, "i-1", "p-1", "w-1", "s-1", "session/submit", "op-${i}", "d-${i}")
        before.recordDone(instanceId: "i-1", principalId: "p-1", workspaceId: "w-1", sessionId: "s-1",
            method: "session/submit", operationId: "op-${i}", contentDigest: "d-${i}", receipt: "r-${i}")
        i += 1
    }
    let after = IdempotencyLedger(cap: Int64(3), storePath: path)
    @Expect(after.size(), Int64(3))
    let oldest = ledgerKey(after, "i-1", "p-1", "w-1", "s-1", "session/submit", "op-0", "d-0")
    @Expect(oldest.kind, "execute")
    let newest = ledgerKey(after, "i-1", "p-1", "w-1", "s-1", "session/submit", "op-4", "d-4")
    @Expect(newest.kind, "replay")
    dropLedgerFile("reopen-bounded")
}

@Test
func tornOrGarbageJournalLinesAreSkipped() {
    // 盘上是外部可见的：写一半崩了会留下残行，被人手改过会有垃圾行。
    // 一条坏行不能把整本账变成启动失败，也不能被当成合法空账本以外的任何东西。
    let path = ledgerFile("reopen-torn")
    dropLedgerFile("reopen-torn")
    // 键由六个字段按同一算法算出，所以伪造的那条也得走 keyOf，否则 consult 对不上号。
    let k = IdempotencyLedger.keyOf(instanceId: "i-1", principalId: "p-1", workspaceId: "w-1",
        sessionId: "s-1", method: "session/submit", operationId: "op-t-1")
    let good = IdempotencyLedger.journalLine(key: k, digest: "D-1", receipt: "{\"ok\":7}")
    let text = "${good}\nthis line is not json\n{\"key\":\"K-2\""
    @Expect(try { File.writeTo(Path(path), text.toArray()); true } catch (_: Exception) { false }, true)
    let after = IdempotencyLedger(cap: Int64(8), storePath: path)
    @Expect(after.size(), Int64(1))
    let hit = after.consult(instanceId: "i-1", principalId: "p-1", workspaceId: "w-1",
        sessionId: "s-1", method: "session/submit", operationId: "op-t-1", contentDigest: "D-1")
    @Expect(hit.kind, "replay")
    @Expect(hit.receipt, "{\"ok\":7}")
    dropLedgerFile("reopen-torn")
}

@Test
func unwritableStoreKeepsMemorySemanticsButCountsTheFailure() {
    // 盘写不进去（父目录都不存在）不能让业务请求失败，也不能被说成「已经建账」：
    // 内存这条仍然挡住本进程内的第二次执行，但失败计数必须读得出来。
    let bad = "${getTempDirectory().toString()}/sa-ledger-no-such-dir-xyz/x.jsonl"
    let l = IdempotencyLedger(cap: Int64(4), storePath: bad)
    ledgerKey(l, "i-1", "p-1", "w-1", "s-1", "session/submit", "op-f-1", "d-f")
    l.recordDone(instanceId: "i-1", principalId: "p-1", workspaceId: "w-1", sessionId: "s-1",
        method: "session/submit", operationId: "op-f-1", contentDigest: "d-f", receipt: "r-f")
    let again = ledgerKey(l, "i-1", "p-1", "w-1", "s-1", "session/submit", "op-f-1", "d-f")
    @Expect(again.kind, "replay")
    @Expect(l.persistedFailureCount(), Int64(1))
}
