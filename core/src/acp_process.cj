package core
import std.collection.ArrayList
import std.fs.*
import std.io.*
import std.process.*
import std.sync.*

// ACP 外部 Agent 子进程托管：在 ExtProcess 成熟模式上抽 ACP 适配层。
// 帧编解码默认 NDJSON（OpenCode 已核 2026-10-08），保留 Content-Length 占位（待核产品）。
// stderr 改为可回收诊断（design §2.4.4），不污染协议面；崩溃/异常证据保留在诊断缓冲。
// restart 仅在委派未进入运行态时允许，不用于失败后自动换执行者（REQ-FAIL-01 划定）。
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

    // stderr 诊断缓冲：有界，不污染协议面（design §2.4.4）
    let diagBuf = ArrayList<Byte>()
    let diagLock = Mutex()
    let diagMax: Int64 = 8192

    // 委派是否在运行态：DelegationService 置位/复位，restart 前检查
    var busy = false

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
        try {
            // stderr 改为 Pipe：可回收诊断（design §2.4.4），不污染协议面
            let p = launch(command, arguments, workingDirectory: Some(wd),
                           stdIn: ProcessRedirect.Pipe, stdOut: ProcessRedirect.Pipe,
                           stdErr: ProcessRedirect.Pipe)
            proc = Some(p)
            running = true
            let outPipe = p.stdOutPipe
            reader = Some(spawn { => this.drainStdout(outPipe) })
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
    private func drainStdout(pipe: InputStream): Int64 {
        let rd: StringReader<InputStream> = StringReader(pipe)
        var n: Int64 = 0
        var done = false
        while (!done) {
            try {
                let line = rd.readln()
                if (let Some(s) <- line) {
                    if (s.size > 0) {
                        table.put(frameIdOf(s), s)
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
        let params = "{\"protocolVersion\":${protocolVersion},\"client\":{\"name\":\"${jsonEscapeText(clientName)}\",\"version\":\"${jsonEscapeText(clientVersion)}\"}}"
        return request(nextId(), "initialize", params, timeoutMs: timeoutMs)
    }

    // session/new：创建委派会话
    public func sessionNew(cwd: String, timeoutMs!: Int64 = 8000): Option<String> {
        let params = "{\"cwd\":\"${jsonEscapeText(cwd)}\"}"
        return request(nextId(), "session/new", params, timeoutMs: timeoutMs)
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

    // session/cancel：取消当前轮次
    public func sessionCancel(sessionId: String, timeoutMs!: Int64 = 4000): Option<String> {
        let params = "{\"sessionId\":\"${jsonEscapeText(sessionId)}\"}"
        return request(nextId(), "session/cancel", params, timeoutMs: timeoutMs)
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
        request(nextId(), "session/close", "{}", timeoutMs: 2000)
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