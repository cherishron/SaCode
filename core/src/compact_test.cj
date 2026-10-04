package core
import std.collection.*
import std.fs.*
import std.unittest.*

// 上下文压缩上游契约（M2）：达到 token 阈值时把旧的模型可见消息压成摘要
// 事件；本切片以 log-only `compaction/record` 事件承载「触发原因::压缩前
// 消息数::压缩后消息数」，字段都用字符串避免 Int64 parse 陷阱。
// `compact(reason, before, after)` 契约性要求 after <= before，本切片
// 靠 after 长度不超过 before 长度的**字面**判据（同为 "N" 形式）近似，
// 只拒「after 明显大于 before」这一档最明显的畸形（例如 "3" → "5"）。

@Test
func compactionRecordsAndListsEvents() {
    let root = "core-compact-list"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let ledger = CompactionLedger(log)
    ledger.record("threshold", "10", "3")
    ledger.record("manual", "8", "1")
    let list = ledger.entries()
    @Expect(list.size, Int64(2))
    @Expect(list[0], "threshold::10::3")
    @Expect(list[1], "manual::8::1")
    removeIfExists(root, recursive: true)
}

@Test
func compactionRejectsEmptyReason() {
    let root = "core-compact-empty"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let ledger = CompactionLedger(log)
    var threw = false
    try {
        ledger.record("", "10", "3")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    @Expect(ledger.entries().size, Int64(0))
    removeIfExists(root, recursive: true)
}

@Test
func compactionEventIsLogOnlyAcrossReplay() {
    let root = "core-compact-replay"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let ledger = CompactionLedger(log)
    log.append("user/message", "开工")
    ledger.record("threshold", "10", "3")
    @Expect(log.flush(), true)
    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    @Expect(fresh.deriveMessages().size, Int64(1))
    @Expect(CompactionLedger(fresh).entries().size, Int64(1))
    removeIfExists(root, recursive: true)
}
