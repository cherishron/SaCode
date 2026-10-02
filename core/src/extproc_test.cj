package core

import std.unittest.*
import std.fs.*

// 逐级向上找仓库里的 extjs/server.cjs：单测不写死绝对路径，也不假设 cjpm test 的工作目录。
// 找不到就返回空 Path——start() 会失败，测试据此明确报红，绝不静默跳过。
func extHostDir(): Path {
    var base = "./"
    var i: Int64 = 0
    while (i < 8) {
        if (exists("${base}extjs/server.cjs")) {
            return canonicalize("${base}extjs")
        }
        base = "${base}../"
        i += 1
    }
    return Path("")
}

func newExtHost(): ExtProcess {
    return ExtProcess("node", ["server.cjs"], workingDirectory: extHostDir())
}

@Test
func jsHostAnswersTheInitializeHandshake() {
    let xp = newExtHost()
    @Expect(xp.start(), true)
    @Expect(xp.alive(), true)
    var frame = ""
    if (let Some(f) <- xp.initialize()) {
        frame = f
    }
    // 能力表必须来自子进程的真实应答，不是本端写死的
    @Expect(frame.contains("protocolVersion"), true)
    @Expect(frame.contains("extension/load"), true)
    @Expect(xp.received() >= Int64(1), true)
    xp.close()
}

@Test
func jsToolsLoadListCallAndDisposeOverTheRealPipe() {
    let xp = newExtHost()
    @Expect(xp.start(), true)
    xp.initialize()
    var loaded = ""
    if (let Some(f) <- xp.load("example/echo.cjs")) {
        loaded = f
    }
    @Expect(loaded.contains("example.echo"), true)
    var listed = ""
    if (let Some(f) <- xp.list()) {
        listed = f
    }
    @Expect(listed.contains("example.echo"), true)
    var echoed = ""
    if (let Some(f) <- xp.call("example.echo", "over-stdio")) {
        echoed = f
    }
    @Expect(echoed.contains("echoed"), true)
    @Expect(echoed.contains("over-stdio"), true)
    var gone = ""
    if (let Some(f) <- xp.dispose("example.echo")) {
        gone = f
    }
    @Expect(gone.contains("true"), true)
    var after = ""
    if (let Some(f) <- xp.list()) {
        after = f
    }
    // 卸载残留必须为 0：注册表里不能还留着这个名字
    @Expect(after.contains("example.echo"), false)
    xp.close()
}

@Test
func unknownMethodFromTheJsHostIsAResponseNotAFabrication() {
    let xp = newExtHost()
    @Expect(xp.start(), true)
    var frame = ""
    if (let Some(f) <- xp.request(7, "no/such.method", "{}")) {
        frame = f
    }
    @Expect(frame.contains("-32601"), true)
    @Expect(xp.alive(), true)
    xp.close()
}

@Test
func closingTheChildSettlesItInsteadOfLeavingZombie() {
    let xp = newExtHost()
    @Expect(xp.start(), true)
    xp.initialize()
    @Expect(xp.close(), Int64(0))
    @Expect(xp.alive(), false)
    // 退出码 0 只算一半：必须是「宿主自己结算完退出」，而不是本端强杀后拿到的码
    @Expect(xp.forcedExit(), false)
    // 已结算的退出码可重复读，第二次不得再去 wait 一个已回收的进程
    @Expect(xp.exitCode(), Int64(0))
    @Expect(xp.close(), Int64(0))
}

@Test
func requestAfterTheChildIsGoneReturnsNone() {
    let xp = newExtHost()
    @Expect(xp.start(), true)
    xp.close()
    var got = true
    if (let Some(_) <- xp.initialize()) {
        got = false
    }
    // 子进程已收束：这里只能是 None，绝不能拿旧帧或编一个终态
    @Expect(got, true)
}

@Test
func callThatNeverRepliesTimesOutWithoutAFabricatedResult() {
    let xp = newExtHost()
    @Expect(xp.start(), true)
    xp.initialize()
    xp.load("example/slow.cjs")
    var got = true
    if (let Some(_) <- xp.call("example.slow", "x", timeoutMs: 300)) {
        got = false
    }
    @Expect(got, true)
    // 宿主退出时必须结算在途调用并干净收束，不留下挂死的读线程
    @Expect(xp.close() >= Int64(0), true)
    @Expect(xp.alive(), false)
}

