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
    let sink = ThreadSafeDeliveryQueue(256)
    let idGen = AtomicInt64(0)
    let recv = AtomicInt64(0)
    let miss = AtomicInt64(0)
    let stopReading = AtomicBool(false)
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

    // 读到了但不是本次要配对的 id：如实计数。顺序一问一答下本不该出现，
    // 一旦非 0 就说明对端多发了帧，不能被当成正常。
    public func mismatched(): Int64 {
        return miss.load()
    }

    public func exitCode(): Int64 {
        return code
    }

    public func forcedExit(): Bool {
        return forced
    }

    // 读线程体：队列满时回压式重试而不是丢帧（应答帧丢了就再也配不上对了）。
    // 收束阶段放弃等待的帧不计入已收——宁可少报，不谎报。
    private func drainStdout(pipe: InputStream): Int64 {
        let rd: StringReader<InputStream> = StringReader(pipe)
        var n: Int64 = 0
        var done = false
        while (!done) {
            try {
                let line = rd.readln()
                if (let Some(s) <- line) {
                    if (s.size > 0) {
                        var accepted = sink.offer(s)
                        while (!accepted && !stopReading.load()) {
                            sleep(2 * Duration.millisecond)
                            accepted = sink.offer(s)
                        }
                        if (accepted) {
                            n += 1
                            recv.fetchAdd(1)
                        }
                    }
                } else {
                    done = true
                }
            } catch (e: Exception) {
                // 管道断开/EOF：子进程已经不再写了，读线程自然收束
                done = true
            }
            if (stopReading.load()) {
                done = true
            }
        }
        return n
    }

    private func nextId(): Int64 {
        return idGen.fetchAdd(1) + 1
    }

    // 一问一答按 id 配对；超时返回 None，绝不编一个终态出来。
    // 并发在途（同一时刻多条请求）需要按 id 建应答表，本批只做顺序语义并如实登记。
    public func request(id: Int64, method: String, params: String, timeoutMs!: Int64 = 4000): Option<String> {
        if (!alive()) {
            return None
        }
        if (let Some(p) <- proc) {
            let frame = "{\"jsonrpc\":\"2.0\",\"id\":${id},\"method\":\"${method}\",\"params\":${params}}"
            try {
                p.stdInPipe.write((frame + "\n").toArray())
                p.stdInPipe.flush()
            } catch (e: Exception) {
                why = "write-failed: ${e}"
                return None
            }
        } else {
            return None
        }
        var waited: Int64 = 0
        while (waited <= timeoutMs) {
            let got = sink.await(50)
            for (f in got) {
                if (frameIdOf(f) == id) {
                    return Some(f)
                }
                miss.fetchAdd(1)
            }
            waited += 50
        }
        return None
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
        if (let Some(f) <- reader) {
            try {
                f.get(2000 * Duration.millisecond)
            } catch (e: Exception) {
                stopReading.store(true)
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
