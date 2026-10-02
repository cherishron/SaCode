package host
import core.*
import stdx.encoding.json.*
import std.collection.ArrayList
import std.env.*

// 帧：NDJSON，一行一条 JSON-RPC 2.0 报文（读侧用 readln，写侧补 LF）。
// stdout 只走协议帧，诊断走 stderr。只用已证实的 API：String.split / toArray() /
// Array.size / String.fromUtf8 / ArrayList，不用 String.find 与切片。
func emit(body: String) {
    getStdOut().write((body + String.fromUtf8(Array<Byte>(1, { _ => 10 }))).toArray())
}

func errFrame(id: String, code: Int64, message: String): String {
    return "{\"jsonrpc\":\"2.0\",\"id\":${id},\"error\":{\"code\":${code},\"message\":\"${message}\"}}"
}

func okFrame(id: String, result: String): String {
    return "{\"jsonrpc\":\"2.0\",\"id\":${id},\"result\":${result}}"
}

func bytesOf(s: String): Array<Byte> {
    return s.toArray()
}

func fromBytes(bs: ArrayList<Byte>): String {
    return String.fromUtf8(bs.toArray())
}

// 取 "key":"value" 的 value；value 不允许含转义引号（本端生成的报文满足此约束）。
func jsonStr(body: String, key: String): String {
    let hay = bytesOf(body)
    let pat = bytesOf("\"${key}\":\"")
    let plen = pat.size
    let hlen = hay.size
    if (plen > hlen) {
        return ""
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
            let out = ArrayList<Byte>()
            var j = i + plen
            while (j < hlen) {
                if (hay[j] == 34) {
                    return fromBytes(out)
                }
                out.add(hay[j])
                j += 1
            }
            return fromBytes(out)
        }
        i += 1
    }
    return ""
}

// 取 "id":<整数> 的 id；找不到或为 null 时返回 "null"。
func jsonId(body: String): String {
    let hay = bytesOf(body)
    let pat = bytesOf("\"id\":")
    let plen = pat.size
    let hlen = hay.size
    if (plen > hlen) {
        return "null"
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
            let num = ArrayList<Byte>()
            var j = i + plen
            while (j < hlen) {
                let b = hay[j]
                let n = Int64(b)
                if (n >= 48 && n <= 57) {
                    num.add(b)
                } else {
                    break
                }
                j += 1
            }
            if (num.size == 0) {
                return "null"
            }
            return fromBytes(num)
        }
        i += 1
    }
    return "null"
}

// 取 "key":<整数>，用于 cursor/limit 等数值参数。
func jsonNum(body: String, key: String): Int64 {
    let hay = bytesOf(body)
    let pat = bytesOf("\"${key}\":")
    let plen = pat.size
    let hlen = hay.size
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
            var j = i + plen
            var seen = false
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
            if (!seen) {
                return -1
            }
            return v
        }
        i += 1
    }
    return -1
}

