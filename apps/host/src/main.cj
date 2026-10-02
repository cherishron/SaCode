package host
import core.*
import stdx.encoding.json.*
import std.collection.ArrayList
import std.io.*
import std.env.*

// 帧：Content-Length: <字节数>\r\n\r\n<JSON-RPC 2.0 报文>
// stdout 只走协议帧，诊断走 stderr。只用已证实的 API：String.split / toArray() /
// Array.size / String.fromUtf8 / ArrayList，不用 String.find 与切片。
func count(body: String): Int64 {
    return Int64(body.toArray().size)
}

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

// 数字串转 Int64：只认 ASCII 数字，其余跳过。
func digitsOf(bs: Array<Byte>): Int64 {
    var v: Int64 = 0
    for (b in bs) {
        let n = Int64(b)
        if (n >= 48 && n <= 57) {
            v = v * 10 + (n - 48)
        }
    }
    return v
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

main(args: Array<String>) {
    let p = "session.log"
    while (true) {
        var body = ""
        try {
            body = readln()
        } catch (e: Exception) {
            // stdin EOF（父进程关闭管道）属于正常退出路径，不得抛异常终止
            return 0
        }
        if (body.size == 0) {
            break
        }
        if (body.size == 0) {
            continue
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
            emit(okFrame(idText, "{\"protocolVersion\":\"0.1\",\"capabilities\":[\"initialize\",\"session/projection\",\"session/append\"],\"core\":\"cangjie\",\"transport\":\"stdio-content-length\"}"))
            continue
        }
        if (method == "session/projection") {
            let log = SessionLog(p)
            if (!log.load()) {
                emit(errFrame(idText, -32002, "replay-rejected"))
                continue
            }
            emit(okFrame(idText, "{\"projection\":${log.deriveMessages().size},\"events\":${log.events.size}}"))
            continue
        }
        if (method == "session/append") {
            let lease = WriteLease(p)
            if (!lease.acquire()) {
                emit(errFrame(idText, -32001, "already-owned"))
                continue
            }
            let log = SessionLog(p)
            if (!log.load()) {
                lease.release()
                emit(errFrame(idText, -32002, "replay-rejected"))
                continue
            }
            log.append(jsonStr(body, "eventType"), jsonStr(body, "data"))
            if (!log.flush()) {
                lease.release()
                emit(errFrame(idText, -32003, "flush-failed"))
                continue
            }
            let n = log.events.size
            lease.release()
            emit(okFrame(idText, "{\"events\":${n}}"))
            continue
        }
        emit(errFrame(idText, -32601, "method not found"))
    }
    return 0
}
