package core
import std.collection.ArrayList
import std.convert.*
import std.fs.*
import std.io.*
import std.process.*
import std.sync.*

// ACP 外部 Agent 子进程托管：在 ExtProcess 成熟模式上抽 ACP 适配层。
// 帧编解码默认 NDJSON（OpenCode 已核 2026-10-08），保留 Content-Length 占位（待核产品）。
// stderr 改为可回收诊断（design §2.4.4），不污染协议面；崩溃/异常证据保留在诊断缓冲。
// restart 仅在委派未进入运行态时允许，不用于失败后自动换执行者（REQ-FAIL-01 划定）。
let acpTransportGenerations = AtomicInt64(0)
public class AcpProcess {
    let command: String
    let arguments: Array<String>
    let wd: Path
    // 帧编解码模式："ndjson"（默认，OpenCode 已核）或 "content-length"（待核产品）
    let frameMode: String

    // 应答按 id 配对：允许多条请求在途；表满时回压而不是丢帧
    let table = ReplyTable(256)
    // 两个线程同时往子进程 stdin 写帧会交错出坏帧，写侧必须整帧互斥
    let writeLock = Mutex()
    let idGen = AtomicInt64(0)
    let recv = AtomicInt64(0)
    let inbound = AcpInboundInbox()
    let permissions = AcpPermissionReplies()
    let generation = AtomicInt64(0)
    let invalidFrames = AtomicInt64(0)

    // stderr 诊断缓冲：有界，不污染协议面（design §2.4.4）
    let diagBuf = ArrayList<Byte>()
    let diagLock = Mutex()
    let diagMax: Int64 = 8192

    // 委派是否在运行态：DelegationService 置位/复位，restart 前检查
    var busy = false
    let negotiationLock = Mutex()
    var closeSupported = false
    var activeSession = ""

    var proc: Option<SubProcess> = None
    var reader: Option<Future<Int64>> = None
    var errReader: Option<Future<Int64>> = None
    var running = false
    var settled = false
    var forced = false
    var code: Int64 = -1
    var why = ""

    public init(command: String, arguments: Array<String>, workingDirectory!: Path, frameMode!: String = "ndjson") {
        this.command = command
        this.arguments = arguments
        this.wd = workingDirectory
        this.frameMode = frameMode
    }

    public func start(): Bool {
        if (running) {
            return true
        }
        why = ""
        let currentGeneration = acpTransportGenerations.fetchAdd(1) + 1
        generation.store(currentGeneration)
        permissions.reset(currentGeneration)
        inbound.clear()
        negotiationLock.lock()
        closeSupported = false
        activeSession = ""
        negotiationLock.unlock()
        try {
            // stderr 改为 Pipe：可回收诊断（design §2.4.4），不污染协议面
            let p = launch(command, arguments, workingDirectory: Some(wd),
                           stdIn: ProcessRedirect.Pipe, stdOut: ProcessRedirect.Pipe,
                           stdErr: ProcessRedirect.Pipe)
            proc = Some(p)
            running = true
            let outPipe = p.stdOutPipe
            reader = Some(spawn { => this.drainStdout(outPipe, currentGeneration) })
            let errPipe = p.stdErrPipe
            errReader = Some(spawn { => this.drainStderr(errPipe) })
            return true
        } catch (e: Exception) {
            why = "spawn-failed: ${e}"
            running = false
            return false
        }
    }

    public func alive(): Bool {
        return running && !settled
    }

    public func startFailure(): String {
        return why
    }

    public func received(): Int64 {
        return recv.load()
    }

    public func unsolicited(): Int64 {
        return table.unsolicited()
    }

    public func late(): Int64 {
        return table.late()
    }

    public func overflow(): Int64 {
        return table.overflow()
    }

    public func dropped(): Int64 {
        return table.dropped()
    }

    public func exitCode(): Int64 {
        return code
    }

    public func forcedExit(): Bool {
        return forced
    }

    // 取回 stderr 诊断内容（design §2.4.4）
    public func diagnostics(): String {
        diagLock.lock()
        let out = String.fromUtf8(diagBuf.toArray())
        diagLock.unlock()
        return out
    }

    // DelegationService 置位/复位：restart 前检查（REQ-FAIL-01 划定）
    public func markBusy() {
        busy = true
    }

