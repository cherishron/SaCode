package core

import std.unittest.*
import std.fs.*
import std.collection.ArrayList

// 用相对路径落盘，跑完即删：核心单测不依赖外部临时目录 API。
func tmpPath(tag: String): String {
    return "core-test-${tag}.log"
}

func clean(tag: String) {
    removeIfExists(tmpPath(tag), recursive: false)
    removeIfExists("${tmpPath(tag)}.lease", recursive: false)
}

@Test
func missingLogFileIsAnEmptySessionNotARejection() {
    // 全新会话还没有日志文件：零事件是合法回放。
    // 宿主若在第一次写入/第一次 turn 上判 replay-rejected，桌面新会话根本进不去。
    let log = SessionLog(tmpPath("fresh"))
    @Expect(log.load(), true)
    @Expect(log.events.size, Int64(0))
    @Expect(log.flushedCount, Int64(0))
    log.append("turn/start", "")
    @Expect(log.events.size, Int64(1))
    @Expect(log.flush(), true)
    let r = SessionLog(tmpPath("fresh"))
    @Expect(r.load(), true)
    @Expect(r.events.size, Int64(1))
    clean("fresh")
}

@Test
func seqStartsAtZeroAndIncrements() {
    let log = SessionLog(tmpPath("seq"))
    let a = log.append("user/message", "one")
    let b = log.append("tool/call", "two")
    @Expect(a.seq, Int64(0))
    @Expect(b.seq, Int64(1))
    @Expect(Int64(log.events.size), Int64(2))
}

@Test
func flushThenLoadRoundTrips() {
    let p = tmpPath("roundtrip")
    clean("roundtrip")
    let w = SessionLog(p)
    w.append("system/message", "sys")
    w.append("user/message", "hi")
    @Expect(w.flush(), true)
    @Expect(w.flushedCount, Int64(2))
    let r = SessionLog(p)
    @Expect(r.load(), true)
    @Expect(Int64(r.events.size), Int64(2))
    @Expect(r.events[1].eventType, "user/message")
    @Expect(r.events[1].data, "hi")
    @Expect(r.flushedCount, Int64(2))
    clean("roundtrip")
}

@Test
func onlySurfaceEventsEnterModelHistory() {
    let log = SessionLog(tmpPath("project"))
    log.append("system/message", "sys")
    log.append("turn/start", "t")
    log.append("user/message", "u")
    log.append("tool/call", "c")
    log.append("tool/result", "r")
    log.append("assistant/message", "a")
    log.append("step/start", "s")
    let msgs = log.deriveMessages()
    // 5 类以下才进模型：turn/step/tool/call 持久但不进
    @Expect(Int64(msgs.size), Int64(4))
    @Expect(msgs[3], "assistant/message: a")
}

@Test
func loadRejectsGapInMidLog() {
    let p = tmpPath("gap")
    clean("gap")
    // 中段缺 1 号帧：逻辑损坏，整份拒绝，不能静默前滚
    File.writeTo(p, "0\tuser/message\ta\n2\tuser/message\tb\n3\tuser/message\tc\n".toArray())
    let r = SessionLog(p)
    @Expect(r.load(), false)
    clean("gap")
}

@Test
func loadDropsHalfWrittenTailFrame() {
    let p = tmpPath("half")
    clean("half")
    // 末字节不是 LF：崩溃时写了一半的尾帧，丢弃该帧并保留已提交前缀
    File.writeTo(p, "0\tuser/message\ta\n1\tuser/message\tb\n2\tuser/mess".toArray())
    let r = SessionLog(p)
    @Expect(r.load(), true)
    @Expect(Int64(r.events.size), Int64(2))
    @Expect(r.truncatedTail, true)
    @Expect(r.flushedCount, Int64(2))
    clean("half")
}

@Test
func loadDropsMalformedTailLine() {
    let p = tmpPath("malformed")
    clean("malformed")
    File.writeTo(p, "0\tuser/message\ta\n1\tuser\n".toArray())
    let r = SessionLog(p)
    @Expect(r.load(), true)
    @Expect(Int64(r.events.size), Int64(1))
    @Expect(r.truncatedTail, true)
    clean("malformed")
}

@Test
func loadClearsPreviousTruncatedFlag() {
    let p = tmpPath("flag")
    clean("flag")
    File.writeTo(p, "0\tuser/message\ta\n1\tuser/mess".toArray())
    let r = SessionLog(p)
    @Expect(r.load(), true)
    @Expect(r.truncatedTail, true)
    File.writeTo(p, "0\tuser/message\ta\n1\tuser/message\tb\n".toArray())
    @Expect(r.load(), true)
    @Expect(r.truncatedTail, false)
    @Expect(Int64(r.events.size), Int64(2))
    clean("flag")
}

@Test
func projectionIsPure() {
    let log = SessionLog(tmpPath("pure"))
    log.append("user/message", "u")
    let first = log.deriveMessages()
    let second = log.deriveMessages()
    @Expect(Int64(first.size), Int64(second.size))
    @Expect(first[0], second[0])
}

@Test
func leaseIsMutuallyExclusive() {
    let p = tmpPath("lease")
    clean("lease")
    let lease = WriteLease(p)
    @Expect(lease.acquire(), true)
    @Expect(lease.held(), true)
    let other = WriteLease(p)
    @Expect(other.acquire(), false)
    @Expect(lease.release(), true)
    @Expect(other.acquire(), true)
    other.release()
    clean("lease")
}

@Test
func assemblyDropsChunksAfterFinish() {
    let a = Assembly()
    a.push(Chunk("text", "hel", ""))
    a.push(Chunk("usage", "12", ""))
    a.push(Chunk("finish", "", "stop"))
    a.push(Chunk("text", "late", ""))
    @Expect(a.assembledText(), "hel")
    @Expect(a.finishReason, "stop")
    @Expect(a.usage, "12")
    @Expect(a.interrupted, false)
}

@Test
func assemblyKeepsInterruptedWhenFinishMissing() {
    let a = Assembly()
    a.push(Chunk("text", "partial", ""))
    @Expect(a.interrupted, true)
    @Expect(a.finishReason, "")
    @Expect(a.assembledText(), "partial")
}

@Test
func maxTokensFinishInvalidatesToolCalls() {
    let a = Assembly()
    a.push(Chunk("tool-call-delta", "write", ""))
    a.push(Chunk("finish", "", "max-tokens"))
    @Expect(Int64(a.toolCalls.size), Int64(0))
    @Expect(a.interrupted, false)
}

@Test
func usageAfterFinishIsIgnored() {
    let a = Assembly()
    a.push(Chunk("finish", "", "stop"))
    a.push(Chunk("usage", "99", ""))
    @Expect(a.usage, "")
}