@Test
func killingTheChildSettlesTheReaderThread() {
    let xp = newExtHost()
    @Expect(xp.start(), true)
    xp.initialize()
    @Expect(xp.kill() >= Int64(0), true)
    @Expect(xp.alive(), false)
    @Expect(xp.forcedExit(), true)
}

@Test
func badCommandFailsClosedInsteadOfPanicking() {
    // 命令不存在：start() 返回 false 并把原因留给调用方读，不能抛穿到入口
    let xp = ExtProcess("no-such-binary-for-dsh-test", [], workingDirectory: Path("./"))
    @Expect(xp.start(), false)
    @Expect(xp.alive(), false)
    @Expect(xp.startFailure().size > 0, true)
    @Expect(xp.close(), Int64(-1))
}

@Test
func twoConcurrentRequestsTakeTheirOwnFrames() {
    // 两条请求同时在途：各自的帧必须只给自己的等待方。
    // 顺序实现下这里会互相吃掉对方的帧，表现为某一条拿不到应答。
    let xp = newExtHost()
    @Expect(xp.start(), true)
    xp.initialize()
    let other = spawn { => xp.load("example/echo.cjs") }
    var listed = ""
    if (let Some(f) <- xp.list()) {
        listed = f
    }
    var loaded = ""
    if (let Some(f) <- other.get()) {
        loaded = f
    }
    @Expect(listed.contains("names"), true)
    @Expect(loaded.contains("ok"), true)
    // 配对了就不该被算成无主帧
    @Expect(xp.unsolicited(), Int64(0))
    xp.close()
}

@Test
func lateReplyIsBookedSeparatelyAfterTheWaiterGivesUp() {
    let xp = newExtHost()
    @Expect(xp.start(), true)
    xp.initialize()
    xp.load("example/delayed.cjs")
    var got = true
    if (let Some(_) <- xp.call("example.delayed", "slow", timeoutMs: 60)) {
        got = false
    }
    // 放弃等待时不能编结果
    @Expect(got, true)
    @Expect(xp.late(), Int64(0))
    // 迟到帧什么时候落地是异步的：有界轮询到它归账，而不是睡一个「看起来够用」的定值
    var tries: Int64 = 0
    while (xp.late() == Int64(0) && tries < 60) {
        sleep(50 * Duration.millisecond)
        tries += 1
    }
    @Expect(xp.late() >= Int64(1), true)
    @Expect(xp.unsolicited(), Int64(0))
    var listed = ""
    if (let Some(f) <- xp.list()) {
        listed = f
    }
    @Expect(listed.contains("names"), true)
    xp.close()
}

@Test
func unattributedFrameIsFlaggedAndPairingSurvives() {
    let xp = newExtHost()
    @Expect(xp.start(), true)
    xp.initialize()
    // params 写成坏 JSON：宿主会回一条 id 为 null 的 parse-error，没人能认领它
    xp.request(900, "extension/list", "{oops", timeoutMs: 600)
    // 无主帧同样是异步入账：轮询到有记录为止
    var waits: Int64 = 0
    while (xp.unsolicited() == Int64(0) && waits < 60) {
        sleep(50 * Duration.millisecond)
        waits += 1
    }
    @Expect(xp.unsolicited() >= Int64(1), true)
    // 无主帧被明确标记后，正常请求的配对必须照旧
    var listed = ""
    if (let Some(f) <- xp.list()) {
        listed = f
    }
    @Expect(listed.contains("names"), true)
    @Expect(xp.late(), Int64(0))
    xp.close()
}

