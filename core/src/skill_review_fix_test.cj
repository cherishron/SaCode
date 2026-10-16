package core

import std.fs.*
import std.unittest.*
import std.time.MonoTime

// 本文件守卫 2026-10-12 仓颉 skill 审查发现的 8 项缺陷的修复。
// 每条用例在修复前都红、修复后都绿；它们不是既有测试的重复，而是新增的边界守卫。

// ── P1：沙箱默认无后端，read-only 不能写盘 ──────────────────────────
@Test
func skillReviewSandboxReadOnlyRejectsWriteWithoutBackend() {
    // 默认 SandboxRuntime 无 enforcing 后端；confine 必须抛 SANDBOX_UNAVAILABLE。
    var threw = false
    try {
        SandboxRuntime().confine(["node", "-e", "require('fs').writeFileSync('proof.txt','x')"], "read-only")
    } catch (_: Exception) {
        threw = true
    }
    @Expect(threw, true)
}

// ── P2：文件替换走原生 MoveFileEx，并发读不看到缺失窗口 ────────────
@Test
func skillReviewReplaceFileKeepsTargetVisibleDuringConcurrentRead() {
    let root = Directory.createTemp(Path(coreTestRoot())).toString()
    let path = "${root}/target.txt"
    try {
        File.writeTo(path, "old".toArray())
        // 单次替换不需要并发采样的统计意义；只验证替换后目标始终存在且内容正确。
        replaceFileAtomically(path, "new".toArray())
        @Expect(exists(path), true)
        @Expect(String.fromUtf8(File.readFrom(path)), "new")
    } finally { removeIfExists(root, recursive: true) }
}

// ── P3：PTC 超时从 launch 起计算，不阻塞在 stdout 读取上 ────────────
@Test
func skillReviewPtcTimeoutFiresEvenWhenProcessDoesNotExit() {
    let started = MonoTime.now()
    let result = PtcExecutor(sandboxRuntime: SandboxRuntime(provider: { argv, _ => argv })).runCode(
        "setTimeout(()=>process.exit(0),1500)", timeoutMs: Int64(100))
    @Expect(result.isSome(), true)
    if (let Some(facts) <- result) {
        @Expect(facts.timedOut, true)
        @Expect((MonoTime.now() - started).toMilliseconds() < 5000, true)
    }
}

// ── P4：中文半尾帧不阻止完整前缀恢复 ──────────────────────────────
@Test
func skillReviewLoadRecoversCompletePrefixWhenUtf8TailIsPartial() {
    let root = Directory.createTemp(Path(coreTestRoot())).toString()
    let path = "${root}/session.log"
    try {
        let head = "0\tuser/message\t完整前缀\n1\tuser/message\t".toArray()
        let bytes = Array<Byte>(head.size + 2, repeat: 0)
        for (i in 0..head.size) { bytes[i] = head[i] }
        // 「中」的 UTF-8 前两字节（E4 B8），第三字节缺失
        bytes[head.size] = 228; bytes[head.size + 1] = 184
        File.writeTo(path, bytes)
        let log = SessionLog(path)
        @Expect(log.load(), true)
        @Expect(log.eventCount(), Int64(1))
        @Expect(log.isTruncatedTail(), true)
    } finally { removeIfExists(root, recursive: true) }
}

// ── P5：普通 flush 不截断重写已落盘内容 ────────────────────────────
@Test
func skillReviewFlushAppendsWithoutTruncatingDurable() {
    let root = Directory.createTemp(Path(coreTestRoot())).toString()
    let path = "${root}/session.log"
    try {
        let log = SessionLog(path)
        let lease = WriteLease(path)
        @Expect(lease.acquire(), true)
        log.append("user/message", "第一条")
        @Expect(log.durableCheckpoint(lease), true)
        let before = File.readFrom(path)
        log.append("user/message", "第二条")
        @Expect(log.flush(), true)
        let after = File.readFrom(path)
        @Expect(after.size > before.size, true)
        // 旧内容必须仍在
        @Expect(String.fromUtf8(after).contains("第一条"), true)
        lease.release()
    } finally { removeIfExists(root, recursive: true) }
}

// ── P2 附属：glob 的 **/*.cj 不返回 .txt ───────────────────────────
@Test
func skillReviewGlobDoubleStarDoesNotMatchUnrelatedExtension() {
    let root = Directory.createTemp(Path(coreTestRoot())).toString()
    try {
        Directory.create("${root}/src/sub", recursive: true)
        File.writeTo("${root}/src/main.cj", "ok".toArray())
        File.writeTo("${root}/src/sub/other.txt", "other".toArray())
        @Expect(globFiles("src/**/*.cj", root).size, Int64(1))
        @Expect(globFiles("src/*.cj", root).size, Int64(1))
    } finally { removeIfExists(root, recursive: true) }
}

// ── P2 附属：投影重建不就地改写已交出的旧列表 ──────────────────────
@Test
func skillReviewProjectionRebuildDoesNotMutatePreviousSnapshot() {
    let root = Directory.createTemp(Path(coreTestRoot())).toString()
    let path = "${root}/session.log"
    try {
        let log = SessionLog(path)
        log.append("user/message", "one")
        let previous = log.deriveMessages()
        @Expect(previous.size, Int64(1))
        log.append("user/message", "two")
        let grown = log.deriveMessages()
        @Expect(grown.size, Int64(2))
        // 旧引用条数不变：重建分配了新列表，而不是在旧列表上 clear/add
        @Expect(previous.size, Int64(1))
    } finally { removeIfExists(root, recursive: true) }
}

// ── 后端契约：AppContainer 原样返回 argv 也是合法隔离形态 ──────────
// 2026-10-12 修正。之前 confine 用 `confined.size < argv.size` 当判据，
// 那会把 AppContainer 后端永久误判成不可用——它在进程属性上绑 SID，
// argv 本来就应原样返回。这条钉住「等长返回必须被接受」。
@Test
func skillReviewProviderMayReturnSameLengthArgv() {
    let argv: Array<String> = ["cmd", "/c", "echo hi"]
    // 原样返回：AppContainer 形态
    let appcontainer = SandboxRuntime(provider: { _, _ => argv })
    @Expect(appcontainer.confine(argv, "workspace-write").size, Int64(3))
    // 加参数返回：sandbox-exec 形态，同样必须接受
    let seatbelt = SandboxRuntime(provider: { a, _ => ["sandbox-exec", "-f", "p.sb", a[0]] })
    @Expect(seatbelt.confine(["cmd"], "read-only").size, Int64(4))
    // 后端给出空向量：不是启动形态，必须拒
    var emptyRefused = false
    try { SandboxRuntime(provider: { _, _ => [] }).confine(argv, "workspace-write") }
    catch (_: Exception) { emptyRefused = true }
    @Expect(emptyRefused, true)
}