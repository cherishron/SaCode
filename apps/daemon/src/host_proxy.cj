package daemon

import core.*
import std.collection.ArrayList
import std.env.*
import std.fs.*
import std.io.*
import std.process.*
import std.sync.*
import stdx.encoding.json.*

// ---------------------------------------------------------------------------
// 宿主代理：把 daemon 的 HTTP RPC 面**有限度**地转发给仓颉宿主子进程，并把宿主的
// 通知桥进 EventBus（SSE 是唯一出口）。本批要转发的是六个 worktree 方法，外加
// 会话/工作区/起轮必需的动词。
//
// 边界（与 AGENTS.md 的不变量一致）：
//   · 白名单是固定方法集，不提供「发任意方法」的通路；白名单外一律 -32601。
//   · params 必须是 JSON 对象（-32602），本层不替宿主猜字段。
//   · 宿主没配置就 fail-closed（-32010），绝不回退成本地实现去建目录或写会话日志。
//   · 有界等待（默认 30s，SACODE_HOST_TIMEOUT_MS 可收紧到 250..120000）；到点只回
//     -32011，不编一个「失败/已取消/结果为空」的假终态出来。
//   · 结算阶梯见 close()：协议层 host/shutdown 优先，其次本仓 NDJSON 宿主的
//     **空行退出**（apps/host/src/main.cj 读侧 `if (body.size == 0) { break }`），
//     两者都没收住才 terminate(force: true) 兜底并如实记 forced。
//     Cangjie 侧不能靠「关掉写端」造 EOF：std 的 OutputStream 没有文档化 close()。
//
// 错误码（本文件是唯一出处）：
//   -32601 方法未开放      -32602 参数形状非法       -32002 宿主已退出/正在退出
//   -32010 宿主未配置      -32011 宿主请求超时       -32013 转发前置失败
// ---------------------------------------------------------------------------

// 白名单只开放本批会话与工作树产品链；不提供任意 Host 方法通道。
// 方法名逐字取自宿主 initialize 的能力清单（apps/host/src/main.cj），不在此之外造名；
// session/catalog 不在这里——它由 daemon 自己按本地会话根回答，转调只会得到两个真源。
// session/subscribe 也不在这里：宿主的长连接通知由本代理读线程统一收帧后送 bus，
// 一次性 HTTP RPC 转它只会等到一个永远不来的应答。
let hostMethods = [
    "session/create", "session/select", "session/projection", "session/submit", "session/flush",
    "workspace/get", "workspace/set-directory",
    "task/start", "turn/poll", "turn/cancel",
    "worktree/enter", "worktree/describe", "worktree/exit",
    "worktree/agent-prepare", "worktree/agent-finish", "worktree/cleanup"
]

func forwarded(method: String): Bool {
    for (value in hostMethods) {
        if (value == method) { return true }
    }
    return false
}

let hostErrMethod = Int64(-32601)
let hostErrParams = Int64(-32602)
let hostErrExited = Int64(-32002)
let hostErrUnconfigured = Int64(-32010)
let hostErrTimeout = Int64(-32011)
let hostErrForward = Int64(-32013)

func hostTimeoutMs(): Int64 {
    // 默认 30s：一次真实起轮要在宿主里跑完。测试用这个变量把窗口收紧，
    // 「有界等待」因此可断言，而不是只能等满半分钟。
    var value: Int64 = 30000
    if (let Some(raw) <- getVariable("SACODE_HOST_TIMEOUT_MS")) {
        var parsed: Int64 = 0
        var digits = raw.size > 0
        for (b in raw.toArray()) {
            if (b < 48 || b > 57) { digits = false; break }
            parsed = parsed * 10 + Int64(b - 48)
        }
        if (digits && parsed >= 250 && parsed <= 120000) {
            value = parsed
        }
    }
    return value
}

