package core
import std.collection.*
import std.fs.*
import std.unittest.*

// 反馈上游契约（M5/M6）：用户对某轮/某工具调用给出 👍/👎/文本评论；
// `feedback/record` 事件承载 `<turn>::<sentiment>::<comment>`。
// 本切片以 log-only `feedback/record` 事件近似；空 turn/sentiment 拒。

@Test
func feedbackRecordsAndListsBack() {
    let root = "core-fb-list"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let fb = FeedbackStore(log)
    fb.record("turn-1", "positive", "很好")
    fb.record("turn-2", "negative", "")
    let list = fb.entries()
    @Expect(list.size, Int64(2))
    @Expect(list[0], "turn-1::positive::很好")
    @Expect(list[1], "turn-2::negative::")
    removeIfExists(root, recursive: true)
}

@Test
func feedbackRejectsEmptyTurnOrSentiment() {
    let root = "core-fb-reject"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let fb = FeedbackStore(log)
    var threwTurn = false
    try {
        fb.record("", "positive", "x")
    } catch (e: Exception) {
        threwTurn = true
    }
    @Expect(threwTurn, true)
    var threwSentiment = false
    try {
        fb.record("turn-1", "", "x")
    } catch (e: Exception) {
        threwSentiment = true
    }
    @Expect(threwSentiment, true)
    @Expect(fb.entries().size, Int64(0))
    removeIfExists(root, recursive: true)
}

@Test
func feedbackEventIsLogOnlyAcrossReplay() {
    let root = "core-fb-replay"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let fb = FeedbackStore(log)
    log.append("user/message", "开工")
    fb.record("turn-1", "positive", "很好")
    @Expect(log.flush(), true)
    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    @Expect(fresh.deriveMessages().size, Int64(1))
    @Expect(FeedbackStore(fresh).entries().size, Int64(1))
    removeIfExists(root, recursive: true)
}
