package core

import std.unittest.*
import std.fs.*
import std.collection.*

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

@Test
func deletedObservedFileCannotBeSilentlyRecreated() {
    fsCleanup("deleted")
    let (rt, _) = fsSetup("deleted")
    let f = fsFile("deleted")
    File.writeTo(f, "before".toArray())
    @Expect(rt.execute("read", f, "", true).allowed, true)
    removeIfExists(f, recursive: false)
    let r = rt.execute("write", "./${f} replacement", "allowed-once", true)
    @Expect(r.allowed, false)
    @Expect(r.why, "fs-stale-version:./${f}")
    @Expect(exists(f), false)
    fsCleanup("deleted")
}

@Test
func observedAbsentFileDoesNotAuthorizeOverwritingLaterCreation() {
    fsCleanup("absent")
    let (rt, _) = fsSetup("absent")
    let f = fsFile("absent")
    @Expect(rt.execute("read", f, "", true).allowed, false)
    File.writeTo(f, "external".toArray())
    @Expect(rt.execute("write", "./${f} replacement", "allowed-once", true).why, "fs-not-observed:./${f}")
    @Expect(String.fromUtf8(File.readFrom(f)), "external")
    fsCleanup("absent")
}

@Test
func readResultContentSurvivesReplayAfterFileIsGone() {
    fsCleanup("replay")
    let (rt, log) = fsSetup("replay")
    let f = fsFile("replay")
    let body = "第一行\n第二行\t\"原始正文\""
    File.writeTo(f, body.toArray())
    @Expect(rt.execute("read", f, "", true).why, body)
    @Expect(log.flush(), true)
    removeIfExists(f, recursive: false)
    let replay = SessionLog(fsLogPath("replay"))
    @Expect(replay.load(), true)
    let events = replay.snapshotEvents()
    @Expect(events[events.size - 1].data, "ok-read:${f}:${body.toArray().size}\n${body}")
    @Expect(replay.deriveMessages().size, Int64(1))
    fsCleanup("replay")
}

// —— 有界读取（按行分页）—— 分页只限定「给模型与日志看多少」，
// 观察面仍登记全量字节：版本比对不因分页而放宽。

// limit 截断：只返回前 N 行，尾部带 read-truncated 标记写清窗口与总量；
// 且这次分页读同样建立起全量观察——之后 write 照常放行。
@Test
func boundedReadSlicesLinesAndKeepsFullObservation() {
    fsCleanup("paged")
    let (rt, log) = fsSetup("paged")
    let f = fsFile("paged")
    File.writeTo(f, "l1\nl2\nl3\nl4\nl5".toArray())
    let r = rt.execute("read", "{\"path\":\"${f}\",\"limit\":2}", "", true)
    @Expect(r.allowed, true)
    @Expect(r.why.contains("l1\nl2"), true)
    @Expect(r.why.contains("l3"), false)
    @Expect(r.why.contains("[read-truncated:offset=0,lines=2/5]"), true)
    // 全量观察仍然成立：分页读后可以写（不变量 14 的观察语义不放宽也不收紧）
    @Expect(rt.execute("write", "${f} rewritten", "allowed-once", true).allowed, true)
    @Expect(String.fromUtf8(File.readFrom(f)), "rewritten")
    // 日志里的正文也只进切片，不带第 3 行
    var sawSliceInLog = false
    for (ev in log.snapshotEvents()) {
        if (ev.eventType == "tool/result" && ev.data.contains("ok-read:")) { sawSliceInLog = true }
    }
    @Expect(sawSliceInLog, true)
    fsCleanup("paged")
}

