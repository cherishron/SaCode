package core
import std.collection.ArrayList
import std.fs.*
import std.io.*
import std.process.*
import std.sync.*

// 取帧里的 "id":<整数>；没有 id 或不是整数返回 -1。
// 核心只做字节扫描、不引 stdx，这样 CLI 与桌面两个入口的依赖面保持一致。
func frameIdOf(body: String): Int64 {
    let hay = body.toArray()
    let pat = "\"id\":".toArray()
    let hlen = Int64(hay.size)
    let plen = Int64(pat.size)
    if (plen > hlen) {
        return -1
    }
    var i: Int64 = 0
    while (i <= hlen - plen) {
        var same = true
        var k: Int64 = 0
        while (k < plen) {
            if (hay[i + k] != pat[k]) {
                same = false
                break
            }
            k += 1
        }
        if (same) {
            var v: Int64 = 0
            var seen = false
            var j = i + plen
            while (j < hlen) {
                let n = Int64(hay[j])
                if (n >= 48 && n <= 57) {
                    v = v * 10 + (n - 48)
                    seen = true
                } else {
                    break
                }
                j += 1
            }
            if (seen) {
                return v
            }
            return -1
        }
        i += 1
    }
    return -1
}

// 反斜杠、引号、换行必须转义：Windows 路径与含引号的参数不能写出坏帧。
// 其余控制字符直接丢弃——宁可少写一个字符，也不发一条对端解析不了的帧。
func jsonEscapeText(s: String): String {
    let out = ArrayList<Byte>()
    for (b in s.toArray()) {
        let n = Int64(b)
        if (n == 92) {
            out.add(92)
            out.add(92)
        } else if (n == 34) {
            out.add(92)
            out.add(34)
        } else if (n == 10) {
            out.add(92)
            out.add(110)
        } else if (n == 13) {
            out.add(92)
            out.add(114)
        } else if (n == 9) {
            out.add(92)
            out.add(116)
        } else if (n >= 32) {
            out.add(b)
        }
    }
    return String.fromUtf8(out.toArray())
}

// 仓颉核心驱动的 JS 扩展宿主子进程：NDJSON JSON-RPC 走 stdInPipe/stdOutPipe。
// 读侧必须是一条独立线程持续把 stdout 抽干——官方文档明示 Pipe 模式下
// 子进程标准流缓冲写满后再 wait() 会死锁。
public class ExtProcess {
    let command: String
    let arguments: Array<String>
    let wd: Path
    // 应答按 id 配对：可以有多条请求在途；表满时回压而不是丢帧
    let table = ReplyTable(256)
    // 两个线程同时往子进程 stdin 写帧会交错出坏帧，写侧必须整帧互斥
    let writeLock = Mutex()
    let idGen = AtomicInt64(0)
    let recv = AtomicInt64(0)
    var proc: Option<SubProcess> = None
    var reader: Option<Future<Int64>> = None
    var running = false
    var settled = false
    var forced = false
    var code: Int64 = -1
    var why = ""

    public init(command: String, arguments: Array<String>, workingDirectory!: Path) {
        this.command = command
        this.arguments = arguments
        this.wd = workingDirectory
    }

    public func start(): Bool {
        if (running) {
            return true
        }
        why = ""
        try {
            let p = launch(command, arguments, workingDirectory: Some(wd),
                           stdIn: ProcessRedirect.Pipe, stdOut: ProcessRedirect.Pipe,
                           stdErr: ProcessRedirect.Discard)
            proc = Some(p)
            running = true
            let pipe = p.stdOutPipe
            reader = Some(spawn { => this.drainStdout(pipe) })
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

    // 从来没人登记过的帧（id 为 null 或乱发）：如实计数，不能被任何请求认领。
    public func unsolicited(): Int64 {
        return table.unsolicited()
    }

    // 等待方已放弃后才到的帧：单独记迟到账，既不吞掉也不冒充本轮应答。
    public func late(): Int64 {
        return table.late()
    }

    // 表满导致的回压次数：非 0 说明消费方慢了，但帧一条没丢。
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

    // 读线程体：把每一帧按 id 交给登记表。表满时 put 内部回压等待，绝不丢帧——
    // 应答帧一旦被丢，对应的请求就永远配不上对了。
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
                // 管道断开/EOF：子进程已经不再写了，读线程自然收束
                done = true
            }
        }
        return n
    }

    private func nextId(): Int64 {
        return idGen.fetchAdd(1) + 1
    }

    // 按 id 配对，允许多条请求同时在途；超时只回 None，绝不编一个终态出来。
    // 收手之后这条 id 不再登记：它后来的帧只能记成迟到账，不会冒充别的请求的应答。
    public func request(id: Int64, method: String, params: String, timeoutMs!: Int64 = 4000): Option<String> {
        if (!alive()) {
            return None
        }
        // 先登记再写：应答可能比这次 write 返回得还快
        table.track(id)
        if (let Some(p) <- proc) {
            let frame = "{\"jsonrpc\":\"2.0\",\"id\":${id},\"method\":\"${method}\",\"params\":${params}}"
            writeLock.lock()
            try {
                p.stdInPipe.write((frame + "\n").toArray())
                p.stdInPipe.flush()
            } catch (e: Exception) {
                why = "write-failed: ${e}"
            }
            writeLock.unlock()
        } else {
            table.untrack(id)
            return None
        }
        let out = table.take(id, timeoutMs)
        table.untrack(id)
        return out
    }

    public func initialize(): Option<String> {
        return request(nextId(), "initialize", "{}")
    }

    public func load(path: String): Option<String> {
        return request(nextId(), "extension/load", "{\"path\":\"${jsonEscapeText(path)}\"}")
    }

    public func list(): Option<String> {
        return request(nextId(), "extension/list", "{}")
    }

    public func call(name: String, text: String, timeoutMs!: Int64 = 4000): Option<String> {
        let params = "{\"name\":\"${jsonEscapeText(name)}\",\"args\":{\"text\":\"${jsonEscapeText(text)}\"}}"
        return request(nextId(), "extension/call", params, timeoutMs: timeoutMs)
    }

    public func dispose(name: String): Option<String> {
        return request(nextId(), "extension/dispose", "{\"name\":\"${jsonEscapeText(name)}\"}")
    }

    // 结算：先有界地等子进程自己退出，超时才强杀并如实标记 forced；
    // 然后 join 读线程——绝不能留一个还阻塞在管道读上的线程就当已收束。
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
        // 登记表可能正把读线程压在回压里：先放行再 join，否则这里只能等到超时
        table.stop()
        if (let Some(f) <- reader) {
            try {
                f.get(2000 * Duration.millisecond)
            } catch (e: Exception) {
                why = "reader-not-settled: ${e}"
            }
            reader = None
        }
        settled = true
        return code
    }

    // 优雅退出的落点在协议层：core 侧只拿得到 OutputStream 接口，
    // std 没有文档化的 close()，所以不能靠「关掉写端」让子进程读到 EOF。
    public func close(): Int64 {
        if (settled) {
            return code
        }
        if (!running) {
            return Int64(-1)
        }
        request(nextId(), "host/shutdown", "{}", timeoutMs: 1500)
        return settle(3000)
    }

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
}
