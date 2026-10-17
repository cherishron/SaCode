package core

// 从已落盘会话快照投影终端输出；不推断 JobStore 的内存状态或退出码。
public func terminalOutputJson(log: SessionLog, cursor: Int64, limit: Int64): String {
    if (cursor < 0 || limit < 1 || limit > 16) { throw Exception("bad-terminal-page") }
    var rows = "["
    var count: Int64 = 0
    var next = cursor
    var more = false
    var malformed: Int64 = 0
    for (event in log.snapshotEvents()) {
        if (event.seq < cursor) { continue }
        if (event.eventType != "terminal/chunk") { next = event.seq + 1; continue }
        if (count >= limit) { more = true; break }
        next = event.seq + 1
        let at = event.data.indexOf("::") ?? Int64(-1)
        if (at <= 0) { malformed += 1; continue }
        let job = event.data[0..at]
        if (job.size > 256) { malformed += 1; continue }
        let text = event.data[(at + 2)..event.data.size]
        let bytes = text.toArray()
        var end = if (bytes.size > 8192) { Int64(8192) } else { bytes.size }
        // 保留完整 UTF-8 字符，不能在中文字符中间截断。
        while (end < bytes.size && end > 0 && bytes[end] >= 128 && bytes[end] < 192) { end -= 1 }
        let shown = String.fromUtf8(bytes[0..end])
        let truncated = if (end < bytes.size) { "true" } else { "false" }
        if (count > 0) { rows += "," }
        rows += "{\"seq\":${event.seq},\"jobId\":\"${jsonEscapeText(job)}\",\"text\":\"${jsonEscapeText(shown)}\",\"truncated\":${truncated}}"
        count += 1
    }
    rows += "]"
    return "{\"rows\":${rows},\"nextCursor\":${next},\"more\":${more},\"malformed\":${malformed}}"
}