// offset 翻页：从第 4 行起读到文件尾；覆盖到尾但因为起点非 0，仍带标记。
@Test
func boundedReadPagesByOffset() {
    fsCleanup("offset")
    let (rt, _) = fsSetup("offset")
    let f = fsFile("offset")
    File.writeTo(f, "l1\nl2\nl3\nl4\nl5".toArray())
    let r = rt.execute("read", "{\"path\":\"${f}\",\"offset\":3}", "", true)
    @Expect(r.allowed, true)
    @Expect(r.why.contains("l4\nl5"), true)
    @Expect(r.why.contains("[read-truncated:offset=3,lines=2/5]"), true)
    fsCleanup("offset")
}

// 分页读不放宽版本保护：分页观察过之后文件被外部改掉，write 必须照旧按 stale 拒。
@Test
func boundedReadDoesNotWeakenStaleVersionProtection() {
    fsCleanup("pagedstale")
    let (rt, _) = fsSetup("pagedstale")
    let f = fsFile("pagedstale")
    File.writeTo(f, "v1-line1\nv1-line2\nv1-line3".toArray())
    @Expect(rt.execute("read", "{\"path\":\"${f}\",\"limit\":1}", "", true).allowed, true)
    File.writeTo(f, "v2-changed".toArray())
    let w = rt.execute("write", "${f} v3", "allowed-once", true)
    @Expect(w.allowed, false)
    @Expect(w.why, "fs-stale-version:${f}")
    fsCleanup("pagedstale")
}

// 非法分页参数归一成 bad-args：负 offset 与非正 limit 都不让进执行段。
@Test
func boundedReadRejectsInvalidPagination() {
    fsCleanup("badpage")
    let (rt, _) = fsSetup("badpage")
    let f = fsFile("badpage")
    File.writeTo(f, "x".toArray())
    @Expect(rt.execute("read", "{\"path\":\"${f}\",\"offset\":-1}", "", true).allowed, false)
    @Expect(rt.lastDetail.stage, "bad-args")
    @Expect(rt.execute("read", "{\"path\":\"${f}\",\"limit\":0}", "", true).allowed, false)
    @Expect(rt.lastDetail.stage, "bad-args")
    fsCleanup("badpage")
}

// —— 受保护原子替换 —— 已有文件的写入不再走直接覆盖：
// 独占临时文件写完整后原子改名落位，目标任意时刻都是完整的一份。

// 替换后内容完整落位，且专用目录里不留下临时残片（rename 已把 staging 消耗掉）。
@Test
func atomicReplaceLandsWholeContentAndLeavesNoStaging() {
    fsCleanup("atomic")
    let dir = "core-fs-atomic-dir"
    removeIfExists(dir, recursive: true)
    Directory.create(dir)
    let f = "${dir}/core-fs-atomic.txt"
    File.writeTo(f, "before".toArray())
    let before = ArrayList<String>()
    for (info in Directory.readFrom(dir)) { before.add(info.path.fileName) }
    replaceFileAtomically(f, "after".toArray())
    @Expect(String.fromUtf8(File.readFrom(f)), "after")
    var extraStaging = Int64(0)
    for (info in Directory.readFrom(dir)) {
        var known = false
        for (n in before) {
            if (n == info.path.fileName) { known = true }
        }
        if (!known) { extraStaging += 1 }
    }
    @Expect(extraStaging, Int64(0))
    removeIfExists(dir, recursive: true)
    fsCleanup("atomic")
}

// write 工具对已有文件的替换路径：观察 → 原子替换 → 重读逐字节核对，全链不变量保持。
@Test
func writeToolReplacesExistingFileThroughAtomicPath() {
    fsCleanup("atomicwrite")
    let (rt, _) = fsSetup("atomicwrite")
    let f = fsFile("atomicwrite")
    File.writeTo(f, "v1".toArray())
    @Expect(rt.execute("read", f, "", true).allowed, true)
    let w = rt.execute("write", "${f} v2-content", "allowed-once", true)
    @Expect(w.allowed, true)
    @Expect(w.why, "ok:${f}")
    @Expect(String.fromUtf8(File.readFrom(f)), "v2-content")
    fsCleanup("atomicwrite")
}
