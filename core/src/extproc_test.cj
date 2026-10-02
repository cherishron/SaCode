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