// 取消联动的底层落点：调用还在途时，同一条管道必须还能读出取消请求，
// 且被取消的那笔要按自己的 id 拿到 -32021，而不是等到超时或被本端编一个终态。
@Test
func cancellingAnInflightCallSettlesItWithACancelledFrame() {
    let xp = newExtHost()
    @Expect(xp.start(), true)
    xp.initialize()
    xp.load("example/delayed.cjs")
    let inflight = spawn { => xp.callCancelable(Int64(7), "example.delayed", "never", timeoutMs: Int64(4000)) }
    // 两个线程各写一帧，先后次序不由本端决定：重试到子进程真看见那笔在途调用为止
    var ack = ""
    var tries: Int64 = 0
    while (tries < 40) {
        if (let Some(f) <- xp.cancelCall(Int64(7))) {
            ack = f
        }
        if (ack.contains("\"cancelled\":true")) {
            break
        }
        sleep(25 * Duration.millisecond)
        tries += 1
    }
    @Expect(ack.contains("\"cancelled\":true"), true)
    var res = ""
    try {
        if (let Some(f) <- inflight.get(4000 * Duration.millisecond)) {
            res = f
        }
    } catch (e: Exception) {
        res = "join-timeout"
    }
    @Expect(res.contains("-32021"), true)
    @Expect(res.contains("cancelled"), true)
    // 迟到 300ms 的 handler 结果不得再补一帧：这里只承认「无人认领的帧」计数
    sleep(500 * Duration.millisecond)
    @Expect(xp.unsolicited(), Int64(0))
    xp.close()
}

// 没有这条在途调用就说「取消成功」，等于给桌面编一个没发生过的结算。
@Test
func cancellingAnUnknownOrSettledCallIdDoesNotPretend() {
    let xp = newExtHost()
    @Expect(xp.start(), true)
    xp.initialize()
    xp.load("example/delayed.cjs")
    var miss = ""
    if (let Some(f) <- xp.cancelCall(Int64(999))) {
        miss = f
    }
    @Expect(miss.contains("\"cancelled\":false"), true)
    // 正常一笔必须照旧落地
    var ok = ""
    if (let Some(f) <- xp.callCancelable(Int64(8), "example.delayed", "fine", timeoutMs: Int64(4000))) {
        ok = f
    }
    @Expect(ok.contains("echoed"), true)
    // 已结算之后再取消同一 callId：还是 false
    var after = ""
    if (let Some(f) <- xp.cancelCall(Int64(8))) {
        after = f
    }
    @Expect(after.contains("\"cancelled\":false"), true)
    xp.close()
}

// 转调不再占住调用方：这一条走的是「发出去 + 独立线程收帧」，
// 在途期间同一条管道还要能完成别的请求（Host 的读侧并发就建在这上面）。
@Test
func callAsyncOffloadsTheReplyAndSettlesExactlyOneFrame() {
    let xp = newExtHost()
    @Expect(xp.start(), true)
    xp.initialize()
    xp.load("example/delayed.cjs")
    let sink = ThreadSafeDeliveryQueue(8)
    @Expect(xp.callAsync(Int64(31), "example.delayed", "async", sink), true)
    // 调用还在途，另一条请求必须照样完成
    var listed = ""
    if (let Some(f) <- xp.list()) {
        listed = f
    }
    @Expect(listed.contains("example.delayed"), true)
    var frame = ""
    var waits: Int64 = 0
    while (frame.size == 0 && waits < 200) {
        let got = sink.take(Int64(8))
        if (got.size > 0) {
            frame = got[0]
        } else {
            sleep(20 * Duration.millisecond)
            waits += 1
        }
    }
    @Expect(frame.contains("\"callId\":31"), true)
    @Expect(frame.contains("echoed"), true)
    @Expect(xp.joinWaiters(Int64(1000)), Int64(1))
    @Expect(xp.inflightWaiters(), Int64(0))
    // 交过账的线程不得重复 join，否则退出计数会虚高
    @Expect(xp.joinWaiters(Int64(1000)), Int64(0))
    xp.close()
}

// 子进程已经不在的时候，callAsync 必须当场回 false：
// 登记一条永远等不到帧的在途调用，等于给桌面留一个悬空的 pending。
@Test
func callAsyncOnDeadChildFailsImmediately() {
    let xp = ExtProcess("node-not-at-all", ["server.cjs"], workingDirectory: extHostDir())
    @Expect(xp.start(), false)
    let sink = ThreadSafeDeliveryQueue(8)
    @Expect(xp.callAsync(Int64(1), "example.delayed", "x", sink), false)
    @Expect(xp.inflightWaiters(), Int64(0))
    @Expect(sink.size(), Int64(0))
}
