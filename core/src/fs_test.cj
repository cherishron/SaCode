package core

import std.unittest.*
import std.fs.*

// 文件观察面（矩阵 17 filesystem 与不变量 14 的两半）。
// 此前全仓只有一处 File.writeTo，没有读侧工具，所以两条都测不出来：
//   FS_NOT_OBSERVED   —— 已存在文件未读取观察，不允许直接覆盖；
//   FS_STALE_VERSION  —— 我读过的文件被第三方改过了，还能不能照着旧认知去写。
// 版本标记不是防伪摘要，只对「同一位置有没有变」敏感：
// 只记 size 的实现会让「等长替换」溜过去，那正是下面第 3 个用例要抓的。

func fsFile(tag: String): String {
    return "core-fs-${tag}.txt"
}

func fsLogPath(tag: String): String {
    return "core-fs-${tag}.log"
}

func fsCleanup(tag: String) {
    removeIfExists(fsLogPath(tag), recursive: false)
    removeIfExists(fsFile(tag), recursive: false)
}

// 返回一对而不是只给 runtime：日志侧的断言直接走 SessionLog 已有的公开读法，
// 不为了测试往产品面上加一个「读事件」的口子。
func fsSetup(tag: String): (ToolRuntime, SessionLog) {
    let log = SessionLog(fsLogPath(tag))
    let reg = ToolRegistry()
    reg.register(ToolSpec("write", "写文件", "path content", true))
    reg.register(ToolSpec("read", "读文件并记录版本标记", "path", false))
    return (ToolRuntime(log, reg), log)
}

func fsResultCount(log: SessionLog, marker: String): Int64 {
    var n: Int64 = 0
    for (ev in log.snapshotEvents()) {
        if (ev.eventType == "tool/result" && ev.data.contains(marker)) {
            n += 1
        }
    }
    return n
}

// 读必须真读盘：工具写过之后读到正文，第三方改过之后读到新正文，
// 而不是实现里缓存的那一份。
@Test
func readObservesActualDiskBytesEvenAfterExternalChange() {
    fsCleanup("observe")
    let (rt, _) = fsSetup("observe")
    let f = fsFile("observe")
    @Expect(rt.execute("write", "${f} alpha beta", "allowed-once", true).allowed, true)
    let r1 = rt.execute("read", f, "", true)
    @Expect(r1.allowed, true)
    @Expect(r1.why, "alpha beta")
    // 绕开工具直接改盘，下一次读必须看见新字节
    File.writeTo(f, "gamma".toArray())
    @Expect(rt.execute("read", f, "", true).why, "gamma")
    fsCleanup("observe")
}

// 读不到的文件要归一成自己的阶段码，不能和 io 失败、参数错混成一种。
@Test
func readMissingPathReportsNotFoundStage() {
    fsCleanup("missing")
    let (rt, _) = fsSetup("missing")
    let r = rt.execute("read", "core-fs-does-not-exist.txt", "", true)
    @Expect(r.allowed, false)
    @Expect(r.why, "not-found:core-fs-does-not-exist.txt")
    @Expect(rt.lastDetail.stage, "not-found")
    fsCleanup("missing")
}

// 核心的一条：读过之后就欠了一份版本认知。第三方把文件改成**等长**的另一串，
// 旧认知已经过期，此时再写必须被拒；而且拒绝必须发生在写之前，
// 拒了还顺手改盘等于覆盖掉别人的工作。
@Test
func writeAfterSameSizeExternalEditIsRefusedAsStaleVersion() {
    fsCleanup("stale")
    let (rt, log) = fsSetup("stale")
    let f = fsFile("stale")
    @Expect(rt.execute("write", "${f} v1-one", "allowed-once", true).allowed, true)
    @Expect(rt.execute("read", f, "", true).why, "v1-one")
    // 等长替换：size-only 的标记在这里完全看不出差别
    File.writeTo(f, "v2-two".toArray())
    let w = rt.execute("write", "${f} v3-new", "allowed-once", true)
    @Expect(w.allowed, false)
    @Expect(w.why, "fs-stale-version:${f}")
    @Expect(rt.lastDetail.stage, "fs-stale-version")
    // 盘上必须仍是第三方那一份
    @Expect(String.fromUtf8(File.readFrom(f)), "v2-two")
    // 这条拒绝要能被跨进程追问，所以它也得进会话日志，且只落一次
    @Expect(fsResultCount(log, "fs-stale-version"), Int64(1))
    fsCleanup("stale")
}

// 未观察过的已有文件必须拒绝，不能把「没有版本记录」当成免检查。
@Test
func writeWithoutPriorObservationIsRefused() {
    fsCleanup("unwatched")
    let (rt, _) = fsSetup("unwatched")
    let f = fsFile("unwatched")
    File.writeTo(f, "aaaaaa".toArray())
    let w = rt.execute("write", "${f} bbbbbb", "allowed-once", true)
    @Expect(w.allowed, false)
    @Expect(w.why, "fs-not-observed:${f}")
    @Expect(rt.lastDetail.stage, "fs-not-observed")
    @Expect(String.fromUtf8(File.readFrom(f)), "aaaaaa")
    fsCleanup("unwatched")
}

@Test
func pathAliasesDoNotBypassObservation() {
    fsCleanup("alias")
    let (rt, _) = fsSetup("alias")
    let f = fsFile("alias")
    File.writeTo(f, "before".toArray())
    @Expect(rt.execute("read", f, "", true).allowed, true)
    // 绝对路径、大写、反斜杠都必须命中同一份观察。
    let absolute = canonicalize(f).toString().toAsciiUpper()
    @Expect(rt.execute("write", "${absolute} middle", "allowed-once", true).allowed, true)
    File.writeTo(f, "outside".toArray())
    let refused = rt.execute("write", "./${f} overwrite", "allowed-once", true)
    @Expect(refused.allowed, false)
    @Expect(refused.why, "fs-stale-version:./${f}")
    @Expect(String.fromUtf8(File.readFrom(f)), "outside")
    fsCleanup("alias")
}

@Test
func invalidUtf8DoesNotRecordReadSuccessOrObservation() {
    fsCleanup("encoding")
    let (rt, log) = fsSetup("encoding")
    let f = fsFile("encoding")
    let invalid: Array<Byte> = [255]
    File.writeTo(f, invalid)
    let r = rt.execute("read", f, "", true)
    @Expect(r.allowed, false)
    @Expect(r.why, "invalid-encoding:${f}")
    @Expect(rt.lastDetail.stage, "invalid-encoding")
    @Expect(fsResultCount(log, "ok-read:"), Int64(0))
    @Expect(rt.execute("write", "${f} replace", "allowed-once", true).why, "fs-not-observed:${f}")
    fsCleanup("encoding")
}

@Test
func createPublicationNeverReplacesAnExistingTarget() {
    fsCleanup("create")
    let f = fsFile("create")
    File.writeTo(f, "external".toArray())
    var refused = false
    try { publishNewFile(f, "replacement".toArray()) } catch (e: Exception) { refused = true }
    @Expect(refused, true)
    @Expect(String.fromUtf8(File.readFrom(f)), "external")
    fsCleanup("create")
}

@Test
func jsonEscapingPreservesEveryControlByte() {
    let controls: Array<Byte> = [65, 0, 66, 12, 67, 8, 31]
    @Expect(jsonEscapeText(String.fromUtf8(controls)), "A\\u0000B\\u000cC\\u0008\\u001f")
}