// 复用核心 ReplyTable：内部数字 ID 与 HTTP 调用方 ID 隔离，乱序应答不串请求。
// 三条账各自独立——无主（没人登记过的 id）、迟到（等待方已收手才到的帧）、
// 回压（表满时 put 内部等待，一帧不丢）。
class HostProxy {
    let table = ReplyTable(256)
    let ids = AtomicInt64(0)
    let writeLock = Mutex()
    let lifecycle = Mutex()
    let events: EventBus
    let timeout: Int64
    var proc: Option<SubProcess> = None
    var reader: Option<Future<Int64>> = None
    let dead = AtomicBool(false)
    let settledFlag = AtomicBool(false)
    let forcedFlag = AtomicBool(false)
    let exitCode = AtomicInt64(-1)
    let replyCount = AtomicInt64(0)
    let notifyCount = AtomicInt64(0)
    let timeoutCount = AtomicInt64(0)
    let rejectedCount = AtomicInt64(0)
    var shutdownVia = "none"
    let sent = ArrayList<String>()

    public init(events: EventBus) {
        this.events = events
        timeout = hostTimeoutMs()
    }

    public static func configured(): Bool {
        return (getVariable("SACODE_HOST") ?? "").size > 0
    }

    // 起进程：命令缺失或起不来就抛，且不起读线程（fail-closed，不留下半个宿主）。
    public func start(): Unit {
        synchronized(lifecycle) {
            if (proc.isSome() && !dead.load()) { return }
            if (settledFlag.load()) { throw Exception("host-settled") }
            let command = getVariable("SACODE_HOST") ?? ""
            if (command.size == 0) { throw Exception("host-unconfigured") }
            if ((getVariable("SACODE_COMPUTER_USE") ?? "") == "1") {
                throw Exception("computer-use-remote-grant-required")
            }
            let arguments = ArrayList<String>()
            if (let Some(raw) <- getVariable("SACODE_HOST_ARGS")) {
                let values = JsonValue.fromStr(raw).asArray()
                for (i in 0..values.size()) { arguments.add(values.get(i).getOrThrow().asString().getValue()) }
            }
            let launched = launch(command, arguments.toArray(), workingDirectory: Some(getWorkingDirectory()),
                stdIn: ProcessRedirect.Pipe, stdOut: ProcessRedirect.Pipe, stdErr: ProcessRedirect.Inherit)
            proc = Some(launched)
            // launch 之后必须立刻起抽干线程：Pipe 模式下没人读 stdout，宿主缓冲写满就死锁。
            let pipe = launched.stdOutPipe
            reader = Some(spawn { => this.drain(pipe) })
        }
    }

    public func alive(): Bool {
        return proc.isSome() && !dead.load() && !settledFlag.load()
    }

    // 读线程：应答按 id 入表，无 id 的真实通知即时送 bus；坏帧只记账不吞流。
    private func drain(pipe: InputStream): Int64 {
        let input: StringReader<InputStream> = StringReader(pipe)
        var count: Int64 = 0
        var done = false
        while (!done) {
            try {
                if (let Some(text) <- input.readln()) {
                    if (text.size > 0) {
                        acceptFrame(text)
                        count += 1
                    }
                } else {
                    done = true
                }
            } catch (e: Exception) {
                // 管道断开 / EOF：宿主不再写了，读线程自然收束，不假装还有半帧。
                getStdErr().writeln("宿主读线程收束：${e.message}")
                done = true
            }
        }
        dead.store(true)
        // 先放行可能被回压压住的入表，再让结算去 join 本线程。
        table.stop()
        return count
    }

