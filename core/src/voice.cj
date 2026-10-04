package core
import std.collection.*

// 语音输入会话：begin/end 是本地开关（不落 log 事件），只有 utterance 落
// log-only `voice/utterance` 事件；未 begin 或已 end 时 utterance 抛。
// 空文本也拒。

public class VoiceSession {
    let log: SessionLog
    var open = false

    public init(log: SessionLog) {
        this.log = log
        // 会话开闭状态跨进程无法从事件回放恢复——只回放 utterance。
    }

    public func begin(): Unit {
        open = true
    }

    public func end(): Unit {
        open = false
    }

    public func utterance(text: String): Unit {
        if (!open) {
            throw Exception("voice-not-open")
        }
        if (text.size == 0) {
            throw Exception("voice-empty-text")
        }
        log.append("voice/utterance", text)
    }

    public func utterances(): ArrayList<String> {
        let out = ArrayList<String>()
        for (event in log.snapshotEvents()) {
            if (event.eventType == "voice/utterance") {
                out.add(event.data)
            }
        }
        return out
    }
}
