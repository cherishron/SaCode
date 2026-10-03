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

// 不变量 9 的「对无关事件返回同一引用」在仓里无法用身份运算符取证，
// 改钉它的可观测等价物：无关事件不得触发重建，相关事件必须触发重建。
// 只测「不重建」会退化成永远不更新的假绿，所以两条方向都要断言。
@Test
func projectionRebuildsOnlyForSurfaceEvents() {
    let log = SessionLog(tmpPath("purecache"))
    log.append("user/message", "u1")
    let first = log.deriveMessages()
    @Expect(Int64(first.size), Int64(1))
    let builds = log.projectionBuilds()
    log.append("turn/start", "")
    log.append("stream/chunk", "text")
    let same = log.deriveMessages()
    @Expect(log.projectionBuilds(), builds)
    @Expect(Int64(same.size), Int64(1))
    log.append("assistant/message", "hi")
    let grown = log.deriveMessages()
    @Expect(log.projectionBuilds(), builds + Int64(1))
    @Expect(Int64(grown.size), Int64(2))
    @Expect(grown[1], "assistant/message: hi")
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
func releaseByNonHolderDoesNotDeleteTheHoldersLease() {
    // 第二个写者拿不到租约，就更没有权力把持有者的租约清掉——
    // 原实现无条件 removeIfExists，等于让抢写失败的一方决定谁可以写。
    let p = tmpPath("own")
    clean("own")
    let holder = WriteLease(p)
    let loser = WriteLease(p)
    @Expect(holder.acquire(), true)
    @Expect(loser.acquire(), false)
    @Expect(loser.release(), false)
    // 非持有者的 release 不得动到持有者的租约
    @Expect(holder.held(), true)
    @Expect(holder.release(), true)
    clean("own")
}

@Test
func leaseStampedWithAnOwnerTokenInsteadOfABareFlag() {
    // 租约要能回答「现在归谁」，否则失败方无从判断该不该收尾。
    let p = tmpPath("stamp")
    clean("stamp")
    let a = WriteLease(p)
    @Expect(a.acquire(), true)
    @Expect(a.currentOwner() == a.ownerToken(), true)
    @Expect(a.ownerToken().size > 0, true)
    let b = WriteLease(p)
    @Expect(b.acquire(), false)
    // 抢写失败不得改写盘上的归属
    @Expect(b.currentOwner() == a.ownerToken(), true)
    a.release()
    clean("stamp")
}

@Test
func holderThatLostItsLeaseDoesNotDeleteTheNewOwnersFile() {
    // 这一条是变异探针逼出来的：前面几条都在「空凭据」那关就返回了，
    // 只有拿到过、之后归属已易主，才真正走到底下那次归属核对。
    let p = tmpPath("stolen")
    clean("stolen")
    let a = WriteLease(p)
    @Expect(a.acquire(), true)
    // 模拟租约被接管或清理后由别人重建
    File.writeTo("${p}.lease", "writer=someone-else".toArray())
    @Expect(a.release(), false)
    @Expect(a.currentOwner() == "writer=someone-else", true)
    removeIfExists("${p}.lease", recursive: false)
    clean("stolen")
}

@Test
func failedAcquireLeavesNoStagingGarbage() {
    let p = tmpPath("stage")
    clean("stage")
    let a = WriteLease(p)
    a.acquire()
    let b = WriteLease(p)
    @Expect(b.acquire(), false)
    // 原子获取靠「独占临时文件 + rename(overwrite:false)」，失败的那一步必须自己清干净
    @Expect(b.stagingArtifact() == "" || !exists(b.stagingArtifact()), true)
    a.release()
    clean("stage")
}

@Test
func foreignLeaseIsRespectedNotSilentlyTakenOver() {
    // 崩溃持有者的租约自动接管还没做（Windows 下取不到自身 pid，见方案 §8 决策 16）。
    // 在接管落地前，行为必须是「明确拒绝」而不是「悄悄抢走」。
    let p = tmpPath("foreign")
    clean("foreign")
    File.writeTo("${p}.lease", "writer=some-other-process".toArray())
    let a = WriteLease(p)
    @Expect(a.acquire(), false)
    @Expect(a.currentOwner() == "writer=some-other-process", true)
    // 不是自己拿到的租约，release 必须失败
    @Expect(a.release(), false)
    removeIfExists("${p}.lease", recursive: false)
    clean("foreign")
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

// 会话日志是按行的 TSV：数据里带裸换行会把一条事件劈成两行，回放时中段缺帧
// 会被判整份拒绝。聊天输入天然多行，所以写入必须转义、回放必须还原。
@Test
func multiLineAndTabDataSurviveFlushAndReplay() {
    let p = tmpPath("multiline")
    clean("multiline")
    let w = SessionLog(p)
    w.append("user/message", "第一行\n第二行\t带制表")
    @Expect(w.flush(), true)
    let r = SessionLog(p)
    @Expect(r.load(), true)
    @Expect(r.events.size, Int64(1))
    @Expect(r.events[0].data, "第一行\n第二行\t带制表")
    @Expect(r.verifySeqContiguous(), true)
}

// 反斜杠自己不参与转义的话，「还原」会把 C:\tmp 读成别的东西
@Test
func backslashAndQuoteDataRoundTripExactly() {
    let p = tmpPath("backslash")
    clean("backslash")
    let w = SessionLog(p)
    w.append("user/message", "路径 C:\tmp 与 \"引号\"")
    @Expect(w.flush(), true)
    let r = SessionLog(p)
    @Expect(r.load(), true)
    @Expect(r.events[0].data, "路径 C:\tmp 与 \"引号\"")
}