    // 一帧的三种归宿：应答入表 / 通知送 bus / 坏帧记 rejected。三条都不吞流——
    // 坏帧可能正是某笔在途请求的应答，那份等待由超时如实报出来，不在这里编终态。
    private func acceptFrame(line: String): Unit {
        if (line.size > 1048576) {
            rejectedCount.fetchAdd(1)
            getStdErr().writeln("宿主协议帧超出限制，已丢弃并计数")
            return
        }
        try {
            let frame = JsonValue.fromStr(line).asObject()
            if (frame.get("jsonrpc").isNone() || frame.get("jsonrpc").getOrThrow().asString().getValue() != "2.0") {
                rejectFrame("宿主帧协议版本错误")
                return
            }
            let idNode = frame.get("id")
            let hasResult = frame.containsKey("result")
            let hasError = frame.containsKey("error")
            if (idNode.isSome()) {
                // 应答：result 与 error 必须恰好一个，且 id 必须是整数（本端只发整数 id）。
                if (hasResult == hasError) {
                    rejectFrame("宿主应答形状错误")
                    return
                }
                let id = idNode.getOrThrow()
                if (!(match (id.kind()) { case JsInt => true; case _ => false })) {
                    // id 非整数：不许被任何在途请求认领，交给登记表记无主账（-1 永不登记）。
                    rejectedCount.fetchAdd(1)
                    table.put(Int64(-1), line)
                    getStdErr().writeln("宿主应答 id 非整数，记无主账")
                    return
                }
                table.put(id.asInt().getValue(), line)
                return
            }
            if (hasResult || hasError) {
                rejectFrame("宿主通知里带了 result/error")
                return
            }
            let method = frame.get("method").getOrThrow().asString().getValue()
            if (method.size == 0) {
                rejectFrame("宿主通知方法为空")
                return
            }
            let params = frame.get("params") ?? JsonObject()
            if (!(match (params.kind()) { case JsObject | JsArray => true; case _ => false })) {
                rejectFrame("宿主通知参数错误")
                return
            }
            // 只有「无 id 的真实通知」才上 bus；应答与坏帧都不进，避免把回放当直播。
            notifyCount.fetchAdd(1)
            events.publish(method, params.toString())
        } catch (e: Exception) {
            rejectFrame("宿主帧不可解析：${e.message}")
        }
    }

    private func rejectFrame(reason: String): Unit {
        rejectedCount.fetchAdd(1)
        getStdErr().writeln("${reason}，已计入 rejected")
    }

    private func nextId(): Int64 {
        return ids.fetchAdd(1) + 1
    }

    public func request(method: String, params: String, clientId: JsonValue): String {
        return requestBounded(method, params, clientId, timeout)
    }

    // 一次转调：先登记再写（应答可能比这次 write 返回得还快），整帧互斥，写完必 flush。
    // 单独立一个名字而不是重载，免得「带时限」与「不带时限」两种形状在调用点分不出。
    public func requestBounded(method: String, params: String, clientId: JsonValue, waitMs: Int64): String {
        let id = nextId()
        table.track(id)
        try {
            synchronized(writeLock) {
                if (dead.load() || settledFlag.load()) { throw Exception("host-exited") }
                let p = proc.getOrThrow()
                let frame = "{\"jsonrpc\":\"2.0\",\"id\":${id},\"method\":\"${jsonEscapeText(method)}\",\"params\":${params}}"
                p.stdInPipe.write((frame + "\n").toArray())
                p.stdInPipe.flush()
                if (Int64(sent.size) < 256) { sent.add(method) }
            }
            var got: Option<String> = None
            var waited: Int64 = 0
            while (waited < waitMs) {
                if (let Some(text) <- table.take(id, 100)) { got = Some(text); break }
                waited += 100
                if (dead.load() || settledFlag.load()) {
                    // EOF 与最后一条应答可能落在同一读批里：先取已入表的末帧。
                    if (let Some(text) <- table.take(id, 1)) { got = Some(text) }
                    break
                }
            }
            if (let Some(text) <- got) {
                replyCount.fetchAdd(1)
                let reply = JsonValue.fromStr(text).asObject()
                // 调用方的 id 原样归还（字符串就还字符串），内部 id 不外泄。
                reply.put("id", clientId)
                return reply.toString()
            }
            if (dead.load() || settledFlag.load()) { throw Exception("host-exited") }
            timeoutCount.fetchAdd(1)
            throw Exception("host-timeout")
        } finally { table.untrack(id) }
    }