    public func markIdle() {
        busy = false
    }

    // 读线程体：把每一帧按 id 交给登记表（NDJSON 模式，与 ExtProcess 一致）。
    // Content-Length 模式待核产品实测后实现（当前走 NDJSON 分支）。
    private func drainStdout(pipe: InputStream, expectedGeneration: Int64): Int64 {
        let rd: StringReader<InputStream> = StringReader(pipe)
        var n: Int64 = 0
        var done = false
        while (!done) {
            try {
                let line = rd.readln()
                if (let Some(s) <- line) {
                    if (s.size > 0) {
                        if (generation.load() != expectedGeneration) { return n }
                        this.routeInbound(s, expectedGeneration: Some(expectedGeneration))
                        n += 1
                        recv.fetchAdd(1)
                    }
                } else {
                    done = true
                }
            } catch (e: Exception) {
                done = true
            }
        }
        return n
    }

    // 内部分类入口也供协议回归验证；未知请求绝不进入工具执行器。
    func routeInbound(raw: String, expectedGeneration!: ?Int64 = None): Bool {
        let packetGeneration = expectedGeneration ?? generation.load()
        if (packetGeneration != generation.load()) { return false }
        try {
            let frame = acpDecodeInbound(raw, generation: packetGeneration)
            if (frame.kind == "response") { table.put(Int64.parse(frame.idJson), raw); return true }
            if (frame.kind == "notification") {
                if (frame.method != "session/update") { return true }
            } else if (frame.method != "session/request_permission") {
                return rejectInbound(frame, -32601, "method-not-found")
            }
            if (frame.kind == "request" && !permissions.register(frame)) {
                invalidFrames.fetchAdd(1)
                return rejectInbound(frame, -32600, "acp-permission-identity-unavailable")
            }
            if (!inbound.put(frame)) {
                permissions.discard(frame)
                invalidFrames.fetchAdd(1)
                if (frame.kind == "request") { return rejectInbound(frame, -32000, "acp-inbox-full") }
                return false
            }
            return true
        } catch (_: Exception) { invalidFrames.fetchAdd(1); return false }
    }

    private func rejectInbound(frame: AcpInboundFrame, errorCode: Int64, message: String): Bool {
        if (let Some(p) <- proc) {
            let response = "{\"jsonrpc\":\"2.0\",\"id\":${frame.idJson},\"error\":{\"code\":${errorCode},\"message\":\"${message}\"}}"
            writeLock.lock()
            try {
                if (frameMode != "ndjson") { return false }
                p.stdInPipe.write((response + "\n").toArray())
                p.stdInPipe.flush()
                return true
            } finally { writeLock.unlock() }
        }
        return false
    }

    // 仅内部装配可调用；缺权威批准回调时拒绝，不开放任意协议写入口。
    func replyPermission(frame: AcpInboundFrame, decision: String, optionId: String, authorize!: () -> Bool = { => false }): Bool {
        if (!alive() || frameMode != "ndjson") { return false }
        try {
            let permission = acpReadWirePermission(frame)
            negotiationLock.lock()
            let session = activeSession
            negotiationLock.unlock()
            if (session.size == 0 || permission.session != session) { return false }
            let result = acpWirePermissionOutcome(permission, decision, optionId)
            return permissions.deliverExact(frame, authorize, { =>
                if (let Some(p) <- proc) {
                    let response = "{\"jsonrpc\":\"2.0\",\"id\":${permission.frame.idJson},\"result\":${result}}"
                    writeLock.lock()
                    try {
                        p.stdInPipe.write((response + "\n").toArray())
                        p.stdInPipe.flush()
                        return true
                    } finally { writeLock.unlock() }
                }
                return false
            })
        } catch (_: Exception) { return false }
    }
    func hasPendingPermission(frame: AcpInboundFrame): Bool { return alive() && permissions.containsExact(frame) }
    public func nextInbound(): ?AcpInboundFrame { return inbound.take() }
    public func invalidInboundCount(): Int64 { return invalidFrames.load() }
    // stderr 读线程体：有界地收集诊断字节，超出上限截断尾部
    private func drainStderr(pipe: InputStream): Int64 {
        let rd: StringReader<InputStream> = StringReader(pipe)
        var n: Int64 = 0
        var done = false
        while (!done) {
            try {
                let line = rd.readln()
                if (let Some(s) <- line) {
                    diagLock.lock()
                    if (Int64(diagBuf.size) < diagMax) {
                        for (b in s.toArray()) {
                            diagBuf.add(b)
                        }
                        diagBuf.add(10) // \n
                    }
                    diagLock.unlock()
                    n += 1
                } else {
                    done = true
                }
            } catch (e: Exception) {
                done = true
            }
        }
        return n
    }

