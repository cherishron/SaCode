package core
import std.collection.*
import std.fs.*
import std.unittest.*

// 用户提问上游契约（M7）：`AskUserQuestionItem(id, question, detail?, header?,
// options?, multiSelect?, intent?)` + `askTimed` 返回 pending（仍可答）+ `@Remote
// answer` REPLY_QUEUED 拒绝第二次 + `user-questions/request` waterfall。
// 本切片以 log-only `user-questions/request` / `user-questions/answer` 事件近似
// request 阶段与一次性 consume；askTimed 计时与 options 结构留待后续。

@Test
func userQuestionAskThenAnswerOnce() {
    let root = "core-uxq-once"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let ux = UserQuestionStore(log)
    ux.ask("q1", "选一个方向")
    @Expect(ux.status("q1"), "pending")
    ux.answer("q1", "A")
    @Expect(ux.status("q1"), "answered")
    @Expect(ux.answerOf("q1"), "A")
    removeIfExists(root, recursive: true)
}

@Test
func userQuestionSecondAnswerRejected() {
    let root = "core-uxq-twice"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let ux = UserQuestionStore(log)
    ux.ask("q1", "选一个方向")
    ux.answer("q1", "A")
    var threw = false
    try {
        ux.answer("q1", "B")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    // 二次 answer 拒后原答案保留。
    @Expect(ux.answerOf("q1"), "A")
    removeIfExists(root, recursive: true)
}

@Test
func userQuestionUnknownIdRejected() {
    let root = "core-uxq-unknown"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let ux = UserQuestionStore(log)
    var threw = false
    try {
        ux.answer("ghost", "A")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    removeIfExists(root, recursive: true)
}

@Test
func userQuestionEventsAreLogOnlyAcrossReplay() {
    let root = "core-uxq-replay"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let ux = UserQuestionStore(log)
    log.append("user/message", "开工")
    ux.ask("q1", "问题")
    ux.answer("q1", "A")
    @Expect(log.flush(), true)
    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    @Expect(fresh.deriveMessages().size, Int64(1))
    let replayed = UserQuestionStore(fresh)
    @Expect(replayed.status("q1"), "answered")
    @Expect(replayed.answerOf("q1"), "A")
    removeIfExists(root, recursive: true)
}
