package core
import std.collection.*
import std.fs.*
import std.unittest.*

// 语音输入上游契约（M8）：`ctx.voice.begin()` 开启会话；`utterance(text)` 落
// 转写文本；`end()` 关闭。本切片以 log-only `voice/utterance` 事件承载 utterance
// marker；begin/end 是本地状态，不落事件。

@Test
func voiceUtteranceRecordsAndListsBack() {
    let root = "core-voice-list"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let v = VoiceSession(log)
    v.begin()
    v.utterance("你好")
    v.utterance("继续")
    v.end()
    let list = v.utterances()
    @Expect(list.size, Int64(2))
    @Expect(list[0], "你好")
    @Expect(list[1], "继续")
    removeIfExists(root, recursive: true)
}

@Test
func voiceUtteranceRejectedWithoutBegin() {
    let root = "core-voice-nobegin"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let v = VoiceSession(log)
    var threw = false
    try {
        v.utterance("x")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    @Expect(v.utterances().size, Int64(0))
    removeIfExists(root, recursive: true)
}

@Test
func voiceUtteranceRejectedAfterEnd() {
    let root = "core-voice-endafter"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let log = SessionLog("${root}/session.log")
    let v = VoiceSession(log)
    v.begin()
    v.end()
    var threw = false
    try {
        v.utterance("x")
    } catch (e: Exception) {
        threw = true
    }
    @Expect(threw, true)
    removeIfExists(root, recursive: true)
}

@Test
func voiceUtteranceEventIsLogOnlyAcrossReplay() {
    let root = "core-voice-replay"
    removeIfExists(root, recursive: true)
    Directory.create(root, recursive: true)
    let path = "${root}/session.log"
    let log = SessionLog(path)
    let v = VoiceSession(log)
    log.append("user/message", "开工")
    v.begin()
    v.utterance("你好")
    v.end()
    @Expect(log.flush(), true)
    let fresh = SessionLog(path)
    @Expect(fresh.load(), true)
    @Expect(fresh.deriveMessages().size, Int64(1))
    @Expect(VoiceSession(fresh).utterances().size, Int64(1))
    removeIfExists(root, recursive: true)
}