    private func nextId(): Int64 {
        return idGen.fetchAdd(1) + 1
    }

    public func nextRequestId(): Int64 {
        return nextId()
    }

    // 按 id 配对，允许多条请求同时在途；超时只回 None，绝不编一个终态出来
    public func request(id: Int64, method: String, params: String, timeoutMs!: Int64 = 8000): Option<String> {
        if (!sendRequest(id, method, params)) {
            return None
        }
        return awaitReply(id, timeoutMs)
    }

    public func sendRequest(id: Int64, method: String, params: String): Bool {
        if (!alive()) {
            return false
        }
        table.track(id)
        if (let Some(p) <- proc) {
            let frame = "{\"jsonrpc\":\"2.0\",\"id\":${id},\"method\":\"${method}\",\"params\":${params}}"
            writeLock.lock()
            var failed = false
            try {
                if (frameMode == "content-length") {
                    // Content-Length 帧（待核产品）：Content-Length: <n>\r\n\r\n<json>
                    let body = frame
                    let bodyBytes = body.toArray()
                    let header = "Content-Length: ${Int64(bodyBytes.size)}\r\n\r\n"
                    let all = ArrayList<Byte>()
                    for (b in header.toArray()) {
                        all.add(b)
                    }
                    for (b in bodyBytes) {
                        all.add(b)
                    }
                    p.stdInPipe.write(all.toArray())
                    p.stdInPipe.flush()
                } else {
                    // NDJSON 帧（OpenCode 已核）：JSON + \n
                    p.stdInPipe.write((frame + "\n").toArray())
                    p.stdInPipe.flush()
                }
            } catch (e: Exception) {
                why = "write-failed: ${e}"
                failed = true
            }
            writeLock.unlock()
            if (failed) {
                table.untrack(id)
                return false
            }
            return true
        } else {
            table.untrack(id)
            return false
        }
    }

    public func awaitReply(id: Int64, timeoutMs: Int64): Option<String> {
        let out = table.take(id, timeoutMs)
        table.untrack(id)
        return out
    }

    // === ACP 具名方法 ===

    // initialize：能力协商（protocolVersion + client 信息）
    public func acpInitialize(protocolVersion: Int64, clientName: String, clientVersion: String, timeoutMs!: Int64 = 8000): Option<String> {
        let params = "{\"protocolVersion\":${protocolVersion},\"clientCapabilities\":{},\"clientInfo\":{\"name\":\"${jsonEscapeText(clientName)}\",\"version\":\"${jsonEscapeText(clientVersion)}\"}}"
        let reply = request(nextId(), "initialize", params, timeoutMs: timeoutMs)
        var supported = false
        if (let Some(raw) <- reply) {
            try { supported = acpSupportsSessionClose(raw) } catch (_: Exception) { supported = false }
        }
        negotiationLock.lock()
        closeSupported = supported
        activeSession = ""
        negotiationLock.unlock()
        return reply
    }

    // session/new：创建委派会话
    public func sessionNew(cwd: String, timeoutMs!: Int64 = 8000): Option<String> {
        var absolute = ""
        try { absolute = canonicalize(cwd).toString() } catch (e: Exception) {
            why = "session-new-invalid-workspace: ${e}"
            return None
        }
        let params = "{\"cwd\":\"${jsonEscapeText(absolute)}\",\"mcpServers\":[]}"
        let reply = request(nextId(), "session/new", params, timeoutMs: timeoutMs)
        var session = ""
        if (let Some(raw) <- reply) {
            try { session = acpReadCreatedSession(raw) } catch (_: Exception) { session = "" }
        }
        negotiationLock.lock()
        activeSession = session
        negotiationLock.unlock()
        return reply
    }