    // 收手：先有界等宿主自己退出，超时才强杀并如实标 forced；然后 join 读线程。
    private func settleLocked(timeoutMs: Int64): Unit {
        if (let Some(p) <- proc) {
            var exited = false
            try {
                exitCode.store(p.wait(timeout: timeoutMs * Duration.millisecond))
                exited = true
            } catch (e: Exception) {
                exited = false
            }
            if (!exited) {
                forcedFlag.store(true)
                if (shutdownVia == "protocol" || shutdownVia == "empty-line") {
                    shutdownVia = "terminate"
                }
                try { p.terminate(force: true) } catch (e: Exception) {
                    getStdErr().writeln("宿主强杀失败：${e.message}")
                }
                try { exitCode.store(p.wait()) } catch (e: Exception) {
                    getStdErr().writeln("宿主等待失败：${e.message}")
                }
            }
        }
        table.stop()
        if (let Some(f) <- reader) {
            try {
                f.get(2000 * Duration.millisecond)
            } catch (e: Exception) {
                getStdErr().writeln("宿主读线程未收束：${e.message}")
            }
            reader = None
        }
        settledFlag.store(true)
    }

    // 结算阶梯（顺序不能换）：
    //   1) 协议层 host/shutdown —— 实现它的宿主（extjs 那一类）自己收尾并回帧；
    //   2) 空行 —— 本仓 NDJSON 宿主（apps/host/src/main.cj）的文档化退出路径；
    //   3) terminate(force: true) 只在 1、2 都没收住时用，并把 forced 记进统计。
    // 统计里 shutdownVia 说明到底哪一条收的尾，不许把强杀说成优雅。
    public func close(): JsonObject {
        synchronized(lifecycle) {
            if (!settledFlag.load()) {
                if (proc.isSome() && !dead.load()) {
                    var answered = false
                    try {
                        let reply = requestBounded("host/shutdown", "{}", JsonNull(), Int64(1500))
                        answered = !JsonValue.fromStr(reply).asObject().containsKey("error")
                    } catch (e: Exception) {
                        answered = false
                    }
                    if (answered) {
                        shutdownVia = "protocol"
                    } else {
                        // host/shutdown 未实现（-32601）或没回帧：改走空行退出。
                        try {
                            synchronized(writeLock) {
                                let p = proc.getOrThrow()
                                p.stdInPipe.write("\n".toArray())
                                p.stdInPipe.flush()
                            }
                            shutdownVia = "empty-line"
                        } catch (e: Exception) {
                            getStdErr().writeln("宿主空行退出写入失败：${e.message}")
                            shutdownVia = "terminate"
                        }
                    }
                } else if (proc.isSome()) {
                    shutdownVia = "already-exited"
                } else {
                    shutdownVia = "never-started"
                }
                settleLocked(3000)
            }
        }
        return stats()
    }

    public func stats(): JsonObject {
        let obj = JsonObject()
        obj.put("exit", JsonInt(exitCode.load()))
        obj.put("forced", JsonBool(forcedFlag.load()))
        obj.put("shutdownVia", JsonString(shutdownVia))
        obj.put("replies", JsonInt(replyCount.load()))
        obj.put("notifications", JsonInt(notifyCount.load()))
        obj.put("timedOut", JsonInt(timeoutCount.load()))
        obj.put("rejected", JsonInt(rejectedCount.load()))
        // 无主/迟到/回压三本账出自登记表本身，不由本层猜；丢帧结构性为 0。
        obj.put("stray", JsonInt(table.unsolicited()))
        obj.put("late", JsonInt(table.late()))
        obj.put("backpressure", JsonInt(table.overflow()))
        obj.put("dropped", JsonInt(table.dropped()))
        var list = "["
        var comma = ""
        synchronized(writeLock) {
            for (name in sent) {
                list += "${comma}\"${jsonEscapeText(name)}\""
                comma = ","
            }
        }
        list += "]"
        obj.put("methods", JsonValue.fromStr(list))
        obj.put("timeoutMs", JsonInt(timeout))
        return obj
    }
}

