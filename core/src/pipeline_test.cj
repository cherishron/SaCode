package core

import std.unittest.*
import std.fs.*
import std.collection.{ArrayList, HashSet}

// 工具管线的四段各自都要能被单独钉住：pre-execute（参数归一化）、snapshot（写前旧内容与
// 期望字节数）、execute、post-execute/失败归一化（含无损校验）。
// 断言只认 lastDetail.stage 这类管线留下的事实，不认「返回值看起来像成功」。

func pipePath(tag: String): String {
    return "core-pipe-${tag}.log"
}

func cleanUp(tag: String, file: String) {
    removeIfExists(pipePath(tag), recursive: false)
    removeIfExists(file, recursive: false)
}

func newRuntime(tag: String): (SessionLog, ToolRegistry, ToolRuntime) {
    let p = pipePath(tag)
    removeIfExists(p, recursive: false)
    let log = SessionLog(p)
    let reg = ToolRegistry()
    reg.register(ToolSpec("write", "写临时文件", "path content", true))
    reg.register(ToolSpec("read", "观察文件", "path", false))
    return (log, reg, ToolRuntime(log, reg))
}

// 结果事件文本里找得到归一化后的阶段码，才算「日志答得出为什么失败」
func lastResult(log: SessionLog): String {
    let all = log.snapshotEvents()
    if (all.size == Int64(0)) {
        return ""
    }
    return all[all.size - 1].data
}

@Test
func preExecuteNormalizesArgsBeforeRun() {
    let (log, reg, rt) = newRuntime("pre")
    let r = rt.execute("write", "   pipe-pre.txt    hello   world  ", "allowed-once", true)
    @Expect(r.allowed, true)
    @Expect(rt.lastDetail.preRewrote, true)
    @Expect(rt.lastDetail.argsAfterPre, "pipe-pre.txt hello   world")
    @Expect(rt.lastDetail.stage, "ran")
    // 参数里除第一段路径之外的空格是正文的一部分，不能被当成第二个参数丢掉
    let got = String.fromUtf8(File.readFrom("pipe-pre.txt"))
    @Expect(got, "hello   world")
    @Expect(rt.lastDetail.verified, true)
    cleanUp("pre", "pipe-pre.txt")
}

@Test
func guardDenialStopsBeforeAnyMutation() {
    let (log, reg, rt) = newRuntime("guard")
    removeIfExists("pipe-guard.txt", recursive: false)
    let r = rt.execute("write", "pipe-guard.txt  x", "allowed-once", false)
    @Expect(r.allowed, false)
    @Expect(r.why, "guard-denied")
    // guard 之后不得再有改写点：这一段没走到，明细里必须留空/未初始化
    @Expect(rt.lastDetail.stage, "guard-denied")
    @Expect(rt.lastDetail.argsAfterPre, "")
    @Expect(rt.lastDetail.preRewrote, false)
    @Expect(rt.lastDetail.snapshotBefore, Int64(-1))
    @Expect(exists(Path("pipe-guard.txt")), false)
    @Expect(lastResult(log), "denied:write:guard")
    removeIfExists(pipePath("guard"), recursive: false)
}

// snapshot 阶段的价值就在这里：写前记下旧字节数，写后重读比对，
// 少一个字节都不算成功——否则「工具执行了」与「内容无损」会被混为一谈。
@Test
func snapshotRecordsPriorBytesAndVerifiesLossless() {
    let target = "pipe-snap.txt"
    File.writeTo(target, "OLD-CONTENT".toArray())
    let (log, reg, rt) = newRuntime("snap")
    @Expect(rt.execute("read", target, "", true).allowed, true)
    let r = rt.execute("write", "${target} new content here", "allowed-once", true)
    @Expect(r.allowed, true)
    @Expect(rt.lastDetail.snapshotBefore, Int64(11))
    @Expect(rt.lastDetail.verified, true)
    @Expect(rt.lastDetail.stage, "ran")
    @Expect(String.fromUtf8(File.readFrom(target)), "new content here")
    cleanUp("snap", target)
}

// 失败归一化：五类失败必须落到五个互不相同的阶段码上，
// 否则日志与界面只分得出「没成功」，分不出该找谁。
@Test
func failureCodesAreDistinctPerStage() {
    let (log, reg, rt) = newRuntime("fail")
    // 「登记了但还没实现」的占位名必须真的是没实现的那个：
    // 本批把 read 实现出来之后，再拿 read 当占位就测不出 unknown-tool 了
    // （会先按 not-found 归一），所以换成仍无实现的 edit。
    reg.register(ToolSpec("edit", "还没实现的工具", "path", false))
    let badArgs = rt.execute("write", "only-a-path", "allowed-once", true)
    @Expect(badArgs.allowed, false)
    @Expect(rt.lastDetail.stage, "bad-args")
    let unknownImpl = rt.execute("edit", "x.txt y", "allowed-once", true)
    @Expect(unknownImpl.allowed, false)
    @Expect(rt.lastDetail.stage, "unknown-tool")
    let ioErr = rt.execute("write", "no-such-dir/pipe-fail.txt y", "allowed-once", true)
    @Expect(ioErr.allowed, false)
    @Expect(rt.lastDetail.stage, "io-error")
    let denied = rt.execute("write", "pipe-fail.txt y", "no-answer", true)
    @Expect(denied.allowed, false)
    @Expect(rt.lastDetail.stage, "approval-denied")
    let unreg = rt.execute("rm-rf", "a b", "allowed-once", true)
    @Expect(unreg.allowed, false)
    @Expect(rt.lastDetail.stage, "unregistered")
    // 阶段码两两不同：把它们塞进 HashSet，数量必须等于 5
    let seen = HashSet<String>()
    seen.add("bad-args")
    seen.add("unknown-tool")
    seen.add("io-error")
    seen.add("approval-denied")
    seen.add("unregistered")
    @Expect(seen.size, Int64(5))
    removeIfExists("pipe-fail.txt", recursive: false)
    removeIfExists(pipePath("fail"), recursive: false)
}