    // session/prompt：发送任务提示
    public func sessionPrompt(sessionId: String, prompt: String, timeoutMs!: Int64 = 30000): Option<String> {
        let params = "{\"sessionId\":\"${jsonEscapeText(sessionId)}\",\"prompt\":[{\"type\":\"text\",\"text\":\"${jsonEscapeText(prompt)}\"}]}"
        return request(nextId(), "session/prompt", params, timeoutMs: timeoutMs)
    }

    // session/resume：恢复会话
    public func sessionResume(sessionId: String, timeoutMs!: Int64 = 8000): Option<String> {
        let params = "{\"sessionId\":\"${jsonEscapeText(sessionId)}\"}"
        return request(nextId(), "session/resume", params, timeoutMs: timeoutMs)
    }

    // session/list：列出会话
    public func sessionList(timeoutMs!: Int64 = 4000): Option<String> {
        return request(nextId(), "session/list", "{}", timeoutMs: timeoutMs)
    }

    // session/cancel 是通知：发送成功仅证明写入管道，不证明任务停止。
    public func sessionCancel(sessionId: String): Bool {
        if (!alive() || sessionId.size == 0 || frameMode != "ndjson") { return false }
        let frame = "{\"jsonrpc\":\"2.0\",\"method\":\"session/cancel\",\"params\":{\"sessionId\":\"${jsonEscapeText(sessionId)}\"}}"
        if (let Some(p) <- proc) {
            writeLock.lock()
            try {
                p.stdInPipe.write((frame + "\n").toArray())
                p.stdInPipe.flush()
                return true
            } catch (e: Exception) {
                why = "cancel-write-failed: ${e}"
                return false
            } finally { writeLock.unlock() }
        }
        return false
    }
    // === 生命周期 ===

    // 优雅关闭：先发 session/close 再 settle（与 ExtProcess 的 host/shutdown 对应）
    public func close(): Int64 {
        if (settled) {
            return code
        }
        if (!running) {
            return Int64(-1)
        }
        negotiationLock.lock()
        let supported = closeSupported
        let session = activeSession
        negotiationLock.unlock()
        if (supported && session.size > 0) {
            let params = "{\"sessionId\":\"${jsonEscapeText(session)}\"}"
            request(nextId(), "session/close", params, timeoutMs: 2000)
        }
        return settle(3000)
    }

    // 强杀：超时强杀并如实标记 forced
    public func kill(): Int64 {
        if (settled) {
            return code
        }
        forced = true
        if (let Some(p) <- proc) {
            try {
                p.terminate(force: true)
            } catch (e: Exception) {
                why = "terminate-failed: ${e}"
            }
        }
        return settle(2000)
    }

    // restart：仅在委派未进入运行态时允许（REQ-FAIL-01 划定）
    // 不用于失败后自动换执行者——失败后只能由 AcpFailover 编排三退路
    public func restart(): Bool {
        if (busy) {
            why = "restart-not-allowed-while-delegation-running"
            return false
        }
        if (running && !settled) {
            // 进程还在但没委派在用：先优雅关闭再重启
            close()
        }
        // 重置状态
        running = false
        settled = false
        forced = false
        code = -1
        why = ""
        proc = None
        reader = None
        errReader = None
        return start()
    }

    // 结算：先有界地等子进程退出，超时才强杀并标记 forced；
    // 然后 join 读线程（stdout + stderr）——绝不留阻塞在管道读上的线程
    private func settle(timeoutMs: Int64): Int64 {
        if (let Some(p) <- proc) {
            var exited = false
            try {
                code = p.wait(timeout: timeoutMs * Duration.millisecond)
                exited = true
            } catch (e: Exception) {
                exited = false
            }
            if (!exited) {
                forced = true
                try {
                    p.terminate(force: true)
                } catch (e: Exception) {
                    why = "terminate-failed: ${e}"
                }
                try {
                    code = p.wait()
                } catch (e: Exception) {
                    why = "wait-failed: ${e}"
                }
            }
        }
        running = false
        table.stop()
        if (let Some(f) <- reader) {
            try {
                f.get(2000 * Duration.millisecond)
            } catch (e: Exception) {
                why = "reader-not-settled: ${e}"
            }
            reader = None
        }
        if (let Some(f) <- errReader) {
            try {
                f.get(1000 * Duration.millisecond)
            } catch (e: Exception) {
                // stderr 读线程收束失败不阻塞结算，诊断已尽量收集
            }
            errReader = None
        }
        settled = true
        return code
    }
}