main(args: Array<String>) {
    let p = "session.log"
    let lease = WriteLease(p)
    let shared = SessionLog(p)
    var leaseHeld = false
    while (true) {
        var body = ""
        var eof = false
        try {
            body = readln()
        } catch (e: Exception) {
            // stdin EOF（父进程关闭管道）属于正常退出路径，不得抛异常终止
            eof = true
        }
        if (eof) {
            break
        }
        if (body.size == 0) {
            break
        }
        var valid = true
        try {
            JsonValue.fromStr(body)
        } catch (e: Exception) {
            valid = false
        }
        if (!valid) {
            emit(errFrame("null", -32700, "parse error"))
            continue
        }
        let method = jsonStr(body, "method")
        let idText = jsonId(body)
        if (method == "initialize") {
            emit(okFrame(idText, "{\"protocolVersion\":\"0.1\",\"capabilities\":[\"initialize\",\"session/projection\",\"session/append\",\"session/submit\",\"session/flush\",\"session/subscribe\"],\"core\":\"cangjie\",\"transport\":\"stdio-ndjson\"}"))
            continue
        }
        if (method == "session/projection") {
            // 实例内可见性：持有租约时投影未 flush 的内存态（DSH 中 append 即可见，
            // flush 只决定崩溃持久与跨进程可见），否则从磁盘重建。
            let log = SessionLog(p)
            if (leaseHeld) {
                for (ev in shared.events) {
                    log.events.add(ev)
                }
                log.flushedCount = shared.flushedCount
            } else if (!log.load()) {
                emit(errFrame(idText, -32002, "replay-rejected"))
                continue
            }
            emit(okFrame(idText, "{\"projection\":${log.deriveMessages().size},\"events\":${log.events.size},\"durable\":${log.flushedCount},\"pending\":${log.events.size - log.flushedCount},\"truncatedTail\":${log.truncatedTail}}"))
            continue
        }
        if (method == "session/append") {
            if (!leaseHeld) {
                if (!lease.acquire()) {
                    emit(errFrame(idText, -32001, "already-owned"))
                    continue
                }
                if (!shared.load()) {
                    lease.release()
                    emit(errFrame(idText, -32002, "replay-rejected"))
                    continue
                }
                leaseHeld = true
            }
            shared.append(jsonStr(body, "eventType"), jsonStr(body, "data"))
            if (!shared.flush()) {
                // 未落盘则保留写租约与内存态，调用方可重试 flush，不得当作已提交
                emit(errFrame(idText, -32003, "flush-failed"))
                continue
            }
            leaseHeld = false
            lease.release()
            emit(okFrame(idText, "{\"events\":${shared.events.size},\"durable\":${shared.flushedCount}}"))
            continue
        }
        // 显式 durability 屏障：submit 只在内存可见，flush 才跨进程可见
        if (method == "session/submit") {
            if (!leaseHeld) {
                if (!lease.acquire()) {
                    emit(errFrame(idText, -32001, "already-owned"))
                    continue
                }
                if (!shared.load()) {
                    lease.release()
                    emit(errFrame(idText, -32002, "replay-rejected"))
                    continue
                }
                leaseHeld = true
            }
            shared.append(jsonStr(body, "eventType"), jsonStr(body, "data"))
            emit(okFrame(idText, "{\"events\":${shared.events.size},\"durable\":${shared.flushedCount}}"))
            continue
        }
        if (method == "session/flush") {
            if (!leaseHeld) {
                emit(errFrame(idText, -32004, "no-pending-writes"))
                continue
            }
            if (!shared.flush()) {
                emit(errFrame(idText, -32003, "flush-failed"))
                continue
            }
            leaseHeld = false
            lease.release()
            emit(okFrame(idText, "{\"events\":${shared.events.size},\"durable\":${shared.flushedCount}}"))
            continue
        }
        // 只回放**已落盘**事件：cursor 之后、limit 之内，more 表示还有
        if (method == "session/subscribe") {
            let fresh = SessionLog(p)
            if (!fresh.load()) {
                emit(errFrame(idText, -32002, "replay-rejected"))
                continue
            }
            var cursor = jsonNum(body, "cursor")
            var limit = jsonNum(body, "limit")
            if (cursor < 0) {
                cursor = 0
            }
            if (limit <= 0 || limit > 64) {
                limit = 64
            }
            let picked = ArrayList<String>()
            var next = cursor
            var more = false
            for (ev in fresh.events) {
                if (ev.seq >= cursor) {
                    if (Int64(picked.size) < limit) {
                        picked.add("{\"seq\":${ev.seq},\"type\":\"${ev.eventType}\"}")
                        next = ev.seq + 1
                    } else {
                        more = true
                    }
                }
            }
            var arr = "["
            for (i2 in 0..picked.size) {
                if (i2 > 0) {
                    arr += ","
                }
                arr += picked[i2]
            }
            arr += "]"
            emit(okFrame(idText, "{\"events\":${arr},\"nextCursor\":${next},\"durable\":${fresh.flushedCount},\"more\":${more}}"))
            continue
        }
        emit(errFrame(idText, -32601, "method not found"))
    }
    // 干净退出前结算未 flush 的写入：落盘成功才归还租约；失败则保留租约并报警，
    // 绝不在内存态丢失后假装写提交过（fail-closed）。
    if (leaseHeld) {
        if (shared.flush()) {
            lease.release()
        } else {
            getStdErr().writeln("host-exit-with-unflushed-writes: lease retained")
        }
    }
    return 0
}