// params 必须是 JSON 对象：本层不替宿主猜字段，也不接受数组/标量/null 形状。
func hostParamsOk(params: String): Bool {
    try {
        let shape = JsonValue.fromStr(params)
        return match (shape.kind()) { case JsObject => true; case _ => false }
    } catch (e: Exception) {
        return false
    }
}

// 桥：把「懒起进程 + 白名单 + 失败归因」收在一处，daemon.cj 只认四个入口。
class HostProxyBridge {
    let bus: EventBus
    let gate = Mutex()
    var proxy: Option<HostProxy> = None
    var shuttingDown = false

    public init(bus: EventBus) { this.bus = bus }

    public func configured(): Bool {
        return HostProxy.configured()
    }

    private func instance(): HostProxy {
        synchronized(gate) {
            if (shuttingDown) { throw Exception("host-exited") }
            if (let Some(p) <- proxy) {
                // 宿主没了就不重起、不退回本地实现：调用方拿到 -32002 才分得清
                // 「这条没执行」和「执行了但失败」。
                if (!p.alive()) { throw Exception("host-exited") }
                return p
            }
            let p = HostProxy(bus)
            p.start()
            proxy = Some(p)
            return p
        }
    }

    // 白名单外一律 -32601；params 非对象一律 -32602。两条都在转调之前判完，
    // 于是「不发出去的帧」是真的没发出去，不是宿主替我们拒的。
    // 失败归因只看 message 形态，不改语义：超时不是退出，退出不是未配置。
    public func forward(method: String, params: String, clientId: JsonValue): String {
        let idText = clientId.toString()
        if (!forwarded(method)) { return errRpc(idText, hostErrMethod, "方法未开放") }
        if (!hostParamsOk(params)) { return errRpc(idText, hostErrParams, "参数必须是 JSON 对象") }
        try {
            let proxyRef = instance()
            return proxyRef.request(method, params, clientId)
        } catch (e: Exception) {
            let message = e.message
            if (message == "host-unconfigured") { return errRpc(idText, hostErrUnconfigured, "宿主未配置（SACODE_HOST）") }
            if (message == "host-exited" || message == "host-settled") { return errRpc(idText, hostErrExited, "宿主已退出") }
            if (message == "host-timeout") { return errRpc(idText, hostErrTimeout, "宿主请求超时") }
            if (message.startsWith("host-args-invalid")) { return errRpc(idText, hostErrForward, "宿主参数非法：${message}") }
            return errRpc(idText, hostErrForward, "宿主转发失败：${message}")
        }
    }

    // 结算并把统计作为通知送 bus：SSE 消费者因此能断言「优雅、未被强杀、退出码、三本账」。
    public func shutdown(): Unit {
        synchronized(gate) {
            if (shuttingDown) { return }
            shuttingDown = true
        }
        if (let Some(p) <- proxy) {
            bus.publish("daemon/host-shutdown", p.close().toString())
        } else {
            bus.publish("daemon/host-shutdown",
                "{\"exit\":-1,\"forced\":false,\"shutdownVia\":\"never-started\",\"replies\":0,\"notifications\":0,\"timedOut\":0,\"rejected\":0,\"stray\":0,\"late\":0,\"backpressure\":0,\"dropped\":0,\"methods\":[],\"timeoutMs\":${hostTimeoutMs()}}")
        }
    }

    public func capabilities(): ArrayList<String> {
        let out = ArrayList<String>()
        for (name in hostMethods) { out.add(name) }
        return out
    }
}
