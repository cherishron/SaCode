package core

// 会话标题：`session/title` 是 log-only 事件（不进 isSurfaceEvent 白名单），
// 与上游契约一致——它承载标题的 source（user/provider/fallback），持久但不进模型历史。
//
// provider 是单槽：注册一次留下前缀，第二次注册抛，绝不静默顶替。
// 生成器（`generateFrom`）落 provider 时用前缀拼接、落 fallback 时按 60 上限截断，
// 与上游 SessionTitleSource 三态一致。
public class SessionTitleService {
    let log: SessionLog
    var providerPrefix: String = ""

    public init(log: SessionLog) {
        this.log = log
    }

    // 事件 data 编码：`<sourceKind>::<title>`；title 里允许任何字符（包括 ::），
    // 首个 :: 之前固定是 sourceKind，之后整段是 title。
    private func decode(data: String): (String, String) {
        let idxOpt = data.indexOf("::")
        match (idxOpt) {
            case Some(idx) => (data[0..idx], data[(idx + 2)..data.size])
            case None => ("", data)
        }
    }

    public func get(): String {
        var value = ""
        for (event in log.snapshotEvents()) {
            if (event.eventType == "session/title") {
                value = decode(event.data)[1]
            }
        }
        return value
    }

    public func sourceKind(): String {
        var kind = ""
        for (event in log.snapshotEvents()) {
            if (event.eventType == "session/title") {
                kind = decode(event.data)[0]
            }
        }
        return kind
    }

    // 用户显式改名：非空 trim 后落 source="user"；空/纯空白拒绝且不留事件。
    public func rename(title: String): Unit {
        let trimmed = title.trimAscii()
        if (trimmed.size == 0) {
            throw Exception("bad-session-title")
        }
        log.append("session/title", "user::${trimmed}")
    }

    // 单槽 provider 注册：非空前缀代表一个 provider；重复非空拒绝。
    public func registerProvider(prefix: String): Unit {
        if (providerPrefix.size > 0) {
            throw Exception("duplicate-session-title-provider")
        }
        providerPrefix = prefix
    }

    // provider 分支走 `${prefix}:${seed}`；无 provider 走 60 上限截断的 fallback。
    // 与上游 refresh 语义一致：显式重试 provider 或在无 provider 时 materialize fallback。
    public func generateFrom(seed: String): Unit {
        if (providerPrefix.size > 0) {
            log.append("session/title", "provider::${providerPrefix}:${seed}")
            return
        }
        let take = if (seed.size > 60) { Int64(60) } else { seed.size }
        log.append("session/title", "fallback::${seed[0..take]}")
    }
}